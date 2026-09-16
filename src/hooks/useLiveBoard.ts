'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBoardSnapshot } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { adjustedNow, serverClockOffset } from '@/lib/time'
import type { BoardSnapshot } from '@/lib/types'

const RETRY_DELAYS_MS = [5000, 15000, 30000] as const

type RefreshOptions = { coalesce?: boolean }

export function useLiveBoard() {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [initialError, setInitialError] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [clockNowMs, setClockNowMs] = useState(() => Date.now())
  const [failureCount, setFailureCount] = useState(0)
  const generation = useRef(0)
  const hasSnapshot = useRef(false)
  const debounceTimer = useRef<number | null>(null)
  const retryTimer = useRef<number | null>(null)
  const requestsInFlight = useRef(0)
  const backgroundRefreshQueued = useRef(false)
  const queuedRefreshRunner = useRef<() => void>(() => undefined)

  const clearRetryTimer = useCallback(() => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
  }, [])

  const refresh = useCallback(async (options: RefreshOptions = {}): Promise<BoardSnapshot | null> => {
    // Realtime/focus/timer invalidations are hints, not separate sources of
    // truth. If a request is already running, coalesce a burst of those hints
    // into one follow-up read instead of repeatedly superseding a slow request.
    // Explicit user/mutation refreshes still start immediately, so a newer
    // authoritative read can overtake an older delayed response; generation
    // guarding below prevents the old response from resurrecting stale state.
    if (options.coalesce && requestsInFlight.current > 0) {
      backgroundRefreshQueued.current = true
      return null
    }

    clearRetryTimer()
    const mine = ++generation.current
    requestsInFlight.current += 1
    if (!hasSnapshot.current) setLoading(true)

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
      setFailureCount(0)
      return next
    } catch {
      if (mine !== generation.current) return null
      setFailureCount((count) => count + 1)
      if (hasSnapshot.current) setDegraded(true)
      else setInitialError(true)
      return null
    } finally {
      requestsInFlight.current = Math.max(0, requestsInFlight.current - 1)
      if (mine === generation.current) setLoading(false)
      if (requestsInFlight.current === 0 && backgroundRefreshQueued.current) {
        backgroundRefreshQueued.current = false
        window.setTimeout(() => queuedRefreshRunner.current(), 0)
      }
    }
  }, [clearRetryTimer])

  queuedRefreshRunner.current = () => { void refresh({ coalesce: true }) }

  const scheduleRefresh = useCallback(() => {
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current)
    debounceTimer.current = window.setTimeout(() => void refresh({ coalesce: true }), 250)
  }, [refresh])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (failureCount < 1 || document.visibilityState !== 'visible') return
    const delay = RETRY_DELAYS_MS[Math.min(failureCount - 1, RETRY_DELAYS_MS.length - 1)]
    clearRetryTimer()
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null
      void refresh({ coalesce: true })
    }, delay)
    return clearRetryTimer
  }, [failureCount, refresh, clearRetryTimer])

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
        if (status === 'SUBSCRIBED') void refresh({ coalesce: true })
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setDegraded(true)
      })

    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [refresh, scheduleRefresh])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh({ coalesce: true })
    }, 60000)

    const reconcile = () => {
      if (document.visibilityState === 'visible') void refresh({ coalesce: true })
      else clearRetryTimer()
    }

    window.addEventListener('focus', reconcile)
    window.addEventListener('online', reconcile)
    document.addEventListener('visibilitychange', reconcile)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('online', reconcile)
      document.removeEventListener('visibilitychange', reconcile)
    }
  }, [refresh, clearRetryTimer])

  useEffect(() => {
    if (!snapshot?.next_transition_at) return
    const delay = Math.max(100, new Date(snapshot.next_transition_at).getTime() - adjustedNow(clockOffsetMs) + 250)
    const timer = window.setTimeout(() => void refresh({ coalesce: true }), Math.min(delay, 2147483647))
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
