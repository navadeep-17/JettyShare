'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBoardSnapshot } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { adjustedNow, serverClockOffset } from '@/lib/time'
import type { BoardSnapshot } from '@/lib/types'

export function useLiveBoard() {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [initialError, setInitialError] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [clockNowMs, setClockNowMs] = useState(() => Date.now())
  const generation = useRef(0)
  const hasSnapshot = useRef(false)
  const debounceTimer = useRef<number | null>(null)

  const refresh = useCallback(async (): Promise<BoardSnapshot | null> => {
    const mine = ++generation.current
    try {
      const next = await getBoardSnapshot()
      if (mine !== generation.current) return null
      const receivedAt = Date.now()
      const offset = serverClockOffset(next.server_now, receivedAt)
      setSnapshot(next)
      setClockOffsetMs(offset)
      setClockNowMs(adjustedNow(offset, receivedAt))
      setLastSuccessAt(receivedAt)
      hasSnapshot.current = true
      setInitialError(false)
      setDegraded(false)
      return next
    } catch {
      if (mine !== generation.current) return null
      if (hasSnapshot.current) setDegraded(true)
      else setInitialError(true)
      return null
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
    const timer = window.setInterval(() => {
      setClockNowMs(adjustedNow(clockOffsetMs))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [clockOffsetMs])

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
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refresh])

  useEffect(() => {
    if (!snapshot?.next_transition_at) return
    const delay = Math.max(100, new Date(snapshot.next_transition_at).getTime() - adjustedNow(clockOffsetMs) + 250)
    const timer = window.setTimeout(() => void refresh(), Math.min(delay, 2147483647))
    return () => window.clearTimeout(timer)
  }, [snapshot?.next_transition_at, clockOffsetMs, refresh])

  return {
    snapshot,
    loading,
    initialError,
    degraded,
    lastSuccessAt,
    clockOffsetMs,
    clockNowMs,
    refresh,
  }
}
