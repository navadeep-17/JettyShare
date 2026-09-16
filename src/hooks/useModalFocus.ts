'use client'

import { useLayoutEffect, useRef } from 'react'

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useModalFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = ref.current
    const first = root?.querySelector<HTMLElement>(focusableSelector)
    first?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !root) return
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(focusableSelector))
      if (!focusable.length) return
      const firstItem = focusable[0]
      const lastItem = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [])

  return ref
}
