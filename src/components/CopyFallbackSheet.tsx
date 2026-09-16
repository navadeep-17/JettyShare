'use client'

import { useRef } from 'react'
import { useModalFocus } from '@/hooks/useModalFocus'

export function CopyFallbackSheet({
  text,
  lastKnown,
  onRetryRefresh,
  onClose,
}: {
  text: string
  lastKnown: boolean
  onRetryRefresh?: () => void
  onClose: () => void
}) {
  const dialogRef = useModalFocus(onClose)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  function selectAll() {
    ref.current?.focus()
    ref.current?.select()
  }

  return <div className="overlay" role="presentation">
    <div ref={dialogRef} className="sheet" role="dialog" aria-modal="true" aria-labelledby="copy-fallback-title">
      <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
      <p className="eyebrow">MANUAL COPY</p>
      <h2 id="copy-fallback-title">{lastKnown ? 'Last-known supply summary' : 'Copy supply summary'}</h2>
      <p className={lastKnown ? 'fallback-warning' : 'muted'}>
        {lastKnown
          ? 'The live board could not be refreshed. This text is clearly marked last-known so stale availability is not presented as current.'
          : 'Clipboard access is unavailable. Select the text below and use your browser copy command.'}
      </p>
      <textarea ref={ref} className="copy-fallback-text" readOnly value={text} onFocus={(event)=>event.currentTarget.select()} aria-label="Supply summary text" />
      <div className="action-grid">
        <button className="button button-primary" onClick={selectAll}>Select all</button>
        {lastKnown && onRetryRefresh
          ? <button className="button" onClick={onRetryRefresh}>Retry refresh</button>
          : <button className="button" onClick={onClose}>Close</button>}
      </div>
      {lastKnown && onRetryRefresh && <button className="button copy-fallback-close" onClick={onClose}>Close</button>}
    </div>
  </div>
}
