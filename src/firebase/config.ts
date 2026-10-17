import type { FirebaseOptions } from 'firebase/app'

/**
 * Firebase web config. These values are public by design (they identify the
 * project, they do not grant access); data is protected by firestore.rules.
 * They come from VITE_FIREBASE_* env vars: .env.local locally, repository
 * secrets in the GitHub Actions deploy workflow.
 */
const env = import.meta.env

export const useEmulators = env.VITE_USE_EMULATORS === 'true'

export const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY || (useEmulators ? 'demo-api-key' : undefined),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || undefined,
  // The emulators run a "demo-" project that never touches real Firebase.
  projectId: useEmulators ? 'demo-cardly' : env.VITE_FIREBASE_PROJECT_ID || undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
  appId: env.VITE_FIREBASE_APP_ID || undefined,
}

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

export const emulatorHost = env.VITE_EMULATOR_HOST || '127.0.0.1'

/**
 * reCAPTCHA Enterprise site key for Firebase App Check (public, like the rest
 * of this file). AI Insight needs it: Firebase AI Logic only answers requests
 * that carry a valid App Check token.
 */
export const recaptchaSiteKey = env.VITE_RECAPTCHA_SITE_KEY || undefined

/**
 * Optional App Check debug token for local development (registered under App
 * Check → Apps → Manage debug tokens). Leave empty to have the SDK print a new
 * one to the console on first use.
 */
export const appCheckDebugToken = env.VITE_APPCHECK_DEBUG_TOKEN || undefined

/** AI Insight works against the real project only: the emulators have no Gemini. */
export const isAiConfigured = isFirebaseConfigured && !useEmulators && Boolean(recaptchaSiteKey)
