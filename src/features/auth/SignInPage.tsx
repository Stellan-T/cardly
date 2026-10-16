import { APP_DESCRIPTION, APP_NAME } from '../../config/app'
import { Brain, ClipboardCheck, FileText, Layers, RefreshCw } from '../../components/icons'
import { isFirebaseConfigured } from '../../firebase/config'
import { AuthPanel } from './AuthPanel'
import { authErrorMessage } from './actions'
import { useAuth } from './AuthProvider'
import styles from './SignInPage.module.css'

const FEATURES = [
  { icon: <FileText size={20} />, title: 'Paste your notes', text: 'Lines like “term: definition” become flashcards instantly.' },
  { icon: <Layers size={20} />, title: 'Flashcards & spaced repetition', text: 'Review each card right before you’d forget it.' },
  { icon: <Brain size={20} />, title: 'Learn, Test and games', text: 'Adaptive questions, practice tests, Match, Blocks and Blast.' },
  { icon: <RefreshCw size={20} />, title: 'Synced everywhere', text: 'Phone, tablet and laptop stay in step, even offline.' },
]

export default function SignInPage() {
  const { redirectError } = useAuth()
  return (
    <div className={styles.wrap}>
      <main className={styles.main} id="main">
        <section className={styles.hero}>
          <div className="brand" style={{ fontSize: '1.4rem' }}>
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width={36} height={36} />
            {APP_NAME}
          </div>
          <h1 className={styles.title}>Study smarter from the notes you already have.</h1>
          <p className={styles.lead}>{APP_DESCRIPTION} Everything is free.</p>
          <ul className={styles.features}>
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className={styles.featureIcon}>{f.icon}</span>
                <div>
                  <strong>{f.title}</strong>
                  <div className="muted small">{f.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className={`panel ${styles.card}`} aria-labelledby="signin-title">
          <h2 id="signin-title">Get started</h2>
          <p className="muted small">Sign in to keep your sets and progress in sync across your devices.</p>
          {!isFirebaseConfigured && (
            <div className="alert alert-warning" role="alert" style={{ marginBottom: 14 }}>
              Firebase isn’t configured yet. Add the VITE_FIREBASE_* values (see README) and rebuild.
            </div>
          )}
          {redirectError != null && (
            <div className="alert alert-danger" role="alert" style={{ marginBottom: 14 }}>
              {authErrorMessage(redirectError)}
            </div>
          )}
          <AuthPanel />
          <p className="tiny muted" style={{ marginTop: 16, marginBottom: 0 }}>
            <ClipboardCheck size={14} style={{ verticalAlign: '-2px' }} /> Your sets are private unless you share a link.
          </p>
        </section>
      </main>
    </div>
  )
}
