import { useEffect, useRef, useState } from 'react'

import { useConnectionData } from '@/hooks/use-connection-data'
import { useVisibility } from '@/hooks/use-visibility'
import { aggregateConnections } from '@/utils/aggregate-connections'
import {
  addId,
  dateKeysForRange,
  emptyDayRecord,
  filterTotals,
  hostFromConnection,
  localDateKey,
  pruneStore,
  toCoreConnection,
  trafficClassFromConnection,
  type AppTotalsStore,
  type AppTrafficClass,
  type AppTrafficFilter,
  type AppTrafficRange,
  type AppTrafficRow,
} from '@/utils/app-traffic'

const TOTALS_STORAGE_KEY = 'verge-app-traffic-v1'
const PREV_STORAGE_KEY = 'verge-app-traffic-prev-v1'

// The core's per-connection baseline, kept separately per traffic class
// so one call per class yields class-specific tick deltas. The shape
// matches the core's Prev type structurally; the core itself owns the
// baseline/delta rules and this hook never recomputes a delta.
type CorePrev = Record<
  string,
  { upload: number; download: number; process: string }
>
type PrevByClass = Record<AppTrafficClass, CorePrev>

const CLASSES: AppTrafficClass[] = ['proxy', 'direct', 'other']

const emptyPrevByClass = (): PrevByClass => ({
  proxy: {},
  direct: {},
  other: {},
})

const readJson = <T>(key: string): T | null => {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const writeJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be full or unavailable; totals already live in memory.
  }
}

const isTotalsStore = (value: unknown): value is AppTotalsStore =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isPrevByClass = (value: unknown): value is PrevByClass => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return CLASSES.every(
    (c) =>
      !!record[c] && typeof record[c] === 'object' && !Array.isArray(record[c]),
  )
}

// Aggregates the shared connection stream into per-day, per-application
// totals and persists them in localStorage, so a page refresh keeps the
// counted history. Byte deltas come only from aggregateConnections, one
// call per traffic class per snapshot. The app name used to attribute a
// connection's distinct-id and host entries is taken from the core's
// returned nextPrev, never re-resolved here.
export const useAppTraffic = (
  range: AppTrafficRange,
  filter: AppTrafficFilter,
) => {
  const pageVisible = useVisibility()
  const {
    response: { data: connections },
  } = useConnectionData({ enabled: pageVisible })

  const stateRef = useRef<{
    store: AppTotalsStore
    prevByClass: PrevByClass
  } | null>(null)
  if (!stateRef.current) {
    const storedTotals = readJson<AppTotalsStore>(TOTALS_STORAGE_KEY)
    const store = isTotalsStore(storedTotals) ? storedTotals : {}
    pruneStore(store, dateKeysForRange('last30'))
    const storedPrev = readJson<PrevByClass>(PREV_STORAGE_KEY)
    stateRef.current = {
      store,
      prevByClass: isPrevByClass(storedPrev) ? storedPrev : emptyPrevByClass(),
    }
  }

  const [storeVersion, setStoreVersion] = useState(0)

  useEffect(() => {
    const state = stateRef.current
    if (!state || !connections) return
    const active = connections.activeConnections ?? []
    if (active.length === 0) return

    const now = new Date()
    const dateKey = localDateKey(now)
    const day = (state.store[dateKey] ??= {})
    let changed = false

    for (const trafficClass of CLASSES) {
      const classConns = active.filter(
        (conn) => trafficClassFromConnection(conn) === trafficClass,
      )
      if (classConns.length === 0) continue
      const result = aggregateConnections(state.prevByClass[trafficClass], {
        connections: classConns.map(toCoreConnection),
      })
      state.prevByClass[trafficClass] = result.nextPrev

      for (const entry of result.perApp) {
        if (entry.upload <= 0 && entry.download <= 0) continue
        const record = (day[entry.app] ??= emptyDayRecord())
        record.upload += entry.upload
        record.download += entry.download
        if (trafficClass === 'proxy') {
          record.proxyUpload += entry.upload
          record.proxyDownload += entry.download
        } else if (trafficClass === 'direct') {
          record.directUpload += entry.upload
          record.directDownload += entry.download
        }
        changed = true
      }

      for (const conn of classConns) {
        const appName = result.nextPrev[conn.id]?.process
        if (!appName) continue
        const record = (day[appName] ??= emptyDayRecord())
        addId(record.connectionIds[trafficClass], conn.id)
        const host = hostFromConnection(conn)
        if (!host) continue
        const hostRecord = (record.hosts[host] ??= {
          proxy: [],
          direct: [],
          other: [],
        })
        addId(hostRecord[trafficClass], conn.id)
      }
    }

    if (!changed) return
    pruneStore(state.store, dateKeysForRange('last30'))
    // Totals and baselines are written together so a reload never
    // recounts bytes already stored in the totals.
    writeJson(TOTALS_STORAGE_KEY, state.store)
    writeJson(PREV_STORAGE_KEY, state.prevByClass)
    // Defer the version bump out of the effect so the store write does not
    // synchronously set state during the effect; the bump still lands
    // before paint and triggers the rows recompute.
    queueMicrotask(() => setStoreVersion((v) => v + 1))
  }, [connections])

  useEffect(
    () => () => {
      const state = stateRef.current
      if (!state) return
      writeJson(TOTALS_STORAGE_KEY, state.store)
      writeJson(PREV_STORAGE_KEY, state.prevByClass)
    },
    [],
  )

  const rows: AppTrafficRow[] = (() => {
    const state = stateRef.current
    if (!state) return []
    // storeVersion forces a recompute after each counted tick.
    void storeVersion
    return filterTotals(state.store, dateKeysForRange(range), filter)
  })()

  const totals = {
    upload: rows.reduce((sum, row) => sum + row.upload, 0),
    download: rows.reduce((sum, row) => sum + row.download, 0),
    total: rows.reduce((sum, row) => sum + row.total, 0),
    appCount: rows.length,
  }

  return { rows, totals }
}
