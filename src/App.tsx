import { lazy, Suspense, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router'
import { DialogHost } from './components/confirm'
import { PageLoading } from './components/controls'
import { ShortcutsOverlay } from './components/Shortcuts'
import { Toasts } from './components/toast'
import { AuthProvider, useAuth } from './features/auth/AuthProvider'
import { AppShell, SkipLink } from './features/shell/AppShell'
import { PwaPrompt } from './features/shell/PwaPrompt'
import { StudySetProvider } from './features/sets/StudySetContext'
import type { ActivityKind } from './types'

const SignInPage = lazy(() => import('./features/auth/SignInPage'))
const HomePage = lazy(() => import('./features/home/HomePage'))
const LibraryPage = lazy(() => import('./features/library/LibraryPage'))
const FolderPage = lazy(() => import('./features/library/FolderPage'))
const SearchPage = lazy(() => import('./features/library/SearchPage'))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'))
const ImportPage = lazy(() => import('./features/import/ImportPage'))
const SetEditorPage = lazy(() => import('./features/editor/SetEditorPage'))
const SetPage = lazy(() => import('./features/sets/SetPage'))
const NotFoundPage = lazy(() => import('./features/shell/NotFoundPage'))

const MODES: Record<ActivityKind, React.LazyExoticComponent<() => React.JSX.Element>> = {
  flashcards: lazy(() => import('./features/flashcards/FlashcardsPage')),
  learn: lazy(() => import('./features/learn/LearnPage')),
  test: lazy(() => import('./features/test/TestPage')),
  match: lazy(() => import('./features/match/MatchPage')),
  blocks: lazy(() => import('./features/blocks/BlocksPage')),
  blast: lazy(() => import('./features/blast/BlastPage')),
}

function SetRoute({ isPublic, children }: { isPublic: boolean; children: ReactNode }) {
  const { setId = '' } = useParams()
  return (
    <StudySetProvider key={`${isPublic}/${setId}`} setId={setId} isPublic={isPublic}>
      {children}
    </StudySetProvider>
  )
}

function StudyRoute({ isPublic }: { isPublic: boolean }) {
  const { mode = '' } = useParams()
  const Mode = MODES[mode as ActivityKind]
  if (!Mode) return <NotFoundPage />
  return (
    <SetRoute isPublic={isPublic}>
      <Mode />
    </SetRoute>
  )
}

function Gate() {
  const { status } = useAuth()
  if (status === 'loading') return <PageLoading label="Starting…" />
  if (status === 'signedOut') return <SignInPage />
  return (
    <Routes>
      <Route path="/sets/:setId/:mode" element={<StudyRoute isPublic={false} />} />
      <Route path="/p/:setId/:mode" element={<StudyRoute isPublic />} />
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/folders/:folderId" element={<FolderPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/create" element={<SetEditorPage />} />
        <Route path="/sets/:setId/edit" element={<SetEditorPage />} />
        <Route
          path="/sets/:setId"
          element={
            <SetRoute isPublic={false}>
              <SetPage />
            </SetRoute>
          }
        />
        <Route
          path="/p/:setId"
          element={
            <SetRoute isPublic>
              <SetPage />
            </SetRoute>
          }
        />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <SkipLink />
        <Suspense fallback={<PageLoading />}>
          <Gate />
        </Suspense>
        <Toasts />
        <DialogHost />
        <ShortcutsOverlay />
        <PwaPrompt />
      </AuthProvider>
    </HashRouter>
  )
}
