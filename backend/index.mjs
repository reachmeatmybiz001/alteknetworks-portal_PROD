import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminDeleteUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDeleteUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  GetCommand,
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb'


// Email-domain restrictions are intentionally disabled. Any valid email can register.
// Portal access is controlled separately by Super Admin approval.
async function handleCognitoPreSignUp(event) {
  return event
}

const REGION = process.env.AWS_REGION || 'ap-south-1'
const USER_POOL_ID = process.env.USER_POOL_ID
const TICKETS_TABLE = process.env.TICKETS_TABLE
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://portal.alteknetworks.com'
const ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET
const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE || 'ALTEKNET-Customers'
const ASSETS_TABLE = process.env.ASSETS_TABLE || 'ALTEKNET-Customer-Assets'

const cognito = new CognitoIdentityProviderClient({ region: REGION })
const s3 = new S3Client({ region: REGION })
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
})

const ROLES = ['Customers', 'SupportAdmins', 'SuperAdmins']
const ADMIN_ROLES = ['SupportAdmins', 'SuperAdmins']

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': ALLOWED_ORIGIN,
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

function claims(event) {
  return event?.requestContext?.authorizer?.jwt?.claims || {}
}

function normalizeGroups(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(normalizeGroups).filter(Boolean)

  const text = String(value).trim()
  if (!text) return []

  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim()
    if (!inner) return []
    return inner
      .split(',')
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }

  return text
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

function groups(event) {
  return normalizeGroups(claims(event)['cognito:groups'])
}

function role(event) {
  const g = groups(event)
  if (g.includes('SuperAdmins')) return 'SuperAdmins'
  if (g.includes('SupportAdmins')) return 'SupportAdmins'
  return 'Customers'
}

function claimIdentity(event) {
  const c = claims(event)
  return String(
    c.email ||
    c.preferred_username ||
    c['cognito:username'] ||
    c.username ||
    c.sub ||
    ''
  ).trim()
}

function actorUsername(event) {
  return claimIdentity(event)
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))
}

const actorLookupCache = new Map()
let cognitoIdentityMapPromise = null

async function buildCognitoIdentityMap() {
  if (cognitoIdentityMapPromise) return cognitoIdentityMapPromise

  cognitoIdentityMapPromise = (async () => {
    const map = new Map()
    let token
    do {
      const result = await cognito.send(new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        PaginationToken: token,
        Limit: 60,
      }))
      for (const user of result.Users || []) {
        const attrs = user.Attributes || []
        const email = attrs.find((item) => item.Name === 'email')?.Value
        const sub = attrs.find((item) => item.Name === 'sub')?.Value
        const username = user.Username
        const display = email || username || sub
        if (display) {
          if (sub) map.set(String(sub).trim().toLowerCase(), display)
          if (username) map.set(String(username).trim().toLowerCase(), display)
        }
      }
      token = result.PaginationToken
    } while (token)
    return map
  })().catch((error) => {
    cognitoIdentityMapPromise = null
    throw error
  })

  return cognitoIdentityMapPromise
}

async function displayIdentityForStoredValue(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (!looksLikeUuid(raw)) return raw

  const cacheKey = raw.toLowerCase()
  if (actorLookupCache.has(cacheKey)) return actorLookupCache.get(cacheKey)

  // First try the value as the Cognito username. Older tickets may have
  // stored the Cognito username, which can itself be a UUID.
  try {
    const direct = await cognito.send(new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: raw,
    }))
    const email = (direct.UserAttributes || []).find((item) => item.Name === 'email')?.Value
    const display = email || direct.Username || ''
    if (display) {
      actorLookupCache.set(cacheKey, display)
      return display
    }
  } catch {}

  // If the stored UUID is the Cognito sub, query Cognito directly by sub.
  try {
    const result = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `sub = \"${raw}\"`,
      Limit: 1,
    }))
    const user = result.Users?.[0]
    if (user) {
      const email = (user.Attributes || []).find((item) => item.Name === 'email')?.Value
      const display = email || user.Username || ''
      if (display) {
        actorLookupCache.set(cacheKey, display)
        return display
      }
    }
  } catch {}

  // Final fallback: build the complete identity map.
  try {
    const map = await buildCognitoIdentityMap()
    const display = map.get(cacheKey)
    if (display) {
      actorLookupCache.set(cacheKey, display)
      return display
    }
  } catch {}

  // Do not expose raw Cognito UUID/sub values to the portal.
  return 'Portal user'
}

async function actorIdentity(event) {
  const raw = claimIdentity(event)
  const resolved = await displayIdentityForStoredValue(raw)
  return String(resolved || raw || '').trim().toLowerCase()
}

function requireRole(event, allowed) {
  const currentRole = role(event)
  if (!allowed.includes(currentRole)) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  }
  return currentRole
}

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {}
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })
  }
}

function ticketId() {
  return `ALT-${Date.now().toString().slice(-7)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

async function getUserGroups(username) {
  const result = await cognito.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    })
  )
  return (result.Groups || []).map((group) => group.GroupName).filter(Boolean)
}

async function getUserRole(username) {
  try {
    const userGroups = await getUserGroups(username)
    if (userGroups.includes('SuperAdmins')) return 'SuperAdmins'
    if (userGroups.includes('SupportAdmins')) return 'SupportAdmins'
    return 'Customers'
  } catch {
    return 'Customers'
  }
}

async function getCognitoUsername(event) {
  const c = claims(event)
  return String(
    c['cognito:username'] ||
    c.username ||
    c.email ||
    c.preferred_username ||
    c.sub ||
    ''
  ).trim()
}

async function getCustomerIdForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return ''
  const result = await cognito.send(new ListUsersCommand({
    UserPoolId: USER_POOL_ID,
    Filter: `email = \"${normalized.replace(/\\/g, '\\\\').replace(/\"/g, '\\\"')}\"`,
    Limit: 1,
  }))
  const user = (result.Users || [])[0]
  if (!user) return ''
  return (user.Attributes || [])
    .find((item) => item.Name === 'custom:customerId')?.Value || ''
}

async function getCustomerIdForUsername(username) {
  if (!username) return ''
  const result = await cognito.send(new AdminGetUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }))
  return (result.UserAttributes || [])
    .find((item) => item.Name === 'custom:customerId')?.Value || ''
}

async function getRegistrationProfile(username) {
  if (!username) throw Object.assign(new Error('Authenticated username is required'), { statusCode: 401 })
  const result = await cognito.send(new AdminGetUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }))
  const attrs = result.UserAttributes || []
  const groups = await getUserGroups(username)
  const customerId = attrs.find((item) => item.Name === 'custom:customerId')?.Value || ''
  const companyName = attrs.find((item) => item.Name === 'custom:companyName')?.Value || ''
  const email = attrs.find((item) => item.Name === 'email')?.Value || username
  const emailVerified = attrs.find((item) => item.Name === 'email_verified')?.Value === 'true'
  const approved = groups.includes('Customers') || groups.includes('SupportAdmins') || groups.includes('SuperAdmins')
  const isAdmin = groups.includes('SupportAdmins') || groups.includes('SuperAdmins')
  return {
    username: result.Username || username,
    email,
    companyName,
    customerId,
    emailVerified,
    enabled: result.Enabled !== false,
    cognitoStatus: result.UserStatus || '',
    groups,
    role: groups.includes('SuperAdmins') ? 'SuperAdmins' : groups.includes('SupportAdmins') ? 'SupportAdmins' : groups.includes('Customers') ? 'Customers' : emailVerified ? 'PendingApproval' : 'PendingVerification',
    approvalStatus: approved ? 'Approved' : emailVerified ? 'PendingApproval' : 'EmailVerificationPending',
    isAdmin,
  }
}

async function getMyRegistrationStatus(event) {
  const username = await getCognitoUsername(event)
  return response(200, await getRegistrationProfile(username))
}

async function getAuthenticatedCustomerId(event) {
  if (role(event) !== 'Customers') return ''
  const username = await getCognitoUsername(event)
  const customerId = await getCustomerIdForUsername(username)
  if (!customerId) {
    throw Object.assign(new Error('Customer account is not associated with a customer record'), { statusCode: 403 })
  }
  return customerId
}

async function getCustomer(customerId) {
  const result = await ddb.send(new GetCommand({
    TableName: CUSTOMERS_TABLE,
    Key: { customerId },
  }))
  return result.Item || null
}

async function requireActiveCustomer(customerId) {
  const customer = await getCustomer(customerId)
  if (!customer) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })
  if (String(customer.status || 'Active').toLowerCase() !== 'active') {
    throw Object.assign(new Error('Customer is inactive'), { statusCode: 400 })
  }
  return customer
}

async function getAsset(serialNumber) {
  const result = await ddb.send(new GetCommand({
    TableName: ASSETS_TABLE,
    Key: { serialNumber },
  }))
  return result.Item || null
}

async function validateSerialForCustomer(serialNumber, customerId, reveal = false) {
  const serial = String(serialNumber || '').trim()
  if (!serial) throw Object.assign(new Error('Serial number is required'), { statusCode: 400 })
  const asset = await getAsset(serial)
  if (!asset || String(asset.customerId || '') !== String(customerId) || String(asset.status || 'Active').toLowerCase() !== 'active') {
    throw Object.assign(new Error('Asset serial number is not registered for your account.'), { statusCode: 404 })
  }
  return asset
}

async function listCustomers(event) {
  requireRole(event, ['SuperAdmins'])
  const result = await ddb.send(new ScanCommand({ TableName: CUSTOMERS_TABLE }))
  return response(200, result.Items || [])
}

async function createCustomer(event) {
  requireRole(event, ['SuperAdmins'])
  const body = parseBody(event)
  const customerName = String(body.customerName || body.name || '').trim()
  if (!customerName) throw Object.assign(new Error('Customer name is required'), { statusCode: 400 })

  const customerId = String(body.customerId || `CUST-${Date.now().toString().slice(-6)}`).trim()
  const existing = await getCustomer(customerId)
  if (existing) throw Object.assign(new Error('Customer ID already exists'), { statusCode: 409 })

  const item = {
    customerId,
    customerName,
    status: String(body.status || 'Active'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await ddb.send(new PutCommand({ TableName: CUSTOMERS_TABLE, Item: item }))
  return response(201, item)
}

async function listAllCognitoUsers() {
  const users = []
  let PaginationToken
  do {
    const result = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      PaginationToken,
      Limit: 60,
    }))
    users.push(...(result.Users || []))
    PaginationToken = result.PaginationToken
  } while (PaginationToken)
  return users
}

async function deleteCustomer(event, customerIdValue) {
  requireRole(event, ['SuperAdmins'])
  const customerId = String(customerIdValue || '').trim()
  if (!customerId) throw Object.assign(new Error('Customer ID is required'), { statusCode: 400 })

  const customer = await getCustomer(customerId)
  if (!customer) throw Object.assign(new Error('Customer not found'), { statusCode: 404 })

  // Customer deletion removes the customer master record and all assigned assets.
  // Existing tickets are intentionally retained for historical/audit purposes.
  const assetsResult = await ddb.send(new QueryCommand({
    TableName: ASSETS_TABLE,
    IndexName: 'customerId-index',
    KeyConditionExpression: 'customerId = :customerId',
    ExpressionAttributeValues: { ':customerId': customerId },
  }))
  const assets = assetsResult.Items || []

  for (let index = 0; index < assets.length; index += 25) {
    const chunk = assets.slice(index, index + 25)
    if (!chunk.length) continue
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [ASSETS_TABLE]: chunk.map((asset) => ({
          DeleteRequest: { Key: { serialNumber: asset.serialNumber } },
        })),
      },
    }))
  }

  // Disable and unassign customer portal users rather than deleting their
  // Cognito identities, preserving the user audit trail.
  const allUsers = await listAllCognitoUsers()
  let disabledUsers = 0
  for (const cognitoUser of allUsers) {
    const attrs = cognitoUser.Attributes || []
    const linkedCustomerId = attrs.find((item) => item.Name === 'custom:customerId')?.Value || ''
    if (String(linkedCustomerId) !== customerId) continue

    const username = cognitoUser.Username
    if (!username) continue
    try {
      const currentGroups = await getUserGroups(username)
      for (const groupName of currentGroups) {
        if (ROLES.includes(groupName)) {
          await cognito.send(new AdminRemoveUserFromGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: username,
            GroupName: groupName,
          }))
        }
      }
      await cognito.send(new AdminDeleteUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributeNames: ['custom:customerId'],
      }))
      if (cognitoUser.Enabled !== false) {
        await cognito.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }))
      }
      disabledUsers += 1
    } catch (error) {
      console.error('Unable to detach customer user', username, error)
    }
  }

  await ddb.send(new DeleteCommand({
    TableName: CUSTOMERS_TABLE,
    Key: { customerId },
  }))

  return response(200, {
    customerId,
    customerName: customer.customerName,
    deleted: true,
    assetsDeleted: assets.length,
    usersDisabled: disabledUsers,
    ticketsRetained: true,
  })
}

async function listCustomerAssets(event, customerId) {
  requireRole(event, ['SuperAdmins'])
  await requireActiveCustomer(customerId)
  const result = await ddb.send(new QueryCommand({
    TableName: ASSETS_TABLE,
    IndexName: 'customerId-index',
    KeyConditionExpression: 'customerId = :customerId',
    ExpressionAttributeValues: { ':customerId': customerId },
  }))
  return response(200, result.Items || [])
}

async function createCustomerAsset(event, customerId) {
  requireRole(event, ['SuperAdmins'])
  const customer = await requireActiveCustomer(customerId)
  const body = parseBody(event)
  const serialNumber = String(body.serialNumber || '').trim()
  if (!serialNumber) throw Object.assign(new Error('Serial number is required'), { statusCode: 400 })
  if (await getAsset(serialNumber)) throw Object.assign(new Error('Serial number already exists'), { statusCode: 409 })

  const item = {
    serialNumber,
    customerId,
    customerName: customer.customerName,
    product: String(body.product || '').trim(),
    manufacturer: String(body.manufacturer || '').trim(),
    model: String(body.model || '').trim(),
    status: String(body.status || 'Active'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await ddb.send(new PutCommand({ TableName: ASSETS_TABLE, Item: item }))
  return response(201, item)
}

async function importCustomerAssets(event, customerId) {
  requireRole(event, ['SuperAdmins'])
  const customer = await requireActiveCustomer(customerId)
  const body = parseBody(event)
  const rows = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) throw Object.assign(new Error('No asset rows supplied'), { statusCode: 400 })
  if (rows.length > 1000) throw Object.assign(new Error('Maximum 1000 assets per import'), { statusCode: 400 })

  let created = 0
  let updated = 0
  const errors = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {}
    const serialNumber = String(row.serialNumber || row.SerialNumber || '').trim()
    if (!serialNumber) {
      errors.push({ row: index + 2, message: 'Serial number is required' })
      continue
    }
    const existing = await getAsset(serialNumber)
    if (existing && String(existing.customerId || '') !== String(customerId)) {
      errors.push({ row: index + 2, serialNumber, message: 'Serial number already belongs to another customer' })
      continue
    }
    const item = {
      serialNumber,
      customerId,
      customerName: customer.customerName,
      product: String(row.product || row.Product || existing?.product || '').trim(),
      manufacturer: String(row.manufacturer || row.Manufacturer || existing?.manufacturer || '').trim(),
      model: String(row.model || row.Model || existing?.model || '').trim(),
      status: String(row.status || row.Status || existing?.status || 'Active').trim(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await ddb.send(new PutCommand({ TableName: ASSETS_TABLE, Item: item }))
    if (existing) updated += 1
    else created += 1
  }
  return response(200, { created, updated, errors })
}

async function updateCustomerAsset(event, customerId, serialNumber) {
  requireRole(event, ['SuperAdmins'])
  await requireActiveCustomer(customerId)
  const existing = await getAsset(serialNumber)
  if (!existing || String(existing.customerId || '') !== String(customerId)) {
    throw Object.assign(new Error('Asset not found'), { statusCode: 404 })
  }
  const body = parseBody(event)
  const updates = {}
  for (const key of ['product', 'manufacturer', 'model', 'status']) {
    if (body[key] !== undefined) updates[key] = String(body[key]).trim()
  }
  if (!Object.keys(updates).length) return response(200, existing)
  updates.updatedAt = new Date().toISOString()
  const names = {}
  const values = {}
  const expressions = []
  for (const [key, value] of Object.entries(updates)) {
    names[`#${key}`] = key
    values[`:${key}`] = value
    expressions.push(`#${key} = :${key}`)
  }
  const result = await ddb.send(new UpdateCommand({
    TableName: ASSETS_TABLE,
    Key: { serialNumber },
    UpdateExpression: `SET ${expressions.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  }))
  return response(200, result.Attributes)
}

async function deleteCustomerAsset(event, customerId, serialNumber) {
  requireRole(event, ['SuperAdmins'])
  await requireActiveCustomer(customerId)
  const existing = await getAsset(serialNumber)
  if (!existing || String(existing.customerId || '') !== String(customerId)) {
    throw Object.assign(new Error('Asset not found'), { statusCode: 404 })
  }
  await ddb.send(new DeleteCommand({ TableName: ASSETS_TABLE, Key: { serialNumber } }))
  return response(200, { serialNumber, deleted: true })
}

async function validateTicketSerial(event) {
  const currentRole = role(event)
  const body = parseBody(event)
  const serialNumber = String(body.serialNumber || '').trim()

  if (!serialNumber) {
    return response(200, {
      valid: false,
      message: 'Serial number is required.',
    })
  }

  // Customers are NEVER allowed to choose a customerId/customerEmail from
  // the browser. The customer is derived from the authenticated Cognito user.
  let customerId = ''
  if (currentRole === 'Customers') {
    const c = claims(event)
    customerId = String(c['custom:customerId'] || '').trim()
    if (!customerId) customerId = await getAuthenticatedCustomerId(event)
  } else {
    customerId = String(body.customerId || '').trim()
    if (!customerId && body.customerEmail) {
      customerId = await getCustomerIdForEmail(body.customerEmail)
      if (!customerId) {
        return response(200, {
          valid: false,
          message: 'Customer email is not associated with an approved customer account.',
        })
      }
    }
  }

  if (!customerId) {
    return response(200, {
      valid: false,
      message: currentRole === 'Customers'
        ? 'Customer account is not associated with a customer record.'
        : 'Customer email or customer ID is required.',
    })
  }

  if (currentRole !== 'Customers') await requireActiveCustomer(customerId)

  const asset = await getAsset(serialNumber)

  // A missing serial, inactive asset, or an asset belonging to another
  // customer is a normal validation failure — NOT a server error. Returning
  // a 200 business result also prevents browsers/API wrappers from replacing
  // the useful message with a generic "Internal Server Error".
  if (!asset || String(asset.customerId || '') !== String(customerId) || String(asset.status || 'Active').toLowerCase() !== 'active') {
    return response(200, {
      valid: false,
      message: 'Asset serial number is not registered for your account.',
    })
  }

  return response(200, {
    valid: true,
    serialNumber: asset.serialNumber,
    customerId: asset.customerId,
    customerName: asset.customerName,
    product: asset.product || '',
    manufacturer: asset.manufacturer || '',
    model: asset.model || '',
    status: asset.status || 'Active',
  })
}

async function listAllUsers() {
  let users = []
  let token

  do {
    const result = await cognito.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        PaginationToken: token,
        Limit: 60,
      })
    )

    users = users.concat(result.Users || [])
    token = result.PaginationToken
  } while (token)

  return Promise.all(
    users.map(async (user) => {
      const attrs = user.Attributes || []
      const userGroups = await getUserGroups(user.Username)
      const customerId = attrs.find((a) => a.Name === 'custom:customerId')?.Value || ''
      const companyName = attrs.find((a) => a.Name === 'custom:companyName')?.Value || ''
      const emailVerified = attrs.find((a) => a.Name === 'email_verified')?.Value === 'true'
      const role = userGroups.includes('SuperAdmins')
        ? 'SuperAdmins'
        : userGroups.includes('SupportAdmins')
          ? 'SupportAdmins'
          : userGroups.includes('Customers')
            ? 'Customers'
            : emailVerified
              ? 'PendingApproval'
              : 'PendingVerification'
      return {
        username: user.Username,
        email: attrs.find((a) => a.Name === 'email')?.Value || user.Username,
        companyName,
        emailVerified,
        enabled: user.Enabled !== false,
        status: user.UserStatus,
        role,
        approvalStatus: role === 'PendingApproval' ? 'PendingApproval' : role === 'PendingVerification' ? 'EmailVerificationPending' : 'Approved',
        customerId,
        createdAt: user.UserCreateDate,
        lastModifiedAt: user.UserLastModifiedDate,
      }
    })
  )
}

async function enrichTicketIdentities(tickets) {
  return Promise.all((tickets || []).map(async (ticket) => {
    const [customerEmail, createdBy, updatedBy] = await Promise.all([
      displayIdentityForStoredValue(ticket.customerEmail),
      displayIdentityForStoredValue(ticket.createdBy),
      displayIdentityForStoredValue(ticket.updatedBy),
    ])

    return {
      ...ticket,
      customerEmail: customerEmail || ticket.customerEmail || '',
      createdBy: createdBy || ticket.createdBy || customerEmail || ticket.customerEmail || '',
      createdByEmail: createdBy || ticket.createdByEmail || ticket.createdBy || customerEmail || ticket.customerEmail || '',
      createdByUsername: createdBy || ticket.createdByUsername || ticket.createdBy || '',
      updatedBy: updatedBy || ticket.updatedBy || '',
      updatedByEmail: updatedBy || ticket.updatedByEmail || ticket.updatedBy || '',
      updatedByUsername: updatedBy || ticket.updatedByUsername || ticket.updatedBy || '',
    }
  }))
}

async function listTickets(event) {
  const currentRole = role(event)
  if (currentRole === 'Customers') {
    const customerId = await getAuthenticatedCustomerId(event)
    const actorEmail = (claims(event).email || '').toString().trim().toLowerCase()
    const result = await ddb.send(new ScanCommand({ TableName: TICKETS_TABLE }))
    const tickets = result.Items || []
    const owned = tickets.filter((ticket) => {
      if (ticket.customerId) return String(ticket.customerId) === String(customerId)
      return String(ticket.customerEmail || '').toLowerCase() === actorEmail
    })
    return enrichTicketIdentities(owned)
  }

  const result = await ddb.send(new ScanCommand({ TableName: TICKETS_TABLE }))
  return enrichTicketIdentities(result.Items || [])
}

async function createTicket(event) {
  const currentRole = requireRole(event, ROLES)
  const body = parseBody(event)
  const actorEmail = await actorIdentity(event)

  if (!body.subject || !body.description) {
    throw Object.assign(new Error('Subject and description are required'), { statusCode: 400 })
  }

  let customerEmail = actorEmail
  let customerId = ''
  let asset = null

  if (currentRole === 'Customers') {
    customerId = await getAuthenticatedCustomerId(event)
    const serialNumber = String(body.serialNumber || '').trim()
    if (!serialNumber) throw Object.assign(new Error('Serial number is required'), { statusCode: 400 })
    asset = await validateSerialForCustomer(serialNumber, customerId, false)
  } else {
    if (body.customerId) {
      customerId = String(body.customerId).trim()
      await requireActiveCustomer(customerId)
    }
    if (body.serialNumber) {
      if (!customerId) throw Object.assign(new Error('Customer ID is required when a serial number is supplied'), { statusCode: 400 })
      asset = await validateSerialForCustomer(String(body.serialNumber).trim(), customerId, true)
    }
    if (body.customerEmail) customerEmail = String(body.customerEmail).trim().toLowerCase()
  }

  const now = new Date().toISOString()
  const item = {
    id: ticketId(),
    subject: String(body.subject).slice(0, 200),
    category: String(body.category || 'General'),
    priority: String(body.priority || 'Medium'),
    description: String(body.description).slice(0, 10000),
    customerEmail,
    ...(customerId ? { customerId } : {}),
    ...(asset ? {
      serialNumber: asset.serialNumber,
      product: asset.product || '',
      manufacturer: asset.manufacturer || '',
      model: asset.model || '',
    } : {}),
    createdBy: actorEmail || actorUsername(event),
    createdByEmail: actorEmail || actorUsername(event),
    createdByUsername: actorEmail || actorUsername(event),
    createdByRole: currentRole,
    status: 'Open',
    assignedTo: body.assignedTo || null,
    comments: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    updatedBy: actorEmail || actorUsername(event),
    updatedByEmail: actorEmail || actorUsername(event),
    updatedByUsername: actorEmail || actorUsername(event),
    closedAt: null,
    timeSpentMinutes: null,
  }

  await ddb.send(new PutCommand({ TableName: TICKETS_TABLE, Item: item }))
  return response(201, item)
}

async function deleteTicket(event, ticketIdValue) {
  requireRole(event, ['SuperAdmins'])

  const existingResult = await ddb.send(
    new GetCommand({ TableName: TICKETS_TABLE, Key: { id: ticketIdValue } })
  )
  const existing = existingResult.Item
  if (!existing) {
    throw Object.assign(new Error('Ticket not found'), { statusCode: 404 })
  }

  const attachmentKeys = (Array.isArray(existing.attachments) ? existing.attachments : [])
    .map((item) => item?.key)
    .filter(Boolean)

  if (ATTACHMENTS_BUCKET && attachmentKeys.length) {
    await ddbDeleteS3Objects(attachmentKeys)
  }

  await ddb.send(new DeleteCommand({
    TableName: TICKETS_TABLE,
    Key: { id: ticketIdValue },
  }))

  return response(200, {
    ticketId: ticketIdValue,
    deleted: true,
  })
}

async function ddbDeleteS3Objects(keys) {
  if (!ATTACHMENTS_BUCKET || !keys.length) return
  for (let index = 0; index < keys.length; index += 1000) {
    const chunk = keys.slice(index, index + 1000)
    await s3.send(new DeleteObjectsCommand({
      Bucket: ATTACHMENTS_BUCKET,
      Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
    }))
  }
}

async function updateTicket(event, ticketIdValue, attachmentOverride = null) {
  const currentRole = role(event)
  const body = parseBody(event)
  const actorEmail = await actorIdentity(event)
  const actorCustomerId = currentRole === 'Customers' ? await getAuthenticatedCustomerId(event) : ''

  const existingResult = await ddb.send(
    new GetCommand({ TableName: TICKETS_TABLE, Key: { id: ticketIdValue } })
  )
  const existing = existingResult.Item

  if (!existing) {
    throw Object.assign(new Error('Ticket not found'), { statusCode: 404 })
  }

  if (existing.status === 'Closed') {
    throw Object.assign(new Error('Closed tickets cannot be modified'), { statusCode: 409 })
  }

  const isOwner = existing.customerId
    ? String(existing.customerId) === String(actorCustomerId)
    : String(existing.customerEmail || '').toLowerCase() === actorEmail
  const isCustomer = currentRole === 'Customers'
  const isSupport = currentRole === 'SupportAdmins'
  const isSuper = currentRole === 'SuperAdmins'

  if (isCustomer && !isOwner) {
    throw Object.assign(new Error('Customers can only manage their own tickets'), { statusCode: 403 })
  }

  if (!isCustomer && !isSupport && !isSuper) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  }

  const updates = {}
  const allowedFields = isCustomer
    ? ['subject', 'category', 'priority', 'description', 'status']
    : ['subject', 'category', 'priority', 'description', 'status', 'assignedTo', 'customerEmail']

  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      updates[key] = body[key]
    }
  }

  if (body.comment) {
    updates.comments = [
      ...(Array.isArray(existing.comments) ? existing.comments : []),
      {
        id: `COM-${Date.now()}`,
        text: String(body.comment).slice(0, 5000),
        createdBy: actorEmail || actorUsername(event),
        createdByEmail: actorEmail || actorUsername(event),
        createdByUsername: actorEmail || actorUsername(event),
        createdAt: new Date().toISOString(),
      },
    ]
  }

  const attachmentToAdd = attachmentOverride || body.attachment
  if (attachmentToAdd) {
    updates.attachments = [
      ...(Array.isArray(existing.attachments) ? existing.attachments : []),
      attachmentToAdd,
    ]
  }

  if (!Object.keys(updates).length) {
    return response(200, existing)
  }

  const now = new Date()
  updates.updatedAt = now.toISOString()
  updates.updatedBy = actorEmail || actorUsername(event)
  updates.updatedByEmail = actorEmail || actorUsername(event)
  updates.updatedByUsername = actorUsername(event) || actorEmail

  if (updates.status === 'Closed' && existing.status !== 'Closed') {
    updates.closedAt = now.toISOString()
    const start = new Date(existing.createdAt).getTime()
    updates.timeSpentMinutes = Number.isFinite(start)
      ? Math.max(0, Math.round((now.getTime() - start) / 60000))
      : null
  } else if (updates.status && updates.status !== 'Closed' && existing.status === 'Closed') {
    updates.closedAt = null
    updates.timeSpentMinutes = null
  }

  const expressionNames = {}
  const expressionValues = {}
  const expressions = []

  for (const [key, value] of Object.entries(updates)) {
    const name = `#${key}`
    const valueName = `:${key}`
    expressionNames[name] = key
    expressionValues[valueName] = value
    expressions.push(`${name} = ${valueName}`)
  }

  const result = await ddb.send(
    new UpdateCommand({
      TableName: TICKETS_TABLE,
      Key: { id: ticketIdValue },
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    })
  )

  return response(200, result.Attributes)
}

async function createAttachmentUploadUrl(event, ticketIdValue) {
  if (!ATTACHMENTS_BUCKET) {
    throw Object.assign(new Error('Attachment storage is not configured'), { statusCode: 500 })
  }

  const currentRole = role(event)
  const body = parseBody(event)
  const actorEmail = await actorIdentity(event)
  const result = await ddb.send(new GetCommand({
    TableName: TICKETS_TABLE,
    Key: { id: ticketIdValue },
  }))
  const ticket = result.Item
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { statusCode: 404 })

  const actorCustomerId = currentRole === 'Customers' ? await getAuthenticatedCustomerId(event) : ''
  const ticketCustomerIdentity = await displayIdentityForStoredValue(ticket.customerEmail)
  const isOwner = ticket.customerId
    ? String(ticket.customerId) === String(actorCustomerId)
    : String(ticketCustomerIdentity || ticket.customerEmail || '').toLowerCase() === actorEmail
  if (currentRole === 'Customers' && !isOwner) {
    throw Object.assign(new Error('Customers can only attach files to their own tickets'), { statusCode: 403 })
  }

  const fileName = String(body.fileName || body.name || '').trim()
  const contentType = String(body.contentType || 'application/octet-stream').trim()
  const size = Number(body.size || 0)
  if (!fileName) throw Object.assign(new Error('File name is required'), { statusCode: 400 })
  if (size > 25 * 1024 * 1024) throw Object.assign(new Error('Maximum attachment size is 25 MB'), { statusCode: 400 })

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const attachmentId = `ATT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const key = `tickets/${ticketIdValue}/${attachmentId}-${safeName}`
  // Do not sign Content-Type into the URL. Browsers may normalize MIME types,
  // which can otherwise cause a valid presigned upload to fail with a generic
  // "Failed to fetch" / SignatureDoesNotMatch error. The object metadata is
  // still recorded in DynamoDB and the browser sends Content-Type when uploading.
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: ATTACHMENTS_BUCKET,
    Key: key,
  }), { expiresIn: 900 })

  return response(200, {
    uploadUrl,
    attachment: {
      id: attachmentId,
      key,
      name: fileName,
      contentType,
      size,
      uploadedBy: actorEmail || actorUsername(event),
      uploadedAt: new Date().toISOString(),
    },
  })
}


async function uploadAttachmentViaApi(event, ticketIdValue) {
  if (!ATTACHMENTS_BUCKET) {
    throw Object.assign(new Error('Attachment storage is not configured'), { statusCode: 500 })
  }

  const currentRole = role(event)
  const actorEmail = await actorIdentity(event)
  const result = await ddb.send(new GetCommand({ TableName: TICKETS_TABLE, Key: { id: ticketIdValue } }))
  const ticket = result.Item
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { statusCode: 404 })

  const actorCustomerId = currentRole === 'Customers' ? await getAuthenticatedCustomerId(event) : ''
  const ticketCustomerIdentity = await displayIdentityForStoredValue(ticket.customerEmail)
  const isOwner = ticket.customerId
    ? String(ticket.customerId) === String(actorCustomerId)
    : String(ticketCustomerIdentity || ticket.customerEmail || '').toLowerCase() === actorEmail
  if (currentRole === 'Customers' && !isOwner) {
    throw Object.assign(new Error('Customers can only attach files to their own tickets'), { statusCode: 403 })
  }
  if (ticket.status === 'Closed') {
    throw Object.assign(new Error('Closed tickets cannot be modified'), { statusCode: 400 })
  }

  const body = parseBody(event)
  const fileName = String(body.fileName || body.name || '').trim()
  const contentType = String(body.contentType || 'application/octet-stream').trim()
  const base64 = String(body.dataBase64 || '').trim()
  if (!fileName || !base64) throw Object.assign(new Error('File name and file data are required'), { statusCode: 400 })

  const estimatedSize = Math.floor((base64.length * 3) / 4)
  if (estimatedSize > 7 * 1024 * 1024) {
    throw Object.assign(new Error('Direct upload limit is 7 MB. Please deploy the S3 CORS configuration and use the normal upload for larger files.'), { statusCode: 413 })
  }

  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length > 7 * 1024 * 1024) throw Object.assign(new Error('Direct upload limit is 7 MB'), { statusCode: 413 })

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const attachmentId = `ATT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const key = `tickets/${ticketIdValue}/${attachmentId}-${safeName}`
  await s3.send(new PutObjectCommand({
    Bucket: ATTACHMENTS_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }))

  const attachment = {
    id: attachmentId,
    key,
    name: fileName,
    contentType,
    size: buffer.length,
    uploadedBy: actorEmail || actorUsername(event),
    uploadedAt: new Date().toISOString(),
  }
  return updateTicket(event, ticketIdValue, attachment)
}

async function recordAttachment(event, ticketIdValue) {
  const body = parseBody(event)
  const attachment = body.attachment
  if (!attachment?.id || !attachment?.key) {
    throw Object.assign(new Error('Attachment details are required'), { statusCode: 400 })
  }
  return updateTicket(event, ticketIdValue, attachment)
}

async function downloadAttachment(event, ticketIdValue, attachmentId) {
  if (!ATTACHMENTS_BUCKET) throw Object.assign(new Error('Attachment storage is not configured'), { statusCode: 500 })
  const currentRole = role(event)
  const actorEmail = await actorIdentity(event)
  const result = await ddb.send(new GetCommand({ TableName: TICKETS_TABLE, Key: { id: ticketIdValue } }))
  const ticket = result.Item
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { statusCode: 404 })
  const actorCustomerId = currentRole === 'Customers' ? await getAuthenticatedCustomerId(event) : ''
  const ticketCustomerIdentity = await displayIdentityForStoredValue(ticket.customerEmail)
  const isOwner = ticket.customerId
    ? String(ticket.customerId) === String(actorCustomerId)
    : String(ticketCustomerIdentity || ticket.customerEmail || '').toLowerCase() === actorEmail
  if (currentRole === 'Customers' && !isOwner) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })

  const attachment = (ticket.attachments || []).find((item) => item.id === attachmentId || item.key === attachmentId)
  if (!attachment) throw Object.assign(new Error('Attachment not found'), { statusCode: 404 })
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: ATTACHMENTS_BUCKET, Key: attachment.key }), { expiresIn: 900 })
  return response(200, { url })
}

async function listUsers(event) {
  requireRole(event, ['SuperAdmins'])
  return response(200, await listAllUsers())
}

async function createUser(event) {
  requireRole(event, ['SuperAdmins'])
  const body = parseBody(event)
  const newRole = body.role || 'Customers'
  const userEmail = String(body.email || '').trim().toLowerCase()
  const temporaryPassword = String(body.temporaryPassword || '').trim()
  const customerId = String(body.customerId || '').trim()

  if (!ROLES.includes(newRole)) throw Object.assign(new Error('Invalid role'), { statusCode: 400 })
  if (!userEmail) throw Object.assign(new Error('Email is required'), { statusCode: 400 })
  if (!temporaryPassword) throw Object.assign(new Error('Temporary password is required'), { statusCode: 400 })
  if (newRole === 'Customers') {
    if (!customerId) throw Object.assign(new Error('Customer is required for customer users'), { statusCode: 400 })
    await requireActiveCustomer(customerId)
  }

  const attributes = [
    { Name: 'email', Value: userEmail },
    { Name: 'email_verified', Value: 'true' },
  ]
  if (newRole === 'Customers') attributes.push({ Name: 'custom:customerId', Value: customerId })

  const result = await cognito.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: userEmail,
    TemporaryPassword: temporaryPassword,
    UserAttributes: attributes,
    MessageAction: 'SUPPRESS',
  }))

  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: USER_POOL_ID,
    Username: result.User.Username,
    GroupName: newRole,
  }))

  return response(201, {
    username: result.User.Username,
    email: userEmail,
    role: newRole,
    customerId: newRole === 'Customers' ? customerId : '',
    enabled: true,
    status: result.User.UserStatus,
  })
}

async function updateUser(event, username) {
  requireRole(event, ['SuperAdmins'])
  const body = parseBody(event)

  if (body.action === 'approve') {
    const customerId = String(body.customerId || '').trim()
    if (!customerId) throw Object.assign(new Error('Customer is required for approval'), { statusCode: 400 })
    await requireActiveCustomer(customerId)
    const currentGroups = await getUserGroups(username)
    for (const groupName of currentGroups) {
      if (ROLES.includes(groupName)) {
        await cognito.send(new AdminRemoveUserFromGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          GroupName: groupName,
        }))
      }
    }
    await cognito.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      UserAttributes: [
        { Name: 'custom:customerId', Value: customerId },
      ],
    }))
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: 'Customers',
    }))
    await cognito.send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }))
    return response(200, { username, role: 'Customers', customerId, approvalStatus: 'Approved', message: 'Customer registration approved.' })
  }

  if (body.action === 'reject') {
    const currentGroups = await getUserGroups(username)
    for (const groupName of currentGroups) {
      if (ROLES.includes(groupName)) {
        await cognito.send(new AdminRemoveUserFromGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          GroupName: groupName,
        }))
      }
    }
    await cognito.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }))
    return response(200, { username, approvalStatus: 'Rejected', message: 'Customer registration rejected and account disabled.' })
  }

  const currentRole = await getUserRole(username)
  const newRole = body.role !== undefined ? String(body.role) : currentRole

  if (!ROLES.includes(newRole)) throw Object.assign(new Error('Invalid role'), { statusCode: 400 })

  if (body.role !== undefined && currentRole !== newRole) {
    if (ROLES.includes(currentRole)) {
      await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: currentRole }))
    }
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: newRole }))
  }

  if (body.role !== undefined || body.customerId !== undefined) {
    if (newRole === 'Customers') {
      let customerId = String(body.customerId || '').trim()
      if (!customerId) {
        try {
          customerId = await getCustomerIdForUsername(username)
        } catch {}
      }
      if (!customerId) throw Object.assign(new Error('Customer is required for customer users'), { statusCode: 400 })
      await requireActiveCustomer(customerId)
      await cognito.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: [{ Name: 'custom:customerId', Value: customerId }],
      }))
      return response(200, { username, role: newRole, customerId })
    }
    try {
      await cognito.send(new AdminDeleteUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributeNames: ['custom:customerId'],
      }))
    } catch {}
    return response(200, { username, role: newRole, customerId: '' })
  }

  if (body.enabled !== undefined) {
    const command = body.enabled
      ? new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
      : new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
    await cognito.send(command)
    return response(200, { username, enabled: body.enabled })
  }

  if (body.action === 'reset-password') {
    const temporaryPassword = String(body.temporaryPassword || '').trim()
    if (!temporaryPassword) throw Object.assign(new Error('Temporary password is required'), { statusCode: 400 })
    await cognito.send(new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      Password: temporaryPassword,
      Permanent: false,
    }))
    return response(200, { username, message: 'Temporary password set successfully. The user must change it at next login.' })
  }

  throw Object.assign(new Error('No supported update supplied'), { statusCode: 400 })
}

async function deleteUser(event, username) {
  requireRole(event, ['SuperAdmins'])
  await cognito.send(
    new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username })
  )
  return response(200, { username, deleted: true })
}

export async function handler(event) {
  // The same Lambda can be used for both API Gateway and Cognito Pre Sign-up.
  // Cognito trigger events have triggerSource; API Gateway events do not.
  if (event?.triggerSource?.startsWith('PreSignUp_')) {
    return handleCognitoPreSignUp(event)
  }

  try {
    const method = (event?.requestContext?.http?.method || event?.httpMethod || 'GET').toUpperCase()
    const path = event?.rawPath || event?.requestContext?.http?.path || event?.path || ''

    if (method === 'OPTIONS') return response(204, {})

    if (method === 'GET' && path.endsWith('/me')) {
      return getMyRegistrationStatus(event)
    }

    if (method === 'GET' && path.endsWith('/customers')) {
      return listCustomers(event)
    }

    if (method === 'POST' && path.endsWith('/customers')) {
      return createCustomer(event)
    }

    const customerDeleteMatch = path.match(/\/customers\/([^/]+)$/)
    if (method === 'DELETE' && customerDeleteMatch) {
      return deleteCustomer(event, decodeURIComponent(customerDeleteMatch[1]))
    }

    const assetImportMatch = path.match(/\/customers\/([^/]+)\/assets\/import$/)
    if (method === 'POST' && assetImportMatch) {
      return importCustomerAssets(event, decodeURIComponent(assetImportMatch[1]))
    }

    const assetMatch = path.match(/\/customers\/([^/]+)\/assets\/([^/]+)$/)
    if (assetMatch) {
      const customerId = decodeURIComponent(assetMatch[1])
      const serialNumber = decodeURIComponent(assetMatch[2])
      if (method === 'PATCH') return updateCustomerAsset(event, customerId, serialNumber)
      if (method === 'DELETE') return deleteCustomerAsset(event, customerId, serialNumber)
    }

    const customerAssetsMatch = path.match(/\/customers\/([^/]+)\/assets$/)
    if (customerAssetsMatch) {
      const customerId = decodeURIComponent(customerAssetsMatch[1])
      if (method === 'GET') return listCustomerAssets(event, customerId)
      if (method === 'POST') return createCustomerAsset(event, customerId)
    }

    if (method === 'POST' && path.endsWith('/tickets/validate-serial')) {
      return validateTicketSerial(event)
    }

    if (method === 'GET' && path.endsWith('/tickets')) {
      return response(200, await listTickets(event))
    }

    if (method === 'POST' && path.endsWith('/tickets')) {
      return createTicket(event)
    }

    const attachmentUploadMatch = path.match(/\/tickets\/([^/]+)\/attachments\/upload-url$/)
    if (method === 'POST' && attachmentUploadMatch) {
      return createAttachmentUploadUrl(event, decodeURIComponent(attachmentUploadMatch[1]))
    }

    const attachmentDirectMatch = path.match(/\/tickets\/([^/]+)\/attachments\/upload$/)
    if (method === 'POST' && attachmentDirectMatch) {
      return uploadAttachmentViaApi(event, decodeURIComponent(attachmentDirectMatch[1]))
    }

    const attachmentDownloadMatch = path.match(/\/tickets\/([^/]+)\/attachments\/([^/]+)\/download-url$/)
    if (method === 'GET' && attachmentDownloadMatch) {
      return downloadAttachment(event, decodeURIComponent(attachmentDownloadMatch[1]), decodeURIComponent(attachmentDownloadMatch[2]))
    }

    const attachmentRecordMatch = path.match(/\/tickets\/([^/]+)\/attachments$/)
    if (method === 'POST' && attachmentRecordMatch) {
      return recordAttachment(event, decodeURIComponent(attachmentRecordMatch[1]))
    }

    const ticketMatch = path.match(/\/tickets\/([^/]+)$/)
    if (ticketMatch) {
      const ticketIdValue = decodeURIComponent(ticketMatch[1])
      if (method === 'PATCH') return updateTicket(event, ticketIdValue)
      if (method === 'DELETE') return deleteTicket(event, ticketIdValue)
    }

    if (method === 'GET' && path.endsWith('/admin/users')) {
      return listUsers(event)
    }

    if (method === 'POST' && path.endsWith('/admin/users')) {
      return createUser(event)
    }

    const userMatch = path.match(/\/admin\/users\/([^/]+)$/)
    if (method === 'PATCH' && userMatch) {
      return updateUser(event, decodeURIComponent(userMatch[1]))
    }

    if (method === 'DELETE' && userMatch) {
      return deleteUser(event, decodeURIComponent(userMatch[1]))
    }

    return response(404, { message: 'Route not found' })
  } catch (error) {
    console.error('Lambda error:', error)
    return response(error?.statusCode || 500, {
      message: error?.message || 'Internal server error',
    })
  }
}
