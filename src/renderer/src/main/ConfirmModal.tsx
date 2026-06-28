import { useEffect, useRef } from 'react'

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}

/**
 * Themed confirmation dialog used instead of the native window.confirm, so
 * destructive actions get an on-brand, dark-mode prompt. For destructive use
 * the Cancel button is focused by default — an accidental Enter cancels rather
 * than confirms.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false
}: ConfirmModalProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button ref={cancelRef} className="modal-btn cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className={`modal-btn${danger ? ' danger' : ''}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
