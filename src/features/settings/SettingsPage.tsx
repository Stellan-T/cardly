import { updateProfile } from 'firebase/auth'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { confirmDialog, promptDialog } from '../../components/confirm'
import { Segmented, Switch } from '../../components/controls'
import { Dialog } from '../../components/Dialog'
import { Download, Trash, Upload, Volume2 } from '../../components/icons'
import { toast } from '../../components/toast'
import { APP_NAME } from '../../config/app'
import { downloadJson, exportAllData, importBackup, isBackup } from '../../data/account'
import { useMySets } from '../../data/setsHooks'
import { updateProfileFields, updateSettings } from '../../data/user'
import { auth } from '../../firebase'
import { localDateKey } from '../../lib/format'
import { GRADING_LEVEL_INFO } from '../../lib/grade'
import { LANGUAGES, languageName } from '../../lib/languages'
import { getVoices, onVoicesChanged, speak, ttsSupported, voicesFor } from '../../lib/tts'
import type { FlashcardMethod, GradingLevel, ThemePref, UserSettings } from '../../types'
import { AuthPanel } from '../auth/AuthPanel'
import { setThemePreference, useAuth } from '../auth/AuthProvider'
import { authErrorMessage, deleteAccount } from '../auth/actions'
import styles from './Settings.module.css'

const SAMPLE_TEXT: Record<string, string> = {
  en: 'Hello, this is my voice.',
  nl: 'Hallo, dit is mijn stem.',
  fr: 'Bonjour, voici ma voix.',
  de: 'Hallo, das ist meine Stimme.',
  es: 'Hola, esta es mi voz.',
  it: 'Ciao, questa è la mia voce.',
  pt: 'Olá, esta é a minha voz.',
}

export default function SettingsPage() {
  const { uid, user, isGuest, displayName, settings } = useAuth()
  const sets = useMySets(uid)
  const navigate = useNavigate()
  const [name, setName] = useState(displayName)
  const [busy, setBusy] = useState<string | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [, setVoicesVersion] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setName(displayName)
  }, [displayName])
  useEffect(() => onVoicesChanged(() => setVoicesVersion((v) => v + 1)), [])

  const save = (patch: Partial<UserSettings>) => uid && updateSettings(uid, patch)

  // Languages used by the user's sets (plus their own) for the voice pickers.
  const langs = useMemo(() => {
    const set = new Set<string>()
    for (const s of sets.data) {
      if (s.termLang !== 'und') set.add(s.termLang)
      if (s.defLang !== 'und') set.add(s.defLang)
    }
    set.add((navigator.language || 'en').split('-')[0])
    return [...set].filter((l) => LANGUAGES.some((x) => x.code === l)).sort()
  }, [sets.data])

  const saveName = () => {
    const trimmed = name.trim().slice(0, 100)
    if (!uid || !trimmed || trimmed === displayName) return
    updateProfileFields(uid, { displayName: trimmed })
    if (user) void updateProfile(user, { displayName: trimmed }).catch(() => {})
    toast('Name updated', { kind: 'success' })
  }

  const exportData = async () => {
    if (!uid) return
    setBusy('export')
    try {
      const data = await exportAllData(uid)
      downloadJson(`${APP_NAME.toLowerCase()}-backup-${localDateKey()}.json`, data)
      toast(`Exported ${data.sets.length} sets`, { kind: 'success' })
    } catch (err) {
      toast(`Export failed: ${(err as Error).message}`, { kind: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const importData = async (file: File) => {
    if (!uid) return
    setBusy('import')
    try {
      const json = JSON.parse(await file.text())
      if (!isBackup(json)) throw new Error('This isn’t a backup file from this app.')
      const ok = await confirmDialog({
        title: `Import ${json.sets.length} sets?`,
        message: 'Sets from the backup are added to your library (sets that already exist are overwritten with the backup copy).',
        confirmLabel: 'Import',
      })
      if (!ok) return
      const includeSettings = await confirmDialog({
        title: 'Also restore settings?',
        message: 'Theme, grading, flashcard method, voices and other preferences from the backup.',
        confirmLabel: 'Restore settings',
        cancelLabel: 'Keep mine',
      })
      const res = await importBackup(uid, displayName, json, { includeSettings })
      toast(`Imported ${res.sets} sets`, { kind: 'success' })
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, { kind: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const removeAccount = async () => {
    const ok = await confirmDialog({
      title: 'Delete your account?',
      message: 'All your sets, progress, folders and test history are deleted from every device, then your account is removed. This can’t be undone. Consider exporting your data first.',
      confirmLabel: 'Delete everything',
      danger: true,
    })
    if (!ok) return
    if (!navigator.onLine) {
      toast('Connect to the internet to delete your account.', { kind: 'error' })
      return
    }
    setBusy('delete')
    try {
      const done = await deleteAccount(() =>
        promptDialog({ title: 'Confirm your password', inputType: 'password', confirmLabel: 'Delete account', danger: true }),
      )
      if (done) {
        toast('Your account was deleted')
        navigate('/')
      }
    } catch (err) {
      toast(authErrorMessage(err), { kind: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="container container-narrow page">
      <h1>Settings</h1>

      <section className={`panel ${styles.section}`} aria-labelledby="s-account">
        <h2 id="s-account">Account</h2>
        {isGuest ? (
          <div className="alert alert-info">
            <span style={{ flex: 1 }}>You’re using a guest account on this device. Sign in to sync across devices — your sets come with you.</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setUpgradeOpen(true)}>
              Sign in
            </button>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Signed in as <strong>{user?.email ?? displayName}</strong>
            {user?.providerData.some((p) => p.providerId === 'google.com') ? ' with Google' : ''}.
          </p>
        )}
        <div className="field">
          <label htmlFor="display-name">Display name</label>
          <div className="row-nowrap">
            <input id="display-name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
            <button type="button" className="btn" onClick={saveName} disabled={!name.trim() || name.trim() === displayName}>
              Save
            </button>
          </div>
          <span className="hint">Shown on shared sets and Match leaderboards.</span>
        </div>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="s-look">
        <h2 id="s-look">Appearance</h2>
        <div className="option-row">
          <span>Theme</span>
          <Segmented<ThemePref>
            label="Theme"
            value={settings.theme}
            onChange={(theme) => {
              setThemePreference(theme)
              save({ theme })
            }}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
              { value: 'pink', label: 'Pink' },
            ]}
          />
        </div>
        <Switch
          label="Reduce motion"
          hint="Turns off card flips, slides and confetti (your device setting is also respected)."
          checked={settings.reducedMotion}
          onChange={(reducedMotion) => save({ reducedMotion })}
        />
        <Switch label="Sound effects" checked={settings.sound} onChange={(sound) => save({ sound })} />
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="s-study">
        <h2 id="s-study">Studying</h2>
        <div className="field">
          <label htmlFor="def-grading">Default grading level</label>
          <select
            id="def-grading"
            className="select"
            value={settings.defaultGrading}
            onChange={(e) => save({ defaultGrading: e.target.value as 'auto' | GradingLevel })}
          >
            <option value="auto">Automatic (based on the set’s languages)</option>
            {(Object.keys(GRADING_LEVEL_INFO) as GradingLevel[]).map((l) => (
              <option key={l} value={l}>
                {GRADING_LEVEL_INFO[l].label}
              </option>
            ))}
          </select>
          <span className="hint">
            {settings.defaultGrading === 'auto'
              ? 'Strict for language pairs, Chinese/Japanese and maths; Relaxed when both sides are in your language; otherwise Moderate.'
              : GRADING_LEVEL_INFO[settings.defaultGrading].description}{' '}
            You can still change it per set in Learn and Test.
          </span>
        </div>
        <div className="field">
          <label htmlFor="def-method">Default flashcard method</label>
          <select
            id="def-method"
            className="select"
            value={settings.defaultFlashcardMethod}
            onChange={(e) => save({ defaultFlashcardMethod: e.target.value as 'auto' | FlashcardMethod })}
          >
            <option value="auto">Automatic (spaced repetition for 20+ terms, otherwise sorting)</option>
            <option value="browse">Browse cards</option>
            <option value="sort">Basic sorting</option>
            <option value="srs">Spaced repetition</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-per-day">New cards per day (spaced repetition)</label>
          <input
            id="new-per-day"
            className="input"
            type="number"
            min={1}
            max={500}
            style={{ maxWidth: 140 }}
            value={settings.newCardsPerDay}
            onChange={(e) => {
              const n = Math.max(1, Math.min(500, Math.round(Number(e.target.value) || 1)))
              save({ newCardsPerDay: n })
            }}
          />
        </div>
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="s-voices">
        <h2 id="s-voices">Voices</h2>
        {!ttsSupported() ? (
          <p className="muted">This browser doesn’t support text-to-speech.</p>
        ) : (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              Pick the voice used for each language in your sets. Voices come from your device, so they can differ per device.
            </p>
            {langs.map((lang) => {
              const voices = voicesFor(lang)
              return (
                <div key={lang} className={styles.voiceRow}>
                  <label htmlFor={`voice-${lang}`}>{languageName(lang)}</label>
                  <select
                    id={`voice-${lang}`}
                    className="select"
                    value={settings.voices[lang] ?? ''}
                    onChange={(e) => save({ voices: { ...settings.voices, [lang]: e.target.value } })}
                    disabled={!voices.length}
                  >
                    <option value="">{voices.length ? 'Default voice' : 'No voice installed'}</option>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-label={`Test ${languageName(lang)} voice`}
                    onClick={() => speak(SAMPLE_TEXT[lang] ?? languageName(lang), lang, { voiceURI: settings.voices[lang] })}
                  >
                    <Volume2 size={18} />
                  </button>
                </div>
              )
            })}
            {getVoices().length === 0 && <p className="hint">Voices are still loading…</p>}
          </>
        )}
      </section>

      <section className={`panel ${styles.section}`} aria-labelledby="s-data">
        <h2 id="s-data">Your data</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Download everything (sets, cards, images, progress, folders, test history and settings) as JSON, or restore a backup.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => void exportData()} disabled={busy !== null}>
            <Download size={18} /> {busy === 'export' ? 'Exporting…' : 'Export all my data'}
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            <Upload size={18} /> {busy === 'import' ? 'Importing…' : 'Import from JSON backup'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importData(f)
              e.target.value = ''
            }}
          />
        </div>
      </section>

      <section className={`panel ${styles.section} ${styles.danger}`} aria-labelledby="s-danger">
        <h2 id="s-danger">Delete account</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Permanently deletes all your data and your account. You’ll be asked to confirm your sign-in first.
        </p>
        <button type="button" className="btn btn-danger" onClick={() => void removeAccount()} disabled={busy !== null || !auth.currentUser}>
          <Trash size={18} /> {busy === 'delete' ? 'Deleting…' : 'Delete account'}
        </button>
      </section>

      <Dialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} title="Save your progress">
        <AuthPanel allowGuest={false} onDone={() => setUpgradeOpen(false)} />
      </Dialog>
    </div>
  )
}
