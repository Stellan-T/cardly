import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { confirmDialog, promptDialog } from '../../components/confirm'
import { Dialog } from '../../components/Dialog'
import { PageLoading } from '../../components/controls'
import { Ellipsis, Folder, Pencil, Plus, Trash, X } from '../../components/icons'
import { Menu } from '../../components/Menu'
import { deleteFolder, renameFolder } from '../../data/folders'
import { addSetToFolder, removeSetFromFolder } from '../../data/sets'
import { isStudyable, useMyFolders, useMySets } from '../../data/setsHooks'
import { useAuth } from '../auth/AuthProvider'
import { SetTile } from './SetTile'

export default function FolderPage() {
  const { folderId = '' } = useParams()
  const { uid } = useAuth()
  const folders = useMyFolders(uid)
  const sets = useMySets(uid)
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const folder = folders.data.find((f) => f.id === folderId)
  const inFolder = useMemo(() => (folder ? sets.data.filter((s) => folder.setIds.includes(s.id)) : []), [folder, sets.data])

  if (folders.loading || sets.loading) return <PageLoading />
  if (!folder || !uid)
    return (
      <div className="container page">
        <div className="empty">
          <h1>Folder not found</h1>
          <Link to="/library?tab=folders" className="btn btn-primary">
            Back to folders
          </Link>
        </div>
      </div>
    )

  return (
    <div className="container page">
      <div className="row" style={{ marginBottom: 16 }}>
        <Folder size={28} color="var(--primary)" />
        <h1 style={{ margin: 0, flex: 1, overflowWrap: 'anywhere' }}>{folder.name}</h1>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={18} /> Add sets
        </button>
        <Menu
          label="Folder actions"
          trigger={<Ellipsis size={20} />}
          triggerClassName="btn btn-icon"
          items={[
            {
              label: 'Rename',
              icon: <Pencil size={18} />,
              onSelect: async () => {
                const name = await promptDialog({ title: 'Rename folder', defaultValue: folder.name, confirmLabel: 'Rename', maxLength: 255 })
                if (name) renameFolder(uid, folder.id, name)
              },
            },
            {
              label: 'Delete folder',
              icon: <Trash size={18} />,
              danger: true,
              onSelect: async () => {
                const ok = await confirmDialog({
                  title: 'Delete folder?',
                  message: 'The sets inside are not deleted; they stay in your library.',
                  confirmLabel: 'Delete folder',
                  danger: true,
                })
                if (!ok) return
                deleteFolder(uid, folder)
                navigate('/library?tab=folders')
              },
            },
          ]}
        />
      </div>
      {inFolder.length === 0 ? (
        <div className="empty">
          <h2>This folder is empty</h2>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Add sets
          </button>
        </div>
      ) : (
        <div className="grid-cards">
          {inFolder.map((s) => (
            <div key={s.id} className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
              <SetTile set={s} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeSetFromFolder(uid, s.id, folder.id)}>
                <X size={14} /> Remove from folder
              </button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title={`Add sets to “${folder.name}”`} footer={<button type="button" className="btn btn-primary" onClick={() => setAdding(false)}>Done</button>}>
        <div className="stack">
          {sets.data.filter(isStudyable).map((s) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                checked={folder.setIds.includes(s.id)}
                onChange={(e) => (e.target.checked ? addSetToFolder(uid, s.id, folder.id) : removeSetFromFolder(uid, s.id, folder.id))}
              />
              {s.title} <span className="subtle">({s.cardCount})</span>
            </label>
          ))}
        </div>
      </Dialog>
    </div>
  )
}
