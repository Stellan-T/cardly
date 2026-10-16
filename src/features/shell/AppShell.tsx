import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { Dialog } from '../../components/Dialog'
import {
  FileText,
  FolderPlus,
  House,
  Keyboard,
  Library,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  User,
} from '../../components/icons'
import { Menu } from '../../components/Menu'
import { promptDialog } from '../../components/confirm'
import { openShortcuts } from '../../components/Shortcuts'
import { toast } from '../../components/toast'
import { APP_NAME } from '../../config/app'
import { createFolder } from '../../data/folders'
import { updateSettings } from '../../data/user'
import { AuthPanel } from '../auth/AuthPanel'
import { setThemePreference, useAuth } from '../auth/AuthProvider'
import { signOut } from '../auth/actions'
import { SyncIndicator } from './SyncIndicator'

export function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#main"
      onClick={(e) => {
        e.preventDefault()
        const main = document.getElementById('main')
        main?.setAttribute('tabindex', '-1')
        main?.focus()
      }}
    >
      Skip to content
    </a>
  )
}

export function AppShell() {
  const { uid, isGuest, displayName, user, settings } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState('')
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  // Block body on purpose: newer browsers return a Promise from scrollTo().
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  const newFolder = async () => {
    const name = await promptDialog({ title: 'New folder', placeholder: 'Folder name', confirmLabel: 'Create', maxLength: 255 })
    if (name && uid) {
      const id = createFolder(uid, name)
      navigate(`/folders/${id}`)
    }
  }

  const setTheme = (theme: 'light' | 'dark' | 'system') => {
    setThemePreference(theme)
    if (uid) updateSettings(uid, { theme })
  }

  const initials = displayName.slice(0, 1).toUpperCase() || '?'

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand" aria-label={`${APP_NAME} home`}>
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width={30} height={30} />
            <span>{APP_NAME}</span>
          </Link>
          <nav className="topnav" aria-label="Main">
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/library">Your library</NavLink>
          </nav>
          <form
            className="topsearch"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              navigate(`/search?q=${encodeURIComponent(q)}`)
            }}
          >
            <Search size={18} />
            <input
              className="input"
              type="search"
              placeholder="Search your sets"
              aria-label="Search your sets"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          <span className="spacer" />
          <SyncIndicator />
          <span className="hide-mobile">
            <Menu
              label="Create"
              triggerClassName="btn btn-primary"
              trigger={
                <>
                  <Plus size={18} /> Create
                </>
              }
              items={[
                { label: 'Flashcard set', icon: <Plus size={18} />, to: '/create' },
                { label: 'Import from notes', icon: <FileText size={18} />, to: '/import' },
                { label: 'Folder', icon: <FolderPlus size={18} />, onSelect: newFolder },
              ]}
            />
          </span>
          <Menu
            label="Account menu"
            triggerClassName="avatar"
            trigger={user?.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : initials}
            items={[
              { heading: isGuest ? 'Guest account' : displayName },
              ...(isGuest
                ? [{ label: 'Sign in to save your progress', icon: <User size={18} />, onSelect: () => setUpgradeOpen(true) }]
                : []),
              { label: 'Settings', icon: <Settings size={18} />, to: '/settings' },
              { label: 'Keyboard shortcuts', icon: <Keyboard size={18} />, onSelect: openShortcuts },
              'separator',
              { heading: 'Theme' },
              { label: `Light${settings.theme === 'light' ? ' ✓' : ''}`, icon: <Sun size={18} />, onSelect: () => setTheme('light') },
              { label: `Dark${settings.theme === 'dark' ? ' ✓' : ''}`, icon: <Moon size={18} />, onSelect: () => setTheme('dark') },
              {
                label: `System${settings.theme === 'system' ? ' ✓' : ''}`,
                icon: <Monitor size={18} />,
                onSelect: () => setTheme('system'),
              },
              'separator',
              {
                label: 'Sign out',
                icon: <LogOut size={18} />,
                onSelect: () =>
                  void signOut().then(() => {
                    navigate('/')
                    toast('Signed out')
                  }),
              },
            ]}
          />
        </div>
      </header>

      {isGuest && (
        <div className="container" style={{ paddingTop: 12 }}>
          <div className="alert alert-info no-print">
            <span style={{ flex: 1 }}>You’re using a guest account. Sign in to keep your sets and sync them across devices.</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setUpgradeOpen(true)}>
              Sign in
            </button>
          </div>
        </div>
      )}

      <main id="main" className="app-main">
        <Outlet />
      </main>

      <nav className="bottombar" aria-label="Main">
        <NavLink to="/" end>
          <House size={22} />
          Home
        </NavLink>
        <NavLink to="/search">
          <Search size={22} />
          Search
        </NavLink>
        <NavLink to="/create" aria-label="Create">
          <span className="create-fab">
            <Plus size={22} />
          </span>
          Create
        </NavLink>
        <NavLink to="/library">
          <Library size={22} />
          Library
        </NavLink>
      </nav>

      <Dialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} title="Save your progress">
        <p className="muted">Sign in and everything you made as a guest comes with you.</p>
        <AuthPanel allowGuest={false} onDone={() => setUpgradeOpen(false)} />
      </Dialog>
    </>
  )
}
