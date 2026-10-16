import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { promptDialog } from '../../components/confirm'
import { PageLoading } from '../../components/controls'
import { FileText, Folder, FolderPlus, Plus, Star } from '../../components/icons'
import { createFolder } from '../../data/folders'
import { useMyFolders, useMySets } from '../../data/setsHooks'
import { useAuth } from '../auth/AuthProvider'
import { SetTile } from './SetTile'

type Tab = 'sets' | 'folders' | 'starred'
type Sort = 'recent' | 'created' | 'alpha'

export default function LibraryPage() {
  const { uid } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'sets'
  const [sort, setSort] = useState<Sort>('recent')
  const [filter, setFilter] = useState('')
  const sets = useMySets(uid)
  const folders = useMyFolders(uid)

  const list = useMemo(() => {
    let l = tab === 'starred' ? sets.data.filter((s) => s.starredCount > 0) : sets.data
    const q = filter.trim().toLowerCase()
    if (q) l = l.filter((s) => s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    if (sort === 'created') l = [...l].sort((a, b) => b.createdAt - a.createdAt)
    if (sort === 'alpha') l = [...l].sort((a, b) => a.title.localeCompare(b.title))
    return l
  }, [sets.data, tab, filter, sort])

  const setTab = (t: Tab) => setParams(t === 'sets' ? {} : { tab: t }, { replace: true })
  const newFolder = async () => {
    const name = await promptDialog({ title: 'New folder', placeholder: 'Folder name', confirmLabel: 'Create', maxLength: 255 })
    if (name && uid) createFolder(uid, name)
  }

  return (
    <div className="container page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Your library</h1>
        <div className="row">
          <Link to="/import" className="btn">
            <FileText size={18} /> Import
          </Link>
          <Link to="/create" className="btn btn-primary">
            <Plus size={18} /> Create set
          </Link>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Library">
        {(
          [
            ['sets', 'Flashcard sets'],
            ['folders', 'Folders'],
            ['starred', 'Starred'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'folders' ? (
        folders.loading ? (
          <PageLoading />
        ) : (
          <div className="stack">
            <div>
              <button type="button" className="btn" onClick={() => void newFolder()}>
                <FolderPlus size={18} /> New folder
              </button>
            </div>
            {folders.data.length === 0 ? (
              <div className="empty">
                <Folder size={32} />
                <h2>No folders yet</h2>
                <p className="muted">Folders group your sets by subject or course. A set can be in several folders.</p>
              </div>
            ) : (
              <div className="grid-cards">
                {folders.data.map((f) => (
                  <Link key={f.id} to={`/folders/${f.id}`} className="panel panel-link set-tile">
                    <Folder size={22} color="var(--primary)" />
                    <h3>{f.name}</h3>
                    <span className="subtle">
                      {f.setIds.length} {f.setIds.length === 1 ? 'set' : 'sets'}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      ) : sets.loading ? (
        <PageLoading />
      ) : (
        <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
          <div className="row">
            <input
              className="input"
              style={{ maxWidth: 320 }}
              type="search"
              placeholder="Filter by title"
              aria-label="Filter sets by title"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort sets">
              <option value="recent">Recent</option>
              <option value="created">Created</option>
              <option value="alpha">Alphabetical</option>
            </select>
          </div>
          {list.length === 0 ? (
            <div className="empty">
              {tab === 'starred' ? <Star size={32} /> : <FileText size={32} />}
              <h2>{tab === 'starred' ? 'No starred terms yet' : filter ? 'No matching sets' : 'No sets yet'}</h2>
              <p className="muted">
                {tab === 'starred'
                  ? 'Star terms while studying (☆) and their sets show up here.'
                  : 'Import your notes or create a set to get started.'}
              </p>
              {tab === 'sets' && !filter && (
                <div className="row" style={{ justifyContent: 'center' }}>
                  <Link to="/import" className="btn btn-primary">
                    Import from notes
                  </Link>
                  <Link to="/create" className="btn">
                    Create manually
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="grid-cards">
              {list.map((s) => (
                <SetTile key={s.id} set={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
