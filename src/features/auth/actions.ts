/**
 * Sign-in flows: Google (popup, redirect on iOS standalone / in-app browsers),
 * email/password, password reset and guest (anonymous) accounts. A guest who
 * later signs in keeps their data: the anonymous account is linked, or, if the
 * account already exists, the guest's sets are copied into it.
 */
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  getRedirectResult,
  linkWithCredential,
  linkWithPopup,
  linkWithRedirect,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  updateProfile,
  type AuthCredential,
  type User,
} from 'firebase/auth'
import { STORAGE_PREFIX } from '../../config/app'
import { exportAllData, importBackup, deleteAllData, type Backup } from '../../data/account'
import { flushAllStores } from '../../data/studyStores'
import { updateProfileFields } from '../../data/user'
import { auth } from '../../firebase'

const googleProvider = () => {
  const p = new GoogleAuthProvider()
  p.setCustomParameters({ prompt: 'select_account' })
  return p
}

const LINKING_KEY = `${STORAGE_PREFIX}.linking`

/** In-app browsers and iOS home-screen apps can't open popups reliably. */
export function prefersRedirect(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const inApp = /FBAN|FBAV|Instagram|Line\/|LinkedInApp|Snapchat|MicroMessenger|Twitter|GSA\//i.test(ua)
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return inApp || standalone
}

const POPUP_FALLBACK_CODES = new Set(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'])

function code(err: unknown): string {
  return (err as { code?: string })?.code ?? ''
}

/** Copies a guest's data into the account they just signed in to. */
async function mergeGuest(backup: Backup | null, user: User) {
  if (!backup || backup.sets.length === 0) return
  await importBackup(user.uid, user.displayName || user.email?.split('@')[0] || 'You', backup)
}

async function finishSignIn(user: User) {
  updateProfileFields(user.uid, {
    displayName: user.displayName || user.email?.split('@')[0] || 'You',
    email: user.email,
    photoURL: user.photoURL,
  })
}

export async function signInWithGoogle(): Promise<void> {
  const current = auth.currentUser
  const provider = googleProvider()
  if (current?.isAnonymous) {
    if (prefersRedirect()) {
      sessionStorage.setItem(LINKING_KEY, current.uid)
      await linkWithRedirect(current, provider)
      return
    }
    try {
      const res = await linkWithPopup(current, provider)
      await finishSignIn(res.user)
    } catch (err) {
      if (code(err) === 'auth/credential-already-in-use') {
        const credential = GoogleAuthProvider.credentialFromError(err as never)
        if (credential) return switchFromGuest(credential)
      }
      if (POPUP_FALLBACK_CODES.has(code(err))) {
        sessionStorage.setItem(LINKING_KEY, current.uid)
        await linkWithRedirect(current, provider)
        return
      }
      throw err
    }
    return
  }
  if (prefersRedirect()) {
    await signInWithRedirect(auth, provider)
    return
  }
  try {
    const res = await signInWithPopup(auth, provider)
    await finishSignIn(res.user)
  } catch (err) {
    if (POPUP_FALLBACK_CODES.has(code(err))) {
      await signInWithRedirect(auth, provider)
      return
    }
    throw err
  }
}

/** The Google account already exists: copy the guest's sets into it and switch. */
async function switchFromGuest(credential: AuthCredential) {
  const guest = auth.currentUser
  flushAllStores()
  const backup = guest ? await exportAllData(guest.uid).catch(() => null) : null
  const res = await signInWithCredential(auth, credential)
  await finishSignIn(res.user)
  await mergeGuest(backup, res.user)
}

/** Completes a redirect sign-in or link after the page reloads. */
export async function handleRedirectResult(): Promise<void> {
  try {
    const res = await getRedirectResult(auth)
    sessionStorage.removeItem(LINKING_KEY)
    if (res?.user) await finishSignIn(res.user)
  } catch (err) {
    const linking = sessionStorage.getItem(LINKING_KEY)
    sessionStorage.removeItem(LINKING_KEY)
    if (code(err) === 'auth/credential-already-in-use' && linking) {
      const credential = GoogleAuthProvider.credentialFromError(err as never)
      if (credential) return switchFromGuest(credential)
    }
    throw err
  }
}

export async function signUpWithEmail(name: string, email: string, password: string): Promise<void> {
  const current = auth.currentUser
  if (current?.isAnonymous) {
    const res = await linkWithCredential(current, EmailAuthProvider.credential(email, password))
    if (name) await updateProfile(res.user, { displayName: name })
    await finishSignIn(res.user)
    return
  }
  const res = await createUserWithEmailAndPassword(auth, email, password)
  if (name) await updateProfile(res.user, { displayName: name })
  await finishSignIn(res.user)
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const current = auth.currentUser
  let backup: Backup | null = null
  if (current?.isAnonymous) {
    flushAllStores()
    backup = await exportAllData(current.uid).catch(() => null)
  }
  const res = await signInWithEmailAndPassword(auth, email, password)
  await finishSignIn(res.user)
  await mergeGuest(backup, res.user)
}

export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email)

export const continueAsGuest = () => signInAnonymously(auth)

export async function signOut(): Promise<void> {
  flushAllStores()
  await fbSignOut(auth)
}

/** Re-authenticates (Google popup or password), deletes all data, then the auth user. */
export async function deleteAccount(getPassword: () => Promise<string | null>): Promise<boolean> {
  const user = auth.currentUser
  if (!user) return false
  const providers = user.providerData.map((p) => p.providerId)
  if (!user.isAnonymous) {
    if (providers.includes('google.com')) {
      await reauthenticateWithPopup(user, googleProvider())
    } else if (providers.includes('password') && user.email) {
      const password = await getPassword()
      if (!password) return false
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
    }
  }
  await deleteAllData(user.uid)
  await deleteUser(user)
  return true
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-password': 'Please enter your password.',
  'auth/weak-password': 'Use a password of at least 6 characters.',
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'No account found with this email.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/popup-closed-by-user': 'The sign-in window was closed before finishing.',
  'auth/cancelled-popup-request': 'The sign-in window was closed before finishing.',
  'auth/network-request-failed': 'You appear to be offline. Connect to the internet to sign in.',
  'auth/unauthorized-domain':
    'This site isn’t authorised for sign-in yet. Add it under Firebase Authentication → Settings → Authorized domains.',
  'auth/operation-not-allowed': 'This sign-in method isn’t enabled in the Firebase project.',
  'auth/requires-recent-login': 'Please sign in again and retry.',
  'auth/admin-restricted-operation': 'Guest access isn’t enabled in the Firebase project (enable Anonymous sign-in).',
}

export function authErrorMessage(err: unknown): string {
  return MESSAGES[code(err)] ?? (err instanceof Error ? err.message : 'Something went wrong. Please try again.')
}
