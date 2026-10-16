import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { Dialog } from './Dialog'

interface Request {
  kind: 'confirm' | 'prompt'
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  placeholder?: string
  maxLength?: number
  defaultValue?: string
  inputType?: string
  resolve: (value: string | boolean | null) => void
}

const useDialogs = create<{ current: Request | null }>(() => ({ current: null }))

/** Promise-based confirmation dialog. */
export function confirmDialog(opts: Omit<Request, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) =>
    useDialogs.setState({ current: { ...opts, kind: 'confirm', resolve: (v) => resolve(v === true) } }),
  )
}

/** Promise-based text prompt. Resolves to null when cancelled. */
export function promptDialog(opts: Omit<Request, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) =>
    useDialogs.setState({
      current: { ...opts, kind: 'prompt', resolve: (v) => resolve(typeof v === 'string' ? v : null) },
    }),
  )
}

export function DialogHost() {
  const current = useDialogs((s) => s.current)
  const [value, setValue] = useState('')
  useEffect(() => {
    setValue(current?.defaultValue ?? '')
  }, [current])
  const finish = (v: string | boolean | null) => {
    current?.resolve(v)
    useDialogs.setState({ current: null })
  }
  return (
    <Dialog
      open={!!current}
      onClose={() => finish(current?.kind === 'prompt' ? null : false)}
      title={current?.title ?? ''}
      initialFocus={current?.kind === 'prompt' ? 'input' : '.dialog-footer .btn:last-child'}
      footer={
        <>
          <button type="button" className="btn" onClick={() => finish(current?.kind === 'prompt' ? null : false)}>
            {current?.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="submit"
            form="dialog-host-form"
            className={`btn ${current?.danger ? 'btn-danger' : 'btn-primary'}`}
          >
            {current?.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <form
        id="dialog-host-form"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          finish(current?.kind === 'prompt' ? value : true)
        }}
      >
        {current?.message && <div className="muted">{current.message}</div>}
        {current?.kind === 'prompt' && (
          <input
            className="input"
            type={current.inputType ?? 'text'}
            maxLength={current.maxLength}
            value={value}
            placeholder={current.placeholder}
            onChange={(e) => setValue(e.target.value)}
            aria-label={current.title}
          />
        )}
      </form>
    </Dialog>
  )
}
