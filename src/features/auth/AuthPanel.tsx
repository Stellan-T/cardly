import { useState, type FormEvent } from 'react'
import { toast } from '../../components/toast'
import { Mail } from '../../components/icons'
import { authErrorMessage, continueAsGuest, resetPassword, signInWithEmail, signInWithGoogle, signUpWithEmail } from './actions'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

type Mode = 'signin' | 'signup' | 'reset'

/** Sign-in options: Google first, email/password second, optionally guest. */
export function AuthPanel({ allowGuest = true, onDone }: { allowGuest?: boolean; onDone?: () => void }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [showEmail, setShowEmail] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await fn()
      onDone?.()
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'reset') {
      void (async () => {
        setBusy(true)
        setError(null)
        try {
          await resetPassword(email)
          setInfo('Check your inbox for a link to reset your password.')
          toast('Password reset email sent', { kind: 'success' })
        } catch (err) {
          setError(authErrorMessage(err))
        } finally {
          setBusy(false)
        }
      })()
      return
    }
    void run(() => (mode === 'signup' ? signUpWithEmail(name.trim(), email.trim(), password) : signInWithEmail(email.trim(), password)))
  }

  return (
    <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
      <button type="button" className="btn btn-lg btn-block" disabled={busy} onClick={() => run(signInWithGoogle)}>
        <GoogleMark />
        Continue with Google
      </button>

      {!showEmail ? (
        <button type="button" className="btn btn-lg btn-block btn-ghost" onClick={() => setShowEmail(true)} disabled={busy}>
          <Mail size={18} />
          Continue with email
        </button>
      ) : (
        <form className="stack panel" onSubmit={submit} noValidate>
          <div className="segmented" role="tablist" aria-label="Email sign-in">
            <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => setMode('signin')}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>
              Create account
            </button>
          </div>
          {mode === 'signup' && (
            <div className="field">
              <label htmlFor="auth-name">Name</label>
              <input id="auth-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {mode !== 'reset' && (
            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                className="input"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
          </button>
          {mode === 'signin' && (
            <button type="button" className="link-btn small" onClick={() => setMode('reset')}>
              Forgot password?
            </button>
          )}
          {mode === 'reset' && (
            <button type="button" className="link-btn small" onClick={() => setMode('signin')}>
              Back to sign in
            </button>
          )}
        </form>
      )}

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      {info && <div className="alert alert-success">{info}</div>}

      {allowGuest && (
        <div className="center small">
          <span className="muted">Just looking? </span>
          <button type="button" className="link-btn" disabled={busy} onClick={() => run(continueAsGuest)}>
            Try it without an account
          </button>
        </div>
      )}
    </div>
  )
}
