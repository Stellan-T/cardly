import { onAuthStateChanged, type User } from 'firebase/auth'
import { onSnapshot } from 'firebase/firestore'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { STORAGE_PREFIX } from '../../config/app'
import { toUserDoc } from '../../data/mappers'
import { userRef } from '../../data/paths'
import { createUserDoc } from '../../data/user'
import { auth } from '../../firebase'
import { setSoundEnabled } from '../../lib/sound'
import type { ThemePref, UserDoc, UserSettings } from '../../types'
import { handleRedirectResult } from './actions'

export interface AuthValue {
  status: 'loading' | 'signedOut' | 'signedIn'
  user: User | null
  uid: string | null
  isGuest: boolean
  displayName: string
  profile: UserDoc
  profileLoaded: boolean
  settings: UserSettings
  redirectError: unknown
}

const defaultProfile = toUserDoc(undefined)

const AuthContext = createContext<AuthValue>({
  status: 'loading',
  user: null,
  uid: null,
  isGuest: false,
  displayName: '',
  profile: defaultProfile,
  profileLoaded: false,
  settings: defaultProfile.settings,
  redirectError: null,
})

export const useAuth = () => useContext(AuthContext)

/** The signed-in user's uid; only call inside the signed-in part of the app. */
export function useUid(): string {
  const { uid } = useAuth()
  if (!uid) throw new Error('useUid() called while signed out')
  return uid
}

function applyTheme(theme: ThemePref) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = theme === 'pink' ? 'pink' : dark ? 'dark' : 'light'
}

/** The app logo; the pink theme has its own. Read at render, after the theme is applied. */
export const logoSrc = () =>
  `${import.meta.env.BASE_URL}${document.documentElement.dataset.theme === 'pink' ? 'logo-pink.svg' : 'logo.svg'}`

export function setThemePreference(theme: ThemePref) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}.theme`, theme)
  } catch {
    // ignore
  }
  applyTheme(theme)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(auth.currentUser)
  const [status, setStatus] = useState<AuthValue['status']>('loading')
  const [profile, setProfile] = useState<{ uid: string; doc: UserDoc } | null>(null)
  const [redirectError, setRedirectError] = useState<unknown>(null)

  useEffect(() => {
    handleRedirectResult().catch(setRedirectError)
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      setStatus(u ? 'signedIn' : 'signedOut')
    })
  }, [])

  useEffect(() => {
    if (!user) {
      setProfile(null)
      return
    }
    const uid = user.uid
    let creating = false
    // Only create a profile for a brand-new account: once the doc has existed, a
    // missing doc means it was deleted (account deletion) and must stay deleted.
    let seen = false
    return onSnapshot(
      userRef(uid),
      (snap) => {
        if (snap.exists()) seen = true
        if (!snap.exists()) {
          if (!snap.metadata.fromCache && !creating && !seen) {
            creating = true
            void createUserDoc(uid, {
              displayName: user.displayName || user.email?.split('@')[0] || (user.isAnonymous ? 'Guest' : 'You'),
              email: user.email,
              photoURL: user.photoURL,
            })
          }
          setProfile({ uid, doc: toUserDoc(undefined) })
          return
        }
        setProfile({ uid, doc: toUserDoc(snap.data()) })
      },
      (err) => {
        console.warn('profile listener', err)
        setProfile({ uid, doc: toUserDoc(undefined) })
      },
    )
  }, [user])

  const profileDoc = profile && user && profile.uid === user.uid ? profile.doc : defaultProfile
  const settings = profileDoc.settings

  // Apply theme, motion and sound preferences.
  useEffect(() => {
    if (!profile) return
    setThemePreference(settings.theme)
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [profile, settings.theme])

  useEffect(() => {
    if (settings.reducedMotion) document.documentElement.dataset.reducedMotion = 'true'
    else delete document.documentElement.dataset.reducedMotion
    try {
      localStorage.setItem(`${STORAGE_PREFIX}.reducedMotion`, String(settings.reducedMotion))
    } catch {
      // ignore
    }
  }, [settings.reducedMotion])

  useEffect(() => {
    setSoundEnabled(settings.sound)
  }, [settings.sound])

  const value = useMemo<AuthValue>(() => {
    const displayName =
      profileDoc.displayName || user?.displayName || user?.email?.split('@')[0] || (user?.isAnonymous ? 'Guest' : 'You')
    return {
      status,
      user,
      uid: user?.uid ?? null,
      isGuest: !!user?.isAnonymous,
      displayName,
      profile: profileDoc,
      profileLoaded: !!profile,
      settings,
      redirectError,
    }
  }, [status, user, profileDoc, profile, settings, redirectError])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
