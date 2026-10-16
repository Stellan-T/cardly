import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { emulatorHost, firebaseConfig, isFirebaseConfigured, useEmulators } from './config'

export const app = initializeApp(isFirebaseConfigured ? firebaseConfig : { apiKey: 'missing', projectId: 'missing' })

export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
})

function createDb() {
  try {
    // Offline persistence shared across tabs: the app keeps working offline and
    // syncs queued writes when the connection returns.
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    })
  } catch (err) {
    // IndexedDB can be unavailable (private browsing in some browsers).
    console.warn('Falling back to in-memory Firestore cache', err)
    return initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true })
  }
}

export const db = createDb()

if (useEmulators) {
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, emulatorHost, 8080)
}
