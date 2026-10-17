import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { Dialog } from '../../components/Dialog'
import { PageLoading } from '../../components/controls'
import { Maximize, Minimize, Settings, X } from '../../components/icons'
import { useStudySet } from '../sets/StudySetContext'
import { ACTIVITIES } from './activities'
import { exitFullscreen, useFullscreen, useTermFilter } from './hooks'
import type { ActivityKind } from '../../types'

interface StudyLayoutProps {
  mode: ActivityKind
  children: ReactNode
  /** Rendered in the header between the title and the buttons (e.g. a counter). */
  headerExtra?: ReactNode
  /** Contents of the Options sheet (or a function receiving `close`). Omit to hide the gear button. */
  options?: ReactNode | ((close: () => void) => ReactNode)
  /** Minimum number of cards (after filters) the activity needs. */
  minCards?: number
  /** How many cards are available after filters such as "starred only". */
  availableCards?: number
  /** Called before leaving through the X button (e.g. to flush state). */
  onExit?: () => void
  /** Asked before leaving through the X button; resolve false to stay. */
  confirmExit?: () => boolean | Promise<boolean>
}

/** Full-screen frame for a study activity: header, options sheet, exit. */
export function StudyLayout({
  mode,
  children,
  headerExtra,
  options,
  minCards = 2,
  availableCards,
  onExit,
  confirmExit,
}: StudyLayoutProps) {
  const { meta, status, basePath, cards } = useStudySet()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const navigate = useNavigate()
  const activity = ACTIVITIES[mode]
  const subset = useTermFilter()
  const count = availableCards ?? cards.length
  const fullscreen = useFullscreen()

  const exit = async () => {
    if (confirmExit && !(await confirmExit())) return
    onExit?.()
    exitFullscreen()
    navigate(basePath)
  }

  let body: ReactNode = children
  if (status === 'loading') body = <PageLoading />
  else if (status === 'missing' || status === 'error')
    body = (
      <div className="empty">
        <h2>Set not found</h2>
        <p className="muted">It may have been deleted, or the link is no longer shared.</p>
        <Link className="btn btn-primary" to="/">
          Go home
        </Link>
      </div>
    )
  else if (count < minCards)
    body = (
      <div className="empty">
        <h2>
          {activity.label} needs at least {minCards} terms
        </h2>
        <p className="muted">
          {cards.length >= minCards
            ? 'Your current options leave too few terms (for example “Study only starred terms”). Change the options to continue.'
            : `This set has ${cards.length} term${cards.length === 1 ? '' : 's'}. Add a few more to play.`}
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {options && cards.length >= minCards && (
            <button type="button" className="btn btn-primary" onClick={() => setOptionsOpen(true)}>
              Open options
            </button>
          )}
          <Link className="btn" to={basePath}>
            Back to set
          </Link>
        </div>
      </div>
    )

  return (
    <div className="study-shell">
      <header className="study-header">
        <span className="mode-name">
          <span className="activity-icon" aria-hidden>
            {activity.icon}
          </span>
          {activity.label}
        </span>
        <span className="set-title hide-mobile">{meta.title}</span>
        <span className="spacer" />
        {headerExtra}
        {fullscreen.supported && (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={fullscreen.active ? 'Exit full screen' : 'Full screen'}
            aria-pressed={fullscreen.active}
            title={fullscreen.active ? 'Exit full screen' : 'Full screen'}
            onClick={fullscreen.toggle}
          >
            {fullscreen.active ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        )}
        {options && (
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Options" title="Options" onClick={() => setOptionsOpen(true)}>
            <Settings size={20} />
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Exit to set" title="Exit" onClick={() => void exit()}>
          <X size={22} />
        </button>
      </header>
      <main id="main" className="study-body">
        {subset && status === 'ready' && (
          <div className="alert alert-info no-print" style={{ marginBottom: 16 }}>
            <span style={{ flex: 1 }}>
              Studying {subset.size} selected {subset.size === 1 ? 'term' : 'terms'}.
            </span>
            <Link className="btn btn-sm" to={`${basePath}/${mode}`}>
              Study all terms
            </Link>
          </div>
        )}
        {body}
      </main>
      {options && (
        <Dialog open={optionsOpen} onClose={() => setOptionsOpen(false)} title="Options" sheet>
          {typeof options === 'function' ? options(() => setOptionsOpen(false)) : options}
        </Dialog>
      )}
    </div>
  )
}

export function OptionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="option-group">
      <h3>{title}</h3>
      <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
        {children}
      </div>
    </section>
  )
}
