import { fetchAuthSession } from 'aws-amplify/auth'
import { config } from './config'
import { validateTicketSerial as apiValidateTicketSerial } from './api'

const STORAGE_KEY = 'alteknetworks.portal.tickets.v1'

function localTickets() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function saveLocal(tickets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets))
}

async function authHeaders() {
  const session = await fetchAuthSession()
  const token = session.tokens?.accessToken?.toString()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function listTickets() {
  if (!config.apiBaseUrl) return localTickets()
  const response = await fetch(`${config.apiBaseUrl}/tickets`, { headers: await authHeaders() })
  if (!response.ok) throw new Error(`Unable to load tickets (${response.status})`)
  return response.json()
}

export async function createTicket(ticket) {
  if (!config.apiBaseUrl) {
    const newTicket = {
      ...ticket,
      id: `ALT-${Date.now().toString().slice(-7)}`,
      status: 'Open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    saveLocal([newTicket, ...localTickets()])
    return newTicket
  }
  const response = await fetch(`${config.apiBaseUrl}/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(ticket),
  })
  if (!response.ok) throw new Error(`Unable to create ticket (${response.status})`)
  return response.json()
}

export async function deleteTicket(id) {
  if (!config.apiBaseUrl) {
    const tickets = localTickets().filter((ticket) => ticket.id !== id)
    saveLocal(tickets)
    return { id, deleted: true }
  }
  const response = await fetch(`${config.apiBaseUrl}/tickets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { message: text } }
  if (!response.ok) throw new Error(data?.message || `Unable to delete ticket (${response.status})`)
  return data
}

export async function updateTicket(id, changes) {
  if (!config.apiBaseUrl) {
    const tickets = localTickets().map((ticket) =>
      ticket.id === id ? { ...ticket, ...changes, updatedAt: new Date().toISOString() } : ticket,
    )
    saveLocal(tickets)
    return tickets.find((ticket) => ticket.id === id)
  }
  const response = await fetch(`${config.apiBaseUrl}/tickets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(changes),
  })
  if (!response.ok) throw new Error(`Unable to update ticket (${response.status})`)
  return response.json()
}

async function apiJson(path, options = {}) {
  if (!config.apiBaseUrl) throw new Error('Admin API URL is not configured. Set VITE_API_BASE_URL in Amplify.')
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { message: text } }
  if (!response.ok) throw new Error(data?.message || `Request failed (${response.status})`)
  return data
}

export async function uploadTicketAttachment(id, file) {
  if (!file) return listTickets().then((items) => items.find((item) => item.id === id))
  if (file.size > 25 * 1024 * 1024) {
    throw new Error(`File ${file.name} exceeds the 25 MB attachment limit.`)
  }
  if (!config.apiBaseUrl) {
    const ticket = await updateTicket(id, {
      attachment: {
        id: `ATT-${Date.now()}`,
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        uploadedBy: 'Portal user',
        uploadedAt: new Date().toISOString(),
      },
    })
    return ticket
  }

  const prep = await apiJson(`/tickets/${encodeURIComponent(id)}/attachments/upload-url`, {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    }),
  })

  let uploadResponse
  try {
    // The presigned URL is intentionally not signed with Content-Type. This
    // avoids browser MIME normalization causing SignatureDoesNotMatch.
    const uploadHeaders = file.type
      ? { 'Content-Type': file.type }
      : {}
    uploadResponse = await fetch(prep.uploadUrl, {
      method: 'PUT',
      headers: uploadHeaders,
      body: file,
    })
  } catch (error) {
    // S3 CORS can fail before the browser exposes the PUT response. For files
    // up to 7 MB, fall back to the authenticated API so the attachment can
    // still be stored in S3 without relying on browser-to-S3 CORS.
    if (file.size <= 7 * 1024 * 1024) {
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = String(reader.result || '')
          resolve(result.includes(',') ? result.split(',')[1] : result)
        }
        reader.onerror = () => reject(new Error('Unable to read the selected file.'))
        reader.readAsDataURL(file)
      })

      try {
        return await apiJson(`/tickets/${encodeURIComponent(id)}/attachments/upload`, {
          method: 'POST',
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
            dataBase64,
          }),
        })
      } catch (fallbackError) {
        throw new Error(
          `Unable to upload ${file.name}. Direct S3 upload and API fallback both failed. ${fallbackError?.message || ''}`.trim()
        )
      }
    }

    const message = error?.message || 'Network/CORS error'
    throw new Error(
      `Unable to upload ${file.name}. S3 upload failed (${message}). Make sure the deployed backend created the attachment bucket and its CORS policy allows https://portal.alteknetworks.com.`
    )
  }
  if (!uploadResponse.ok) {
    let detail = ''
    try { detail = await uploadResponse.text() } catch {}
    throw new Error(`Unable to upload ${file.name}${detail ? `: ${detail}` : ` (HTTP ${uploadResponse.status})`}`)
  }

  return apiJson(`/tickets/${encodeURIComponent(id)}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ attachment: prep.attachment }),
  })
}

export async function getTicketAttachmentDownloadUrl(id, attachmentId) {
  if (!config.apiBaseUrl) return ''
  const result = await apiJson(
    `/tickets/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}/download-url`,
    { method: 'GET' },
  )
  return result.url
}

export async function validateTicketSerial(serialNumber, customerId = '', customerEmail = '') {
  return apiValidateTicketSerial(serialNumber, customerId, customerEmail)
}
