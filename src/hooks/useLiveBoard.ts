'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBoardSnapshot } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { BoardSnapshot } from '@/lib/types'

export function useLiveBoard() {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState(false)
  const generation = useRef(0)
  const hasSnapshot = useRef(false)
  const debounceTimer = useRef<number | null>(null)

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

  const scheduleRefresh = useCallback(() => {
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current)
    debounceTimer.current = window.setTimeout(() => void refresh(), 250)
  }, [refresh])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const channel = supabase
      .channel('jettyshare:board', { config: { private: false } })
      .on('broadcast', { event: 'board_changed' }, scheduleRefresh)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void refresh()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setDegraded(true)
      })

    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [refresh, scheduleRefresh])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 60000)
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
