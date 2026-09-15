'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBoardSnapshot } from '@/lib/api'
import type { BoardSnapshot } from '@/lib/types'

export function useLiveBoard() {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState(false)
  const generation = useRef(0)
  const hasSnapshot = useRef(false)

  const refresh = useCallback(async () => {
    const mine = ++generation.current
    try {
      const next = await getBoardSnapshot()
      if (mine !== generation.current) return
      setSnapshot(next)
      hasSnapshot.current = true
      setDegraded(false)
    } catch {
      if (mine !== generation.current) return
      if (hasSnapshot.current) setDegraded(true)
    } finally {
      if (mine === generation.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 15000)
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refresh])

  useEffect(() => {
    if (!snapshot?.next_transition_at) return
    const delay = Math.max(100, new Date(snapshot.next_transition_at).getTime() - Date.now() + 250)
    const timer = window.setTimeout(() => void refresh(), Math.min(delay, 2147483647))
    return () => clearTimeout(timer)
  }, [snapshot?.next_transition_at, refresh])

  return { snapshot, loading, degraded, refresh }
}
