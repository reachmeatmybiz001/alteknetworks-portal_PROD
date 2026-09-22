import React, { useEffect, useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'

import {
  currentUser,
  authEvents,
  login,
  logout,
  confirmSignIn,
  register,
  confirmRegistration,
  resendRegistrationCode,
} from './auth'

import {
  createTicket,
  listTickets,
  updateTicket,
  deleteTicket,
  uploadTicketAttachment,
  getTicketAttachmentDownloadUrl,
  validateTicketSerial,
} from './ticketService'

import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  USER_ROLES,
  canManageUserRole,
} from './userService'

import {
  listCustomers,
  createCustomer,
  deleteCustomer,
  listCustomerAssets,
  createCustomerAsset,
  importCustomerAssets,
  updateCustomerAsset,
  deleteCustomerAsset,
  getMyRegistrationStatus,
} from './api'

import * as XLSX from 'xlsx'

import './styles.css'


const categories = [
  'Networking',
  'Security',
  'CCTV & Surveillance',
  'Cloud Infrastructure',
  'End User Computing',
  'Enterprise Computing',
  'Data Center',
  'AMC / Support',
  'Other',
]

const statuses = [
  'All',
  'Open',
  'Acknowledged',
  'In Progress',
  'Pending Customer',
  'Resolved',
  'Closed',
]

const ADMIN_ROLES = [
  'SupportAdmins',
  'SuperAdmins',
]


/* =========================================================
   LOGO
========================================================= */

function Logo({ compact = false }) {
  return (
    <img
      className={compact ? 'brand-logo compact' : 'brand-logo'}
      src="/alteknetworks-logo.png"
      alt="ALTEKNETWORKS IT Services"
    />
  )
}


/* =========================================================
   LOGIN
========================================================= */

function LoginScreen() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loginError, setLoginError] = useState(() => {
    try {
      const message = sessionStorage.getItem('alteknetworks_access_message') || ''
      if (message) sessionStorage.removeItem('alteknetworks_access_message')
      return message
    } catch { return '' }
  })
  const [notice, setNotice] = useState('')
  const [challenge, setChallenge] = useState('')

  const clearMessages = () => {
    setLoginError('')
    setNotice('')
  }

  const switchMode = (nextMode) => {
    clearMessages()
    setMode(nextMode)
    setChallenge('')
    setVerificationCode('')
  }

  const submit = async (e) => {
    e.preventDefault()
    clearMessages()
    if (!email.trim() || !password) {
      setLoginError('Please enter your email address and password.')
      return
    }
    setSubmitting(true)
    try {
      const nextStep = await login(email.trim(), password)
      if (nextStep?.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setChallenge('NEW_PASSWORD_REQUIRED')
        return
      }
      if (nextStep?.nextStep?.signInStep && nextStep.nextStep.signInStep !== 'DONE') {
        setLoginError('Additional account verification is required. Please complete the requested step.')
        return
      }
      window.location.reload()
    } catch (error) {
      const message = error?.message || 'Unable to sign in. Please check your email address and password.'
      if (message.includes('User is not confirmed')) {
        setLoginError('Please verify your email address with the OTP sent to you before signing in.')
      } else if (message.includes('Incorrect username or password')) {
        setLoginError('Incorrect email address or password. Please try again.')
      } else if (message.includes('User does not exist')) {
        setLoginError('No portal account was found for this email address.')
      } else {
        setLoginError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const [newPassword, setNewPassword] = useState('')

  const handleNewPassword = async (e) => {
    e.preventDefault()
    clearMessages()
    if (!newPassword || !confirmPassword) {
      setLoginError('Please enter and confirm your new password.')
      return
    }
    if (newPassword !== confirmPassword) {
      setLoginError('New password and confirm password do not match.')
      return
    }
    setSubmitting(true)
    try {
      await confirmSignIn({ challengeResponse: newPassword })
      setChallenge('')
      setNewPassword('')
      setConfirmPassword('')
      window.location.reload()
    } catch (error) {
      setLoginError(error?.message || 'Unable to set the new password. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const submitRegistration = async (e) => {
    e.preventDefault()
    clearMessages()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password || !confirmPassword) {
      setLoginError('Please complete all registration fields.')
      return
    }
    if (password !== confirmPassword) {
      setLoginError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      const result = await register(normalizedEmail, password)
      if (result?.nextStep?.signUpStep === 'CONFIRM_SIGN_UP') {
        setMode('verify')
        setNotice(`We sent a verification OTP to ${normalizedEmail}. Enter it below to verify your email.`)
      } else {
        setMode('login')
        setNotice('Registration submitted. Please sign in after your email is verified and your account is approved.')
      }
    } catch (error) {
      const message = error?.message || 'Unable to register this account.'
      if (message.includes('UsernameExistsException') || message.includes('already exists')) {
        setLoginError('An account with this email already exists. Try signing in or verify the email if registration is still pending.')
      } else {
        setLoginError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const submitVerification = async (e) => {
    e.preventDefault()
    clearMessages()
    if (!verificationCode.trim()) {
      setLoginError('Please enter the OTP sent to your email.')
      return
    }
    setSubmitting(true)
    try {
      await confirmRegistration(email.trim().toLowerCase(), verificationCode)
      setMode('login')
      setPassword('')
      setConfirmPassword('')
      setVerificationCode('')
      setNotice('Email verified successfully. Your registration is now pending approval by the Super Admin. You will be able to use the portal after your account is approved.')
    } catch (error) {
      setLoginError(error?.message || 'Unable to verify the email address. Please check the OTP and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const resendCode = async () => {
    clearMessages()
    setSubmitting(true)
    try {
      await resendRegistrationCode(email.trim().toLowerCase())
      setNotice('A new verification OTP has been sent to your email address.')
    } catch (error) {
      setLoginError(error?.message || 'Unable to resend the verification OTP.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand"><Logo /></div>
        <div className="login-copy">
          <span className="eyebrow">CUSTOMER SUPPORT PORTAL</span>
          <h1>{mode === 'register' ? 'Create your customer account' : mode === 'verify' ? 'Verify your email' : 'Welcome to your IT support portal'}</h1>
          <p>
            {mode === 'register'
              ? 'Register your email address to request access to the ALTEKNETWORKS support portal.'
              : mode === 'verify'
                ? 'Enter the one-time password sent to your email address.'
                : 'Sign in to raise service requests, track incidents and stay connected with the ALTEKNETWORKS support team.'}
          </p>
        </div>

        {loginError && <div className="login-error" role="alert">{loginError}</div>}
        {notice && <div className="login-notice" role="status">{notice}</div>}

        {mode === 'verify' ? (
          <form className="login-form" onSubmit={submitVerification}>
            <label>Email Address<input type="email" value={email} readOnly /></label>
            <label>Verification OTP<input inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} placeholder="Enter 6-digit OTP" maxLength={10} required autoFocus /></label>
            <button className="primary-button full" disabled={submitting}>{submitting ? 'Verifying…' : 'Verify Email'}</button>
            <div className="login-secondary-actions">
              <button type="button" className="text-button" onClick={resendCode} disabled={submitting}>Resend OTP</button>
              <button type="button" className="text-button" onClick={() => switchMode('login')}>Back to Sign In</button>
            </div>
          </form>
        ) : mode === 'register' ? (
          <form className="login-form" onSubmit={submitRegistration}>
            <label>Email Address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="username" required /></label>
            <label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" autoComplete="new-password" required /><button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
            <label>Confirm Password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm your password" autoComplete="new-password" required /></label>
            <button className="primary-button full" disabled={submitting}>{submitting ? 'Registering…' : 'Create Customer Account'}</button>
            <p className="login-help">Anyone can register with a valid email address. After registration, verify the OTP sent to your email. Your registration will then be marked <strong>Pending Approval with Admin</strong> until a Super Admin approves it.</p>
            <button type="button" className="text-button" onClick={() => switchMode('login')}>Already registered? Sign In</button>
          </form>
        ) : challenge === 'NEW_PASSWORD_REQUIRED' ? (
          <form className="login-form" onSubmit={handleNewPassword}>
            <label>New Password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter a new password" autoComplete="new-password" autoFocus required /></label>
            <label>Confirm New Password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm your new password" autoComplete="new-password" required /></label>
            <button className="primary-button full" disabled={submitting}>{submitting ? 'Updating…' : 'Set New Password'}</button>
          </form>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <label>Email Address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="username" autoFocus required /></label>
            <label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" required /><button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
            <button className="primary-button full" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign In'}</button>
            <div className="login-divider"><span>Customer access</span></div>
            <button type="button" className="secondary-button full" onClick={() => switchMode('register')}>Create Customer Account</button>
            <p className="login-help">New customer? Register with your email address, verify the OTP, and wait for Super Admin approval. Only approved customer accounts can access the portal.</p>
          </form>
        )}
      </div>
    </div>
  )
}


function ApprovalPendingScreen({ user, rejected = false, errorMessage = '', onRefresh }) {
  return (
    <div className="login-page">
      <div className="login-card approval-card">
        <div className="login-brand"><Logo /></div>
        <div className="login-copy">
          <span className="eyebrow">CUSTOMER ACCOUNT</span>
          <h1>{rejected ? 'Registration not approved' : errorMessage ? 'Account status unavailable' : 'Approval pending'}</h1>
          <p>
            {rejected
              ? 'Your customer portal registration was not approved. Please contact ALTEKNETWORKS support for assistance.'
              : errorMessage
                ? errorMessage
                : 'Your email has been verified. Your registration is now Pending Approval with Admin. A Super Admin must review your registration and assign your company account before you can use the support portal.'}
          </p>
        </div>
        {!rejected && !errorMessage && (
          <div className="approval-status-box">
            <strong>{user?.email}</strong>
            <span>Email verified · Waiting for Super Admin approval</span>
          </div>
        )}
        {!rejected && onRefresh && <button className="secondary-button full" onClick={onRefresh}>Check Approval Status</button>}
        <button className="text-button" style={{ width: '100%', marginTop: '14px' }} onClick={logout}>Sign out</button>
      </div>
    </div>
  )
}


/* =========================================================
   APP
========================================================= */

function displayTicketNumber(ticket) {
  return ticket?.ticketNumber !== undefined && ticket?.ticketNumber !== null
    ? String(ticket.ticketNumber)
    : ticket?.id || ''
}

function App() {
  const [user, setUser] =
    useState(undefined)

  const [tickets, setTickets] =
    useState([])

  const [view, setView] =
    useState('dashboard')

  const [adminView, setAdminView] =
    useState('tickets')

  const [loadingTickets, setLoadingTickets] =
    useState(false)

  const [loadingUsers, setLoadingUsers] =
    useState(false)

  const [users, setUsers] =
    useState([])

  const [customers, setCustomers] =
    useState([])

  const [registration, setRegistration] =
    useState(undefined)

  const [accessMessage, setAccessMessage] =
    useState(() => {
      try { return sessionStorage.getItem('alteknetworks_access_message') || '' } catch { return '' }
    })

  const [error, setError] =
    useState('')

  const [notice, setNotice] =
    useState('')

  const refreshUser = async () => {
    setUser(await currentUser())
  }

  useEffect(() => {

    refreshUser()

    const unsubscribe =
      authEvents(({ payload }) => {

        if (
          payload.event === 'signedIn'
        ) {
          refreshUser()
        }

        if (
          payload.event === 'signedOut'
        ) {
          setUser(null)
        }

      })

    return unsubscribe

  }, [])


  useEffect(() => {
    if (!user) {
      setRegistration(null)
      return
    }
    setRegistration(undefined)
    getMyRegistrationStatus()
      .then(async (status) => {
        setRegistration(status)
        // Authentication alone is not portal access. Customers must be approved.
        // Admin roles are considered approved by the backend as well.
        if (status?.approvalStatus !== 'Approved') {
          const message = status?.approvalStatus === 'Rejected'
            ? 'Your registration was not approved. Please contact ALTEKNETWORKS support.'
            : status?.approvalStatus === 'EmailVerificationPending'
              ? 'Please verify your email address before accessing the portal.'
              : 'Your registration is pending Super Admin approval. Only approved customer accounts can access the portal.'
          try { sessionStorage.setItem('alteknetworks_access_message', message) } catch {}
          setAccessMessage(message)
          await logout()
        } else {
          try { sessionStorage.removeItem('alteknetworks_access_message') } catch {}
          setAccessMessage('')
        }
      })
      .catch((e) => {
        const message = e?.message || 'Unable to check account approval status.'
        setRegistration({ approvalStatus: 'Error', message })
      })
  }, [user])


  useEffect(() => {

    if (!user || registration?.approvalStatus !== 'Approved') return

    setLoadingTickets(true)

    setError('')

    listTickets()
      .then((items) => {
        const list = Array.isArray(items) ? items : []
        // Defense-in-depth UI filtering. customerId may be shared by multiple
        // portal users under the same company, so customer users are scoped to
        // their own authenticated email/owner identity. The backend is the
        // authoritative security boundary.
        if (!isAdmin && registration?.email) {
          const email = String(registration.email).trim().toLowerCase()
          setTickets(list.filter((ticket) =>
            String(ticket.customerEmail || ticket.customerUserEmail || ticket.createdByEmail || ticket.createdBy || '')
              .trim().toLowerCase() === email
          ))
        } else {
          setTickets(list)
        }
      })
      .catch((e) =>
        setError(e.message)
      )

      .finally(() =>
        setLoadingTickets(false)
      )

  }, [user, registration?.approvalStatus])


  const isAdmin =
    user?.groups?.some(
      (group) =>
        ADMIN_ROLES.includes(group)
    )


  const isSuperAdmin =
    user?.groups?.includes(
      'SuperAdmins'
    )




  const isSupportAdmin =
    user?.groups?.includes(
      'SupportAdmins'
    )


  const actorRole =
    isSuperAdmin
      ? 'SuperAdmins'
      : isSupportAdmin
        ? 'SupportAdmins'
        : 'Customers'


  /* =======================================================
     CREATE TICKET
  ======================================================= */

  const handleCreate = async (payload) => {
    setError('')

    try {
      const files = Array.isArray(payload?.files) ? payload.files : []
      const { files: _files, ...ticketPayload } = payload || {}

      const ticket = await createTicket({
        ...ticketPayload,
        customerEmail: isAdmin ? ticketPayload.customerEmail : user.email,
      })

      let finalTicket = ticket
      for (const file of files) {
        finalTicket = await uploadTicketAttachment(ticket.id, file)
      }

      setTickets((current) => [
        finalTicket,
        ...current,
      ])

      setNotice(`Ticket ${displayTicketNumber(ticket)} created successfully.`)
      setView('tickets')
    } catch (error) {
      setError(error?.message || 'Unable to create ticket.')
      throw error
    }
  }


  /* =======================================================
     UPDATE TICKET
  ======================================================= */

  const handleUpdate = async (
    id,
    changes
  ) => {

    setError('')

    try {

      const updated =
        await updateTicket(
          id,
          changes
        )

      setTickets(
        (current) =>
          current.map(
            (ticket) =>
              ticket.id === id
                ? updated
                : ticket
          )
      )

    } catch (error) {

      setError(
        error?.message ||
        'Unable to update ticket.'
      )

      throw error

    }
  }


  /* =======================================================
     DELETE TICKET (SUPER ADMIN ONLY)
  ======================================================= */

  const handleDeleteTicket = async (id, ticketNumber) => {
    if (!isSuperAdmin) {
      setError('Only Super Admins can delete tickets.')
      return
    }

    const confirmed = window.confirm(
      `Are you Sure to Delete?\n\nTicket: ${ticketNumber || id}\n\nThis action cannot be undone.`
    )
    if (!confirmed) return

    setError('')
    try {
      await deleteTicket(id)
      setTickets((current) => current.filter((ticket) => ticket.id !== id))
      setNotice(`Ticket ${ticketNumber || id} deleted successfully.`)
    } catch (error) {
      setError(error?.message || 'Unable to delete ticket.')
    }
  }


  /* =======================================================
     LOAD CUSTOMERS
  ======================================================= */

  const loadCustomers = async () => {
    if (!isSuperAdmin) return
    try {
      const result = await listCustomers()
      setCustomers(Array.isArray(result) ? result : [])
    } catch (error) {
      setError(error?.message || 'Unable to load customers.')
    }
  }


  /* =======================================================
     LOAD USERS
  ======================================================= */

  const loadUsers = async () => {

    if (!isSuperAdmin) return

    setLoadingUsers(true)
    setError('')

    try {

      const result =
        await listUsers()

      setUsers(
        Array.isArray(result)
          ? result
          : []
      )

    } catch (error) {

      setError(
        error?.message ||
        'Unable to load users.'
      )

    } finally {

      setLoadingUsers(false)
    }
  }


  /* =======================================================
     CREATE USER
  ======================================================= */

  const handleCreateUser = async (
    payload
  ) => {

    setError('')

    try {

      await createUser(payload)

      setNotice(
        `User ${payload.email} created successfully.`
      )

      await loadUsers()

    } catch (error) {

      setError(
        error?.message ||
        'Unable to create user.'
      )

      throw error
    }
  }


  /* =======================================================
     UPDATE USER
  ======================================================= */

  const handleUpdateUser = async (
    username,
    changes
  ) => {

    setError('')

    try {

      await updateUser(
        username,
        changes
      )

      if (changes?.resetPassword) {
        setNotice(
          'Temporary password set successfully. The user must change it at next login.'
        )
      } else if (changes?.enabled === false) {
        setNotice('User disabled successfully.')
      } else if (changes?.enabled === true) {
        setNotice('User enabled successfully.')
      } else if (changes?.action === 'approve') {
        setNotice('Customer registration approved successfully.')
      } else if (changes?.action === 'reject') {
        setNotice('Customer registration rejected and the account was disabled.')
      } else if (changes?.action === 'approve') {
        setNotice('Customer registration approved successfully.')
      } else if (changes?.action === 'reject') {
        setNotice('Customer registration rejected and the account was disabled.')
      } else if (changes?.role) {
        setNotice('User role updated successfully.')
      } else {
        setNotice('User updated successfully.')
      }

      await loadUsers()
      return true

    } catch (error) {

      setError(
        error?.message ||
        'Unable to update user.'
      )
      return false
    }
  }


  /* =======================================================
     DELETE USER
  ======================================================= */

  const handleDeleteUser = async (
    username,
    email
  ) => {

    if (!isSuperAdmin) {
      setError(
        'Only SuperAdmins can delete users.'
      )
      return
    }

    const confirmed =
      window.confirm(
        `Delete user ${email}? This action cannot be undone.`
      )

    if (!confirmed) return

    setError('')

    try {

      await deleteUser(username)

      setNotice(
        `User ${email} deleted successfully.`
      )

      await loadUsers()

    } catch (error) {

      setError(
        error?.message ||
        'Unable to delete user.'
      )
    }
  }


  if (user === undefined) {

    return (
      <div className="loading-screen">
        Loading secure portal…
      </div>
    )
  }


  if (!user) {
    return <LoginScreen />
  }

  if (!registration) {
    return <div className="loading-screen">Checking account approval…</div>
  }

  if (registration.approvalStatus === 'PendingApproval') {
    return <ApprovalPendingScreen user={user} onRefresh={async () => setRegistration(await getMyRegistrationStatus())} />
  }

  if (registration.approvalStatus === 'Rejected') {
    return <ApprovalPendingScreen user={user} rejected />
  }

  if (registration.approvalStatus === 'Error') {
    return <ApprovalPendingScreen user={user} errorMessage={registration.message} onRefresh={async () => setRegistration(await getMyRegistrationStatus())} />
  }


  const openCount =
    tickets.filter(
      (t) =>
        ![
          'Resolved',
          'Closed',
        ].includes(t.status)
    ).length


  const resolvedCount =
    tickets.filter(
      (t) =>
        [
          'Resolved',
          'Closed',
        ].includes(t.status)
    ).length


  return (

    <div className="app-shell">

      <header className="topbar">

        <div className="topbar-inner">

          <Logo compact />

          <nav>

            <button
              className={
                view === 'dashboard'
                  ? 'nav-active'
                  : ''
              }
              onClick={() =>
                setView('dashboard')
              }
            >
              Dashboard
            </button>


            <button
              className={
                view === 'tickets'
                  ? 'nav-active'
                  : ''
              }
              onClick={() =>
                setView('tickets')
              }
            >
              My Tickets
            </button>


            {isAdmin && (

              <button
                className={
                  view === 'admin'
                    ? 'nav-active'
                    : ''
                }
                onClick={() => {

                  setView('admin')

                  if (isSuperAdmin) {
                    if (users.length === 0) loadUsers()
                    if (customers.length === 0) loadCustomers()
                  }

                }}
              >
                Admin
              </button>

            )}

          </nav>


          <div className="user-menu">

            <div>

              <strong>
                {user.email ||
                  user.username}
              </strong>

              <span>
                {isSuperAdmin
                  ? 'Super Administrator'
                  : isSupportAdmin
                    ? 'Support Administrator'
                    : 'Customer'}
              </span>

            </div>


            <button
              onClick={logout}
            >
              Sign out
            </button>

          </div>

        </div>

      </header>


      <main className="content">

        {notice && (

          <div className="notice">

            {notice}

            <button
              onClick={() =>
                setNotice('')
              }
            >
              ×
            </button>

          </div>

        )}


        {error && (

          <div className="error-banner">

            {error}

            <button
              onClick={() =>
                setError('')
              }
            >
              ×
            </button>

          </div>

        )}


        {view === 'dashboard' && (

          <Dashboard
            user={user}
            openCount={openCount}
            resolvedCount={resolvedCount}
            tickets={tickets}
            loading={loadingTickets}
            onNew={() =>
              setView('new')
            }
            onTickets={() =>
              setView('tickets')
            }
            isAdmin={isAdmin}
            onExport={() => exportTicketsToExcel(tickets)}
          />

        )}


        {view === 'tickets' && (

          <Tickets
            tickets={tickets}
            loading={loadingTickets}
            isAdmin={isAdmin}
            onNew={() =>
              setView('new')
            }
            onUpdate={handleUpdate}
            canDeleteTickets={isSuperAdmin}
            onDeleteTicket={handleDeleteTicket}
          />

        )}


        {view === 'new' && (

          <NewTicket
            isAdmin={isAdmin}
            onCancel={() =>
              setView('dashboard')
            }
            onCreate={handleCreate}
          />

        )}


        {view === 'admin' &&
          isAdmin && (

            <AdminPanel
              tickets={tickets}
              onUpdate={handleUpdate}
              canDeleteTickets={isSuperAdmin}
              onDeleteTicket={handleDeleteTicket}
              adminView={adminView}
              setAdminView={setAdminView}
              users={users}
              loadingUsers={loadingUsers}
              onLoadUsers={loadUsers}
              onCreateUser={handleCreateUser}
              onUpdateUser={handleUpdateUser}
              onDeleteUser={handleDeleteUser}
              actorRole={actorRole}
              isSuperAdmin={isSuperAdmin}
              customers={customers}
              onLoadCustomers={loadCustomers}
              onCreateCustomer={async (payload) => {
                const result = await createCustomer(payload)
                await loadCustomers()
                return result
              }}
              onDeleteCustomer={async (customerId) => {
                const result = await deleteCustomer(customerId)
                await loadCustomers()
                return result
              }}
              onListAssets={listCustomerAssets}
              onCreateAsset={createCustomerAsset}
              onImportAssets={importCustomerAssets}
              onUpdateAsset={updateCustomerAsset}
              onDeleteAsset={deleteCustomerAsset}
            />

          )}

      </main>


      <footer>
        © {new Date().getFullYear()}
        {' '}
        ALTEKNETWORKS IT Services
        {' · '}
        Your Complete IT Infrastructure Partner
      </footer>

    </div>
  )
}


/* =========================================================
   DASHBOARD
========================================================= */

function Dashboard({
  user,
  openCount,
  resolvedCount,
  tickets,
  loading,
  onNew,
  onTickets,
  isAdmin = false,
  onExport,
}) {

  return (

    <>

      <section className="hero-card">

        <div>

          <span className="eyebrow">
            {isAdmin ? 'ADMIN DASHBOARD' : 'CUSTOMER DASHBOARD'}
          </span>

          <h1>
            Hello,{' '}
            {user.email?.split('@')[0] ||
              'Customer'}
            .
          </h1>

          <p>
            Manage your IT support requests
            and keep track of every service
            interaction from one place.
          </p>

          <div className="dashboard-actions">
            <button
              className="primary-button"
              onClick={onNew}
            >
              + Raise a new ticket
            </button>
            {isAdmin && (
              <button
                type="button"
                className="secondary-button"
                onClick={onExport}
                disabled={!tickets.length}
              >
                Export Excel Report
              </button>
            )}
          </div>

        </div>


        <div className="hero-art">

          <div className="orb">
            IT
          </div>

        </div>

      </section>


      <div className="stats-grid">

        <Stat
          label="Open tickets"
          value={openCount}
          onClick={onTickets}
        />

        <Stat
          label="Resolved / Closed"
          value={resolvedCount}
          onClick={onTickets}
        />

        <Stat
          label="Total tickets"
          value={tickets.length}
          onClick={onTickets}
        />

      </div>

      {loading && (
        <div className="empty-card dashboard-loading">
          Loading ticket summary…
        </div>
      )}

    </>
  )
}


/* =========================================================
   STAT
========================================================= */

function Stat({
  label,
  value,
  onClick,
}) {

  return (
    <a
      href="#my-tickets"
      className="stat-card stat-card-link"
      onClick={(event) => {
        event.preventDefault()
        onClick()
      }}
      aria-label={`${label}: ${value}. Open My Tickets.`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </a>
  )
}


/* =========================================================
   TICKETS
========================================================= */

function Tickets({
  tickets,
  loading,
  isAdmin,
  onNew,
  onUpdate,
  canDeleteTickets = false,
  onDeleteTicket,
}) {

  const [filter, setFilter] =
    useState('All')


  const filtered =
    useMemo(
      () =>
        filter === 'All'
          ? tickets
          : tickets.filter(
              (t) =>
                t.status === filter
            ),
      [filter, tickets]
    )


  return (

    <>

      <section className="section-head page-head">

        <div>

          <span className="eyebrow">
            SUPPORT REQUESTS
          </span>

          <h1>
            {isAdmin
              ? 'All Tickets'
              : 'My Tickets'}
          </h1>

          <p>
            Search, filter and track
            support requests.
          </p>

        </div>


        <button
          className="primary-button"
          onClick={onNew}
        >
          + New ticket
        </button>

      </section>


      <div className="filter-row">

        {statuses.map(
          (status) => (

            <button
              key={status}
              className={
                filter === status
                  ? 'filter-active'
                  : ''
              }
              onClick={() =>
                setFilter(status)
              }
            >
              {status}
            </button>

          )
        )}

      </div>


      {loading ? (

        <div className="empty-card">
          Loading tickets…
        </div>

      ) : filtered.length ? (

        <TicketTable
          tickets={filtered}
          admin={isAdmin}
          onUpdate={onUpdate}
          canDeleteTickets={canDeleteTickets}
          onDeleteTicket={onDeleteTicket}
        />

      ) : (

        <div className="empty-card">
          No tickets match this filter.
        </div>

      )}

    </>
  )
}


/* =========================================================
   TICKET TABLE
========================================================= */

function TicketTable({
  tickets,
  admin = false,
  onUpdate,
  canDeleteTickets = false,
  onDeleteTicket,
}) {

  const [selectedId, setSelectedId] =
    useState(null)

  const selectedTicket =
    tickets.find((ticket) =>
      ticket.id === selectedId
    ) || null

  const openTicket = (id) => {
    setSelectedId(id)
  }

  const closeDetails = () => {
    setSelectedId(null)
  }

  return (

    <>

      <div className="table-card">

        <div className={`ticket-table ${canDeleteTickets ? "admin-ticket-table" : ""}`} >

          <div className="table-row table-head">
            <span>Ticket</span>
            <span>Subject</span>
            <span>Created</span>
            <span>Created By</span>
            <span>Priority</span>
            <span>Status</span>
            <span>Updated</span>
            <span>Updated By</span>
            {canDeleteTickets && <span>Action</span>}
          </div>


          {tickets.map(
            (t) => (

              <div
                className={`table-row ${selectedId === t.id ? 'ticket-row-selected' : ''}`}
                key={t.id}
              >

                <span className="ticket-id">
                  <button
                    type="button"
                    className="ticket-link"
                    onClick={() => openTicket(t.id)}
                    aria-label={`Open ticket ${displayTicketNumber(t)}`}
                  >
                    {displayTicketNumber(t)}
                  </button>
                </span>


                <span>

                  <strong>
                    {t.subject}
                  </strong>

                  <small>
                    {t.category}
                  </small>

                </span>

                <span>
                  {t.createdAt
                    ? new Date(t.createdAt).toLocaleString()
                    : '—'}
                </span>

                <span>
                  <strong>{formatIdentity(
                    t.createdByEmail || t.createdByUsername || t.createdBy || t.customerEmail,
                    '—'
                  )}</strong>
                  {t.createdByRole && (
                    <small>{t.createdByRole}</small>
                  )}
                </span>

                <span>
                  <Priority
                    value={t.priority}
                  />
                </span>

                <span>
                  <Status
                    value={t.status}
                  />
                </span>

                <span>
                  {t.updatedAt || t.createdAt
                    ? new Date(
                        t.updatedAt || t.createdAt
                      ).toLocaleString()
                    : '—'}
                </span>

                <span>
                  {formatIdentity(
                    t.updatedByEmail || t.updatedByUsername || t.updatedBy,
                    '—'
                  )}
                </span>

                {canDeleteTickets && (
                  <span>
                    <button
                      type="button"
                      className="secondary-button small-button"
                      onClick={() => onDeleteTicket?.(t.id, displayTicketNumber(t))}
                    >
                      Delete
                    </button>
                  </span>
                )}


              </div>

            )
          )}

        </div>

      </div>


      {selectedTicket && onUpdate && (

        <TicketProcessingPanel
          ticket={selectedTicket}
          onUpdate={onUpdate}
          onClose={closeDetails}
          admin={admin}
          canDeleteTicket={canDeleteTickets}
          onDeleteTicket={onDeleteTicket}
        />

      )}

    </>
  )
}


function formatIdentity(value, fallback = '—') {
  const text = String(value || '').trim()
  if (!text) return fallback

  // Never expose raw Cognito UUID/sub values in the portal UI.
  // The backend normally resolves these to an email address; this is a safe
  // frontend fallback for older records or during a partial deployment.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
  if (isUuid) return 'Portal user'

  return text
}

/* =========================================================
   TICKET PROCESSING
========================================================= */

function TicketProcessingPanel({
  ticket,
  onUpdate,
  onClose,
  admin = false,
  canDeleteTicket = false,
  onDeleteTicket,
}) {
  const [priority, setPriority] = useState(ticket.priority || 'Medium')
  const [status, setStatus] = useState(ticket.status || 'Open')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [downloadBusy, setDownloadBusy] = useState('')
  const isClosed = ticket.status === 'Closed'

  useEffect(() => {
    setPriority(ticket.priority || 'Medium')
    setStatus(ticket.status || 'Open')
  }, [ticket.id, ticket.priority, ticket.status])

  const saveChanges = async () => {
    const changes = {}
    if (priority !== ticket.priority) changes.priority = priority
    if (status !== ticket.status) changes.status = status
    if (comment.trim()) changes.comment = comment.trim()

    if (!Object.keys(changes).length) return

    setSaving(true)
    try {
      await onUpdate(ticket.id, changes)
      setComment('')
    } finally {
      setSaving(false)
    }
  }

  const saveAttachments = async () => {
    if (!files.length) return
    setUploadError('')
    setUploading(true)
    try {
      for (const file of files) {
        await uploadTicketAttachment(ticket.id, file)
      }
      setFiles([])
      await onUpdate(ticket.id, {})
    } catch (error) {
      setUploadError(error?.message || 'Unable to upload the attachment. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const downloadAttachment = async (attachment) => {
    setDownloadBusy(attachment.id || attachment.key || attachment.name)
    try {
      const url = await getTicketAttachmentDownloadUrl(ticket.id, attachment.id || attachment.key)
      window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setDownloadBusy('')
    }
  }

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape' && !saving && !uploading) onClose?.()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose, saving, uploading])

  return (
    <div
      className="ticket-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving && !uploading) onClose?.()
      }}
    >
      <section
        className="ticket-processing-card ticket-processing-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-processing-title"
      >
      <div className="ticket-processing-head">
        <div>
          <span className="eyebrow">{admin ? 'TICKET PROCESSING' : 'TICKET DETAILS'}</span>
          <h2 id="ticket-processing-title">{displayTicketNumber(ticket)} — {ticket.subject}</h2>
          <p>Customer: <strong>{formatIdentity(ticket.customerEmail, '—')}</strong></p>
        </div>
        <button type="button" className="secondary-button" onClick={onClose} disabled={saving || uploading}>Close panel</button>
      </div>

      <div className="ticket-processing-meta">
        <div><span>Created by</span><strong>{formatIdentity(ticket.createdByEmail || ticket.createdByUsername || ticket.createdBy || ticket.customerEmail, '—')}</strong></div>
        <div><span>Created</span><strong>{ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : '—'}</strong></div>
        <div><span>Updated by</span><strong>{formatIdentity(ticket.updatedByEmail || ticket.updatedByUsername || ticket.updatedBy, '—')}</strong></div>
        <div><span>Time to close</span><strong>{typeof ticket.timeSpentMinutes === 'number' ? `${Math.floor(ticket.timeSpentMinutes / 60)}h ${ticket.timeSpentMinutes % 60}m` : ticket.status === 'Closed' ? '—' : 'Not closed'}</strong></div>
      </div>

      <div className="ticket-processing-description">
        <span className="processing-label">Description</span>
        <p>{ticket.description || '—'}</p>
      </div>

      <div className="ticket-processing-form">
        <label>Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value)} disabled={saving || uploading || isClosed}>
            <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
          </select>
        </label>
        <label>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={saving || uploading || isClosed}>
            <option>Open</option><option>Acknowledged</option><option>In Progress</option><option>Pending Customer</option><option>Resolved</option><option>Closed</option>
          </select>
          <small>Set status to Closed here to close the ticket.</small>
        </label>
        <label className="comment-field">Add Comment
          <textarea rows="4" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Enter an update for the customer or internal processing note." disabled={saving || uploading || isClosed} />
        </label>
      </div>

      <div className="attachment-box">
        <span className="processing-label">Attachments</span>
        <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} disabled={saving || uploading || isClosed} />
        {files.length > 0 && <div className="selected-files">{files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}</div>}
        {uploadError && <div className="upload-error">{uploadError}</div>}
        {files.length > 0 && (
          <button type="button" className="secondary-button small-button" onClick={saveAttachments} disabled={uploading || saving || isClosed}>
            {uploading ? 'Uploading…' : 'Upload Files'}
          </button>
        )}
        {Array.isArray(ticket.attachments) && ticket.attachments.length > 0 && (
          <div className="attachment-list">
            {ticket.attachments.map((attachment) => (
              <div className="attachment-item" key={attachment.id || attachment.key || attachment.name}>
                <span>{attachment.name || attachment.fileName || 'Attachment'}</span>
                <button type="button" className="text-button" onClick={() => downloadAttachment(attachment)} disabled={downloadBusy === (attachment.id || attachment.key || attachment.name)}>
                  {downloadBusy === (attachment.id || attachment.key || attachment.name) ? 'Opening…' : 'Download'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {Array.isArray(ticket.comments) && ticket.comments.length > 0 && (
        <div className="ticket-comments">
          <span className="processing-label">Comments</span>
          {ticket.comments.map((item) => (
            <div className="comment-item" key={item.id || `${item.createdAt}-${item.createdBy}`}>
              <div><strong>{item.createdByEmail || item.createdByUsername || item.createdBy || 'Portal user'}</strong><small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</small></div>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      )}

      {isClosed && (
        <div className="closed-ticket-note">This ticket is closed. No further ticket changes are allowed.</div>
      )}

      <div className="ticket-processing-actions">
        {canDeleteTicket && (
          <button
            type="button"
            className="danger-button"
            onClick={() => onDeleteTicket?.(ticket.id, displayTicketNumber(ticket))}
            disabled={saving || uploading}
          >
            Delete Ticket
          </button>
        )}
        <span className="ticket-processing-actions-spacer" />
        <button type="button" className="secondary-button" onClick={onClose} disabled={saving || uploading}>Cancel</button>
        <button type="button" className="primary-button" onClick={saveChanges} disabled={saving || uploading || (!comment.trim() && priority === ticket.priority && status === ticket.status)}>
          {saving ? 'Saving…' : 'Update Ticket'}
        </button>
      </div>
      </section>
    </div>
  )
}


/* =========================================================
   PRIORITY / STATUS
========================================================= */

function Priority({
  value,
}) {

  return (

    <span
      className={`priority ${String(
        value
      ).toLowerCase()}`}
    >
      {value}
    </span>

  )
}


function Status({
  value,
}) {

  return (

    <span
      className={`status ${String(
        value
      )
        .toLowerCase()
        .replaceAll(' ', '-')}`}
    >
      {value}
    </span>

  )
}


/* =========================================================
   NEW TICKET
========================================================= */

function NewTicket({
  isAdmin = false,
  onCancel,
  onCreate,
}) {

  const [form, setForm] =
    useState({
      customerEmail: '',
      serialNumber: '',
      subject: '',
      category: categories[0],
      priority: 'Medium',
      description: '',
      files: [],
    })


  const [saving, setSaving] =
    useState(false)

  const [serialAsset, setSerialAsset] = useState(null)
  const [serialChecking, setSerialChecking] = useState(false)
  const [serialError, setSerialError] = useState('')

  const checkSerial = async () => {
    if (isAdmin && !form.customerEmail.trim()) {
      setSerialAsset(null)
      setSerialError('Enter the customer email address before validating the asset.')
      return
    }
    if (!form.serialNumber.trim()) {
      setSerialAsset(null)
      setSerialError('Serial number is required.')
      return
    }
    setSerialChecking(true)
    setSerialError('')
    try {
      const result = await validateTicketSerial(form.serialNumber.trim(), '', isAdmin ? form.customerEmail.trim() : '')
      if (result?.valid === false) {
        setSerialAsset(null)
        setSerialError(result.message || 'Asset serial number is not registered for your account.')
        return
      }
      setSerialAsset(result)
    } catch (error) {
      setSerialAsset(null)
      setSerialError(error?.message || 'Asset serial number is not registered for your account.')
    } finally {
      setSerialChecking(false)
    }
  }


  const submit = async (e) => {

    e.preventDefault()

    if (!form.subject.trim() || !form.description.trim()) return
    if (!isAdmin && (!form.serialNumber.trim() || !serialAsset)) {
      await checkSerial()
      return
    }

    setSaving(true)

    try {

      await onCreate(form)

    } finally {

      setSaving(false)
    }
  }


  return (

    <section className="form-page">

      <div className="section-head page-head">

        <div>

          <span className="eyebrow">
            SUPPORT REQUEST
          </span>

          <h1>
            Raise a new ticket
          </h1>

          <p>
            Tell us what you need help with.
            Our support team will review the
            request and update the ticket.
          </p>

        </div>

      </div>


      <form
        className="form-card"
        onSubmit={submit}
      >

        {isAdmin && (
          <label>
            Customer Email
            <input
              type="email"
              value={form.customerEmail}
              onChange={(e) =>
                setForm({
                  ...form,
                  customerEmail: e.target.value,
                })
              }
              placeholder="customer@company.com"
              required
            />
            <small>Support Admins and Super Admins can create tickets on behalf of a customer.</small>
          </label>
        )}

        <div className="form-grid">

          <label>
            Asset Serial Number
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={form.serialNumber}
                onChange={(e) => { setForm({ ...form, serialNumber: e.target.value }); setSerialAsset(null); setSerialError('') }}
                onBlur={() => { if (form.serialNumber.trim() && !isAdmin) checkSerial() }}
                placeholder="Enter the device serial number"
                required={!isAdmin}
              />
              <button type="button" className="secondary-button" onClick={checkSerial} disabled={serialChecking}>
                {serialChecking ? 'Checking…' : 'Validate'}
              </button>
            </div>
            {serialError && <small style={{ color: '#b42318' }}>{serialError}</small>}
            {serialAsset && (
              <small>Valid asset: {serialAsset.product || '—'} · {serialAsset.manufacturer || '—'} · {serialAsset.model || '—'}</small>
            )}
          </label>

          <label>

            Subject

            <input
              value={form.subject}
              onChange={(e) =>
                setForm({
                  ...form,
                  subject:
                    e.target.value,
                })
              }
              placeholder="Briefly describe the issue"
              required
            />

          </label>


          {isAdmin && (
            <label>

              Category

              <select
                value={form.category}
                onChange={(e) =>
                  setForm({
                    ...form,
                    category:
                      e.target.value,
                  })
                }
              >

                {categories.map(
                  (c) => (
                    <option key={c}>
                      {c}
                    </option>
                  )
                )}

              </select>

            </label>
          )}


          <label>

            Priority

            <select
              value={form.priority}
              onChange={(e) =>
                setForm({
                  ...form,
                  priority:
                    e.target.value,
                })
              }
            >

              <option>
                Low
              </option>

              <option>
                Medium
              </option>

              <option>
                High
              </option>

              <option>
                Critical
              </option>

            </select>

          </label>

        </div>


        <label>

          Description

          <textarea
            value={form.description}
            onChange={(e) =>
              setForm({
                ...form,
                description:
                  e.target.value,
              })
            }
            rows="7"
            placeholder="Provide the details, error message, affected device/service, and any useful troubleshooting already completed."
            required
          />

        </label>

        <label>
          Attach Files
          <input
            type="file"
            multiple
            onChange={(e) =>
              setForm({
                ...form,
                files: Array.from(e.target.files || []),
              })
            }
          />
          <small>Attach screenshots, logs, documents or other files relevant to the ticket.</small>
          {form.files.length > 0 && (
            <div className="selected-files">
              {form.files.map((file) => (
                <span key={`${file.name}-${file.size}`}>{file.name}</span>
              ))}
            </div>
          )}
        </label>

        <div className="form-actions">

          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
          >
            Cancel
          </button>


          <button
            className="primary-button"
            disabled={saving}
          >
            {saving
              ? 'Creating…'
              : 'Create ticket'}
          </button>

        </div>

      </form>

    </section>
  )
}


function exportTicketsToExcel(tickets) {
  const rows = tickets.map((ticket) => ({
    'Ticket Number': ticket.ticketNumber ?? '',
    'Ticket ID': ticket.id || '',
    'Customer Email': ticket.customerEmail || '',
    'Subject': ticket.subject || '',
    'Category': ticket.category || '',
    'Priority': ticket.priority || '',
    'Status': ticket.status || '',
    'Created By': ticket.createdByEmail || ticket.createdByUsername || ticket.createdBy || '',
    'Created By Role': ticket.createdByRole || '',
    'Created At': ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : '',
    'Updated At': ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : '',
    'Updated By': ticket.updatedBy || '',
    'Closed At': ticket.closedAt ? new Date(ticket.closedAt).toLocaleString() : '',
    'Time to Close': typeof ticket.timeSpentMinutes === 'number'
      ? `${Math.floor(ticket.timeSpentMinutes / 60)}h ${ticket.timeSpentMinutes % 60}m`
      : '',
    'Time to Close (Minutes)': typeof ticket.timeSpentMinutes === 'number'
      ? ticket.timeSpentMinutes
      : '',
    'Assigned To': ticket.assignedTo || '',
    'Description': ticket.description || '',
    'Comments': Array.isArray(ticket.comments)
      ? ticket.comments.map((comment) =>
          `${comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ''} - ${comment.createdByEmail || comment.createdByUsername || comment.createdBy || ''}: ${comment.text || ''}`
        ).join('\n')
      : '',
  }))

  const worksheet = XLSX.utils.json_to_sheet(rows)
  worksheet['!cols'] = [
    { wch: 16 }, { wch: 30 }, { wch: 32 }, { wch: 20 },
    { wch: 12 }, { wch: 20 }, { wch: 30 }, { wch: 18 },
    { wch: 22 }, { wch: 22 }, { wch: 30 }, { wch: 22 },
    { wch: 16 }, { wch: 22 }, { wch: 28 }, { wch: 60 }, { wch: 70 },
  ]

  const workbook = XLSX.utils.book_new()

  const closedTickets = tickets.filter(
    (ticket) => ticket.status === 'Closed'
  )
  const closeTimes = closedTickets
    .map((ticket) => ticket.timeSpentMinutes)
    .filter((value) => typeof value === 'number')
  const averageCloseMinutes = closeTimes.length
    ? Math.round(closeTimes.reduce((sum, value) => sum + value, 0) / closeTimes.length)
    : null

  const summaryRows = [
    { Metric: 'Report Generated', Value: new Date().toLocaleString() },
    { Metric: 'Total Tickets', Value: tickets.length },
    { Metric: 'Open / In Progress / Pending', Value: tickets.filter((ticket) => !['Resolved', 'Closed'].includes(ticket.status)).length },
    { Metric: 'Resolved', Value: tickets.filter((ticket) => ticket.status === 'Resolved').length },
    { Metric: 'Closed', Value: closedTickets.length },
    { Metric: 'High / Critical', Value: tickets.filter((ticket) => ['High', 'Critical'].includes(ticket.priority)).length },
    { Metric: 'Average Time to Close', Value: averageCloseMinutes === null ? '—' : `${Math.floor(averageCloseMinutes / 60)}h ${averageCloseMinutes % 60}m` },
  ]
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows)
  summarySheet['!cols'] = [{ wch: 34 }, { wch: 30 }]

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ticket Report')

  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('-')

  XLSX.writeFile(
    workbook,
    `ALTEKNETWORKS_Ticket_Report_${stamp}.xlsx`
  )
}


/* =========================================================
   ADMIN PANEL
========================================================= */

function AdminPanel({
  tickets,
  onUpdate,
  canDeleteTickets = false,
  onDeleteTicket,
  adminView,
  setAdminView,
  users,
  loadingUsers,
  onLoadUsers,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  actorRole,
  isSuperAdmin,
  customers = [],
  onLoadCustomers,
  onCreateCustomer,
  onDeleteCustomer,
  onListAssets,
  onCreateAsset,
  onImportAssets,
  onUpdateAsset,
  onDeleteAsset,
}) {

  const ticketCustomerCount =
    new Set(
      tickets
        .map(
          (t) =>
            t.customerEmail
        )
        .filter(Boolean)
    ).size


  return (

    <>

      <section className="section-head page-head">

        <div>

          <span className="eyebrow">
            ADMINISTRATION
          </span>

          <h1>
            Support operations
          </h1>

          <p>
            {isSuperAdmin
              ? 'Manage support tickets and portal users.'
              : 'Process and manage customer support tickets.'}
          </p>

        </div>

      </section>


      <div className="stats-grid">

        <Stat
          label="Customers with tickets"
          value={ticketCustomerCount}
        />

        <Stat
          label="Open queue"
          value={
            tickets.filter(
              (t) =>
                ![
                  'Resolved',
                  'Closed',
                ].includes(
                  t.status
                )
            ).length
          }
        />

        <Stat
          label="Critical / High"
          value={
            tickets.filter(
              (t) =>
                [
                  'Critical',
                  'High',
                ].includes(
                  t.priority
                )
            ).length
          }
        />

      </div>


      <div
        className="filter-row"
        style={{
          marginTop: '24px',
        }}
      >

        <button
          className={
            adminView === 'tickets'
              ? 'filter-active'
              : ''
          }
          onClick={() =>
            setAdminView('tickets')
          }
        >
          Ticket Management
        </button>


        {isSuperAdmin && (
          <button
            className={
              adminView === 'users'
                ? 'filter-active'
                : ''
            }
            onClick={() => {

              setAdminView('users')

              if (users.length === 0) {
                onLoadUsers()
              }

            }}
          >
            User Administration
          </button>
        )}

        {isSuperAdmin && (
          <button
            className={adminView === 'assets' ? 'filter-active' : ''}
            onClick={() => {
              setAdminView('assets')
              if (customers.length === 0) onLoadCustomers?.()
            }}
          >
            Customers & Assets
          </button>
        )}

      </div>


      {adminView === 'tickets' && (

        <section>

          <section className="section-head">

            <div>

              <span className="eyebrow">
                QUEUE
              </span>

              <h2>
                Ticket management
              </h2>

            </div>

            <button
              type="button"
              className="secondary-button"
              onClick={() => exportTicketsToExcel(tickets)}
              disabled={!tickets.length}
            >
              Export Excel Report
            </button>

          </section>


          {tickets.length ? (

            <TicketTable
              tickets={tickets}
              admin
              onUpdate={onUpdate}
              canDeleteTickets={canDeleteTickets}
              onDeleteTicket={onDeleteTicket}
            />

          ) : (

            <div className="empty-card">
              No tickets available.
            </div>

          )}

        </section>

      )}


      {adminView === 'users' && isSuperAdmin && (

        <UserAdministration
          users={users}
          loading={loadingUsers}
          actorRole={actorRole}
          isSuperAdmin={isSuperAdmin}
          onLoad={onLoadUsers}
          onCreate={onCreateUser}
          onUpdate={onUpdateUser}
          onDelete={onDeleteUser}
          customers={customers}
        />

      )}

      {adminView === 'assets' && isSuperAdmin && (
        <CustomerAssetAdministration
          customers={customers}
          onLoadCustomers={onLoadCustomers}
          onCreateCustomer={onCreateCustomer}
          onDeleteCustomer={onDeleteCustomer}
          onListAssets={onListAssets}
          onCreateAsset={onCreateAsset}
          onImportAssets={onImportAssets}
          onUpdateAsset={onUpdateAsset}
          onDeleteAsset={onDeleteAsset}
        />
      )}

    </>
  )
}


/* =========================================================
   CUSTOMER / ASSET ADMINISTRATION
========================================================= */

function CustomerAssetAdministration({
  customers = [],
  onLoadCustomers,
  onCreateCustomer,
  onDeleteCustomer,
  onListAssets,
  onCreateAsset,
  onImportAssets,
  onUpdateAsset,
  onDeleteAsset,
}) {
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.customerId || '')
  const [assets, setAssets] = useState([])
  const [customerName, setCustomerName] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [product, setProduct] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [model, setModel] = useState('')
  const [status, setStatus] = useState('Active')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!selectedCustomerId && customers[0]?.customerId) setSelectedCustomerId(customers[0].customerId)
  }, [customers, selectedCustomerId])

  const refreshAssets = async (id = selectedCustomerId) => {
    if (!id) return
    setBusy(true); setMessage('')
    try { setAssets(await onListAssets(id)) }
    catch (error) { setMessage(error?.message || 'Unable to load assets.') }
    finally { setBusy(false) }
  }

  useEffect(() => { if (selectedCustomerId) refreshAssets(selectedCustomerId) }, [selectedCustomerId])

  const addCustomer = async (e) => {
    e.preventDefault()
    if (!customerName.trim()) return
    setBusy(true); setMessage('')
    try { const item = await onCreateCustomer({ customerName: customerName.trim() }); setCustomerName(''); setSelectedCustomerId(item.customerId); setMessage(`Customer ${item.customerName} created.`); await onLoadCustomers?.() }
    catch (error) { setMessage(error?.message || 'Unable to create customer.') }
    finally { setBusy(false) }
  }

  const addAsset = async (e) => {
    e.preventDefault()
    if (!selectedCustomerId || !serialNumber.trim()) return
    setBusy(true); setMessage('')
    try { await onCreateAsset(selectedCustomerId, { serialNumber: serialNumber.trim(), product, manufacturer, model, status }); setSerialNumber(''); setProduct(''); setManufacturer(''); setModel(''); setMessage('Asset added successfully.'); await refreshAssets() }
    catch (error) { setMessage(error?.message || 'Unable to add asset.') }
    finally { setBusy(false) }
  }

  const importCsv = async (file) => {
    if (!file || !selectedCustomerId) return
    setBusy(true); setMessage('')
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const result = await onImportAssets(selectedCustomerId, rows)
      setMessage(`Import complete: ${result.created || 0} created, ${result.updated || 0} updated${result.errors?.length ? `, ${result.errors.length} rejected` : ''}.`)
      await refreshAssets()
    } catch (error) { setMessage(error?.message || 'Unable to import assets.') }
    finally { setBusy(false) }
  }

  return (
    <section>
      <div className="section-head">
        <div><span className="eyebrow">CUSTOMER & ASSET INVENTORY</span><h2>Customers & Serial Numbers</h2><p>Assign device serial numbers to customers. Customers can only raise tickets against their own active assets.</p></div>
        <button className="secondary-button" onClick={onLoadCustomers} disabled={busy}>Refresh Customers</button>
      </div>

      {message && <div className="notice" style={{ marginBottom: '18px' }}>{message}</div>}

      <form className="form-card" onSubmit={addCustomer} style={{ marginBottom: '20px' }}>
        <h3>Add Customer</h3>
        <div className="form-grid">
          <label>Customer Name<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="ABC Technologies" required /></label>
          <div className="form-actions" style={{ alignItems: 'end' }}><button className="primary-button" disabled={busy}>Create Customer</button></div>
        </div>
      </form>

      <div className="form-card" style={{ marginBottom: '20px' }}>
        <div className="form-grid">
          <label>Customer<select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)}><option value="">Select customer</option>{customers.map((item) => <option key={item.customerId} value={item.customerId}>{item.customerName} ({item.customerId})</option>)}</select></label>
          <div className="form-actions" style={{ alignItems: 'end' }}>
            <button
              type="button"
              className="danger-button"
              disabled={!selectedCustomerId || busy}
              onClick={async () => {
                const customer = customers.find((item) => item.customerId === selectedCustomerId)
                if (!customer) return
                const confirmed = window.confirm(
                  `Are you Sure to Delete Customer?\n\n${customer.customerName} (${customer.customerId})\n\nThis will permanently delete the customer record and all assigned assets. Existing tickets will be retained for historical records. Customer portal users linked to this customer will be disabled and unassigned.\n\nThis action cannot be undone.`
                )
                if (!confirmed) return
                setBusy(true); setMessage('')
                try {
                  const result = await onDeleteCustomer?.(selectedCustomerId)
                  setSelectedCustomerId('')
                  setAssets([])
                  setMessage(`Customer ${customer.customerName} deleted. ${result?.assetsDeleted || 0} asset(s) removed; ${result?.usersDisabled || 0} portal user(s) disabled. Existing tickets were retained.`)
                } catch (error) {
                  setMessage(error?.message || 'Unable to delete customer.')
                } finally { setBusy(false) }
              }}
            >
              Delete Customer
            </button>
          </div>
          <label>Bulk CSV / Excel Import<input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => importCsv(e.target.files?.[0])} disabled={!selectedCustomerId || busy} /><small>Columns: serialNumber, product, manufacturer, model, status</small></label>
        </div>
      </div>

      {selectedCustomerId && <form className="form-card" onSubmit={addAsset} style={{ marginBottom: '20px' }}>
        <h3>Add Serial Number</h3>
        <div className="form-grid">
          <label>Serial Number<input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} required /></label>
          <label>Product<input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Laptop" /></label>
          <label>Manufacturer<input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Lenovo" /></label>
          <label>Model<input value={model} onChange={(e) => setModel(e.target.value)} placeholder="ThinkPad T14" /></label>
          <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option>Active</option><option>Inactive</option></select></label>
        </div>
        <div className="form-actions"><button className="primary-button" disabled={busy}>Add Asset</button></div>
      </form>}

      <div className="table-card">
        <div className="ticket-table">
          <div className="table-row table-head"><span>Serial Number</span><span>Product</span><span>Manufacturer / Model</span><span>Status</span><span>Action</span></div>
          {busy && !assets.length ? <div className="empty-card">Loading assets…</div> : assets.length ? assets.map((asset) => (
            <div className="table-row" key={asset.serialNumber}>
              <span><strong>{asset.serialNumber}</strong></span>
              <span>{asset.product || '—'}</span>
              <span>{asset.manufacturer || '—'} / {asset.model || '—'}</span>
              <span><Status value={asset.status || 'Active'} /></span>
              <span><button className="secondary-button" onClick={async () => { if (window.confirm(`Delete ${asset.serialNumber}?`)) { await onDeleteAsset(selectedCustomerId, asset.serialNumber); await refreshAssets() } }}>Delete</button></span>
            </div>
          )) : <div className="empty-card">No assets assigned to this customer.</div>}
        </div>
      </div>
    </section>
  )
}


/* =========================================================
   USER ADMINISTRATION
========================================================= */

function UserAdministration({
  users,
  loading,
  actorRole,
  isSuperAdmin,
  onLoad,
  onCreate,
  onUpdate,
  onDelete,
  customers = [],
}) {

  const [showCreate, setShowCreate] =
    useState(false)

  const [saving, setSaving] =
    useState(false)

  const [form, setForm] =
    useState({
      email: '',
      role: 'Customers',
      temporaryPassword: '',
      customerId: '',
    })

  const [actionUser, setActionUser] =
    useState(null)

  const resetForm = () => {
    setForm({
      email: '',
      role: 'Customers',
      temporaryPassword: '',
      customerId: '',
    })
  }

  const submitCreate = async (e) => {
    e.preventDefault()

    if (!form.email.trim()) {
      return
    }

    if (!form.temporaryPassword) {
      return
    }

    if (form.role === 'Customers' && !form.customerId) {
      return
    }

    setSaving(true)

    try {
      await onCreate({
        email: form.email.trim().toLowerCase(),
        role: form.role,
        temporaryPassword: form.temporaryPassword,
        ...(form.role === 'Customers' ? { customerId: form.customerId } : {}),
      })

      resetForm()
      setShowCreate(false)
    } finally {
      setSaving(false)
    }
  }

  const canCreateRole = (role) =>
    canManageUserRole(
      actorRole,
      role
    )

  return (
    <section>

      <div className="section-head">

        <div>
          <span className="eyebrow">
            IDENTITY MANAGEMENT
          </span>

          <h2>
            Portal users
          </h2>

          <p>
            Create and manage customer and
            administrator portal accounts.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
          }}
        >
          <button
            className="secondary-button"
            onClick={onLoad}
            disabled={loading}
          >
            {loading
              ? 'Refreshing…'
              : 'Refresh'}
          </button>

          <button
            className="primary-button"
            onClick={() =>
              setShowCreate(
                (value) => !value
              )
            }
          >
            + Create User
          </button>
        </div>
      </div>

      {showCreate && (
        <form
          className="form-card"
          onSubmit={submitCreate}
          style={{
            marginBottom: '24px',
          }}
        >
          <h3>
            Create portal user
          </h3>

          <div className="form-grid">
            <label>
              Email Address
              <input
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm({
                    ...form,
                    email: e.target.value,
                  })
                }
                placeholder="customer@company.com"
                required
              />
            </label>

            <label>
              Role
              <select
                value={form.role}
                onChange={(e) =>
                  setForm({
                    ...form,
                    role: e.target.value,
                  })
                }
              >
                {USER_ROLES.map(
                  (role) =>
                    canCreateRole(role) && (
                      <option
                        key={role}
                        value={role}
                      >
                        {role}
                      </option>
                    )
                )}
              </select>
            </label>

            {form.role === 'Customers' && (
              <label>
                Customer
                <select
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                  required
                >
                  <option value="">Select customer</option>
                  {customers.filter((item) => String(item.status || 'Active').toLowerCase() === 'active').map((item) => (
                    <option key={item.customerId} value={item.customerId}>
                      {item.customerName} ({item.customerId})
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              Temporary Password
              <input
                type="password"
                value={form.temporaryPassword}
                onChange={(e) =>
                  setForm({
                    ...form,
                    temporaryPassword:
                      e.target.value,
                  })
                }
                placeholder="Enter temporary password"
                autoComplete="new-password"
                required
              />
              <small>
                User will be required to change this password after first login.
              </small>
            </label>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                resetForm()
                setShowCreate(false)
              }}
            >
              Cancel
            </button>

            <button
              className="primary-button"
              disabled={saving}
            >
              {saving
                ? 'Creating…'
                : 'Create User'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="empty-card">
          Loading users…
        </div>
      ) : users.length === 0 ? (
        <div className="empty-card">
          No portal users found.
        </div>
      ) : (
        <div className="table-card">
          <div className="ticket-table">
            <div className="table-row table-head">
              <span>Email</span>
              <span>Role</span>
              <span>Customer</span>
              <span>Status</span>
              <span>Cognito Status</span>
              <span>Created</span>
              <span>Action</span>
            </div>

            {users.map((item) => (
              <UserRow
                key={item.username}
                user={item}
                actorRole={actorRole}
                isSuperAdmin={isSuperAdmin}
                actionUser={actionUser}
                setActionUser={setActionUser}
                onUpdate={onUpdate}
                onDelete={onDelete}
                customers={customers}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}


/* =========================================================
   USER ROW
========================================================= */

function UserRow({
  user,
  actorRole,
  isSuperAdmin,
  actionUser,
  setActionUser,
  onUpdate,
  onDelete,
  customers = [],
}) {

  const [showResetPassword, setShowResetPassword] =
    useState(false)

  const [temporaryPassword, setTemporaryPassword] =
    useState('')

  const [confirmTemporaryPassword, setConfirmTemporaryPassword] =
    useState('')

  const [resetPasswordError, setResetPasswordError] =
    useState('')

  const [resettingPassword, setResettingPassword] =
    useState(false)

  const [approvalCustomerId, setApprovalCustomerId] = useState(user.customerId || '')
  const [approvalBusy, setApprovalBusy] = useState(false)

  const userRole =
    user.role ||
    user.groups?.[0] ||
    'PendingApproval'

  const canEditTarget =
    actorRole === 'SuperAdmins'

  const isEnabled =
    user.enabled !== false

  const closeResetForm = () => {
    setShowResetPassword(false)
    setTemporaryPassword('')
    setConfirmTemporaryPassword('')
    setResetPasswordError('')
  }

  const submitResetPassword = async () => {
    setResetPasswordError('')

    if (!temporaryPassword) {
      setResetPasswordError(
        'Please enter a temporary password.'
      )
      return
    }

    if (!confirmTemporaryPassword) {
      setResetPasswordError(
        'Please confirm the temporary password.'
      )
      return
    }

    if (
      temporaryPassword !==
      confirmTemporaryPassword
    ) {
      setResetPasswordError(
        'Temporary passwords do not match.'
      )
      return
    }

    setResettingPassword(true)

    try {
      const success = await onUpdate(
        user.username,
        {
          resetPassword: true,
          temporaryPassword,
        }
      )

      if (success !== false) {
        closeResetForm()
      }
    } finally {
      setResettingPassword(false)
    }
  }

  return (
    <div className="table-row">

      <span>
        <strong>
          {user.email}
        </strong>
        <small>
          {user.username}
        </small>
      </span>

      <span>
        <strong>
          {userRole}
        </strong>
      </span>

      <span>
        {user.customerId || '—'}
      </span>

      <span>
        <span
          className={
            isEnabled
              ? 'status open'
              : 'status closed'
          }
        >
          {isEnabled
            ? 'Enabled'
            : 'Disabled'}
        </span>
      </span>

      <span>
        {user.status || '—'}
      </span>

      <span>
        {user.createdAt
          ? new Date(
              user.createdAt
            ).toLocaleDateString()
          : '—'}
      </span>

      <span>
        <button
          className="secondary-button"
          onClick={() =>
            setActionUser(
              actionUser === user.username
                ? null
                : user.username
            )
          }
        >
          Manage
        </button>
      </span>

      {actionUser === user.username && (
        <div
          style={{
            gridColumn: '1 / -1',
            padding: '16px 0',
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
          }}
        >

          {isSuperAdmin && (userRole === 'PendingApproval' || userRole === 'PendingVerification') && (
            <div className="approval-action-card">
              <div>
                <strong>{userRole === 'PendingVerification' ? 'Email verification pending' : 'Customer registration awaiting approval'}</strong>
                <small>{user.email} · Email verification: {user.emailVerified ? 'Verified' : 'Not verified'}</small>
              </div>
              {userRole === 'PendingApproval' && user.emailVerified && (
                <>
                  <select value={approvalCustomerId} onChange={(e) => setApprovalCustomerId(e.target.value)}>
                    <option value="">Select customer to assign</option>
                    {customers.filter((item) => String(item.status || 'Active').toLowerCase() === 'active').map((item) => (
                      <option key={item.customerId} value={item.customerId}>{item.customerName} ({item.customerId})</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!approvalCustomerId || approvalBusy}
                    onClick={async () => {
                      setApprovalBusy(true)
                      try { await onUpdate(user.username, { action: 'approve', customerId: approvalCustomerId }) } finally { setApprovalBusy(false) }
                    }}
                  >
                    {approvalBusy ? 'Approving…' : 'Approve Customer'}
                  </button>
                </>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={approvalBusy}
                onClick={async () => {
                  setApprovalBusy(true)
                  try { await onUpdate(user.username, { action: 'reject' }) } finally { setApprovalBusy(false) }
                }}
              >Reject</button>
            </div>
          )}

          {userRole !== 'PendingApproval' && canEditTarget && (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                onUpdate(
                  user.username,
                  {
                    enabled: !isEnabled,
                  }
                )
              }
            >
              {isEnabled
                ? 'Disable User'
                : 'Enable User'}
            </button>
          )}

          {canEditTarget && (
            <div
              style={{
                flexBasis: '100%',
              }}
            >
              {!showResetPassword ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setResetPasswordError('')
                    setTemporaryPassword('')
                    setConfirmTemporaryPassword('')
                    setShowResetPassword(true)
                  }}
                >
                  Reset Password
                </button>
              ) : (
                <div
                  className="form-card"
                  style={{
                    marginTop: '10px',
                    maxWidth: '560px',
                  }}
                >
                  <h3>
                    Reset Password
                  </h3>

                  <p>
                    Set a temporary password for {user.email}. The user will be required to create a new password at next login.
                  </p>

                  <div className="form-grid">
                    <label>
                      Temporary Password
                      <input
                        type="password"
                        value={temporaryPassword}
                        onChange={(e) => {
                          setTemporaryPassword(e.target.value)
                          setResetPasswordError('')
                        }}
                        placeholder="Enter temporary password"
                        autoComplete="new-password"
                        autoFocus
                        required
                      />
                    </label>

                    <label>
                      Confirm Temporary Password
                      <input
                        type="password"
                        value={confirmTemporaryPassword}
                        onChange={(e) => {
                          setConfirmTemporaryPassword(e.target.value)
                          setResetPasswordError('')
                        }}
                        placeholder="Confirm temporary password"
                        autoComplete="new-password"
                        required
                      />
                    </label>
                  </div>

                  {resetPasswordError && (
                    <div
                      className="login-error"
                      role="alert"
                      style={{
                        marginTop: '12px',
                      }}
                    >
                      {resetPasswordError}
                    </div>
                  )}

                  <div className="form-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={closeResetForm}
                      disabled={resettingPassword}
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={submitResetPassword}
                      disabled={resettingPassword}
                    >
                      {resettingPassword
                        ? 'Resetting…'
                        : 'Set Temporary Password'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {isSuperAdmin && userRole !== 'PendingApproval' && (
            <select
              value={userRole}
              onChange={(e) => {
                const newRole = e.target.value

                if (newRole === userRole) {
                  return
                }

                onUpdate(
                  user.username,
                  {
                    role: newRole,
                  }
                )
              }}
            >
              {USER_ROLES.map((role) => (
                <option
                  key={role}
                  value={role}
                >
                  {role}
                </option>
              ))}
            </select>
          )}

          {isSuperAdmin && userRole === 'Customers' && (
            <select
              value={user.customerId || ''}
              onChange={(e) => onUpdate(user.username, { role: 'Customers', customerId: e.target.value })}
            >
              <option value="">Select customer</option>
              {customers.map((item) => (
                <option key={item.customerId} value={item.customerId}>
                  {item.customerName} ({item.customerId})
                </option>
              ))}
            </select>
          )}

          {isSuperAdmin && (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                onDelete(
                  user.username,
                  user.email
                )
              }
            >
              Delete User
            </button>
          )}
        </div>
      )}
    </div>
  )
}


/* =========================================================
   RENDER
========================================================= */

ReactDOM
  .createRoot(
    document.getElementById('root')
  )
  .render(
    <App />
  )