// Outer layer around the verified aggregateConnections core
// (src/utils/aggregate-connections.ts). This file contains NO byte-delta
// logic of its own: every upload/download delta comes from that function.
// What lives here is only what the function does not provide: local-day
// bucketing, proxy/direct partitioning of the snapshot before calling it,
// summing its per-tick outputs into per-day totals, and grouping hosts
// by connection count for the detail view.

export type AppTrafficClass = 'proxy' | 'direct' | 'other'

export type AppTrafficRange = 'today' | 'yesterday' | 'last7' | 'last30'

export type AppTrafficFilter = 'all' | 'proxy' | 'direct'

export interface AppHostRecord {
  proxy: string[]
  direct: string[]
  other: string[]
}

export interface AppDayRecord {
  upload: number
  download: number
  proxyUpload: number
  proxyDownload: number
  directUpload: number
  directDownload: number
  connectionIds: Record<AppTrafficClass, string[]>
  hosts: Record<string, AppHostRecord>
}

export type AppDayTotals = Record<string, AppDayRecord>
export type AppTotalsStore = Record<string, AppDayTotals>

export interface AppTrafficRow {
  key: string
  display: string
  upload: number
  download: number
  total: number
  connections: number
  hosts: { host: string; connections: number }[]
  daily: { dateKey: string; upload: number; download: number; total: number }[]
}

// The literal the core returns for a connection with no process name.
// The page maps it to the translated "Unknown process" label.
export const UNKNOWN_APP_KEY = '未知进程'

const pad = (n: number) => String(n).padStart(2, '0')

// Local calendar day, not UTC: a connection crossing midnight is split
// across the two local days at the tick where the date changes.
export const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const dateKeyOffset = (base: Date, offsetDays: number) => {
  const d = new Date(base)
  d.setDate(d.getDate() + offsetDays)
  return localDateKey(d)
}

export const dateKeysForRange = (
  range: AppTrafficRange,
  now = new Date(),
): string[] => {
  if (range === 'today') return [localDateKey(now)]
  if (range === 'yesterday') return [dateKeyOffset(now, -1)]
  const days = range === 'last7' ? 7 : 30
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) keys.push(dateKeyOffset(now, -i))
  return keys
}

export const hostFromConnection = (conn: IConnectionsItem): string =>
  conn.metadata.host ||
  conn.metadata.destinationIP ||
  conn.metadata.remoteDestination ||
  ''

// A chain of only DIRECT hops is direct traffic; any other non-empty
// chain went through a proxy. An empty chain is classified as other so
// it is counted in "all" but in neither proxy-only nor direct-only view.
export const trafficClassFromConnection = (
  conn: IConnectionsItem,
): AppTrafficClass => {
  const chains = conn.chains || []
  if (chains.length === 0) return 'other'
  return chains.every((c) => c.toUpperCase() === 'DIRECT') ? 'direct' : 'proxy'
}

// Projection for the core: it only reads id, process/processPath and
// the two counters, so nothing else is passed in.
export const toCoreConnection = (conn: IConnectionsItem) => ({
  id: conn.id,
  metadata: {
    process: conn.metadata.process,
    processPath: conn.metadata.processPath,
  },
  upload: conn.upload ?? 0,
  download: conn.download ?? 0,
})

export const emptyDayRecord = (): AppDayRecord => ({
  upload: 0,
  download: 0,
  proxyUpload: 0,
  proxyDownload: 0,
  directUpload: 0,
  directDownload: 0,
  connectionIds: { proxy: [], direct: [], other: [] },
  hosts: {},
})

export const addId = (list: string[], id: string) => {
  if (!list.includes(id)) list.push(id)
}

const pickTotals = (
  record: AppDayRecord,
  filter: AppTrafficFilter,
): { upload: number; download: number } => {
  if (filter === 'proxy')
    return { upload: record.proxyUpload, download: record.proxyDownload }
  if (filter === 'direct')
    return { upload: record.directUpload, download: record.directDownload }
  return { upload: record.upload, download: record.download }
}

export const filterTotals = (
  store: AppTotalsStore,
  dateKeys: string[],
  filter: AppTrafficFilter,
): AppTrafficRow[] => {
  const byApp = new Map<
    string,
    {
      upload: number
      download: number
      connectionIds: Set<string>
      hosts: Map<string, number>
      daily: Map<string, { upload: number; download: number }>
    }
  >()

  for (const dateKey of dateKeys) {
    const day = store[dateKey]
    if (!day) continue
    for (const [appKey, record] of Object.entries(day)) {
      const totals = pickTotals(record, filter)
      const entry = byApp.get(appKey) ?? {
        upload: 0,
        download: 0,
        connectionIds: new Set<string>(),
        hosts: new Map<string, number>(),
        daily: new Map<string, { upload: number; download: number }>(),
      }
      byApp.set(appKey, entry)
      entry.upload += totals.upload
      entry.download += totals.download
      const ids =
        filter === 'all'
          ? [
              ...record.connectionIds.proxy,
              ...record.connectionIds.direct,
              ...record.connectionIds.other,
            ]
          : record.connectionIds[filter]
      for (const id of ids) entry.connectionIds.add(id)
      for (const [host, hostRecord] of Object.entries(record.hosts)) {
        const hostIds =
          filter === 'all'
            ? [...hostRecord.proxy, ...hostRecord.direct, ...hostRecord.other]
            : hostRecord[filter]
        const count = new Set(hostIds).size
        if (count <= 0) continue
        entry.hosts.set(host, (entry.hosts.get(host) ?? 0) + count)
      }
      const daily = entry.daily.get(dateKey) ?? { upload: 0, download: 0 }
      daily.upload += totals.upload
      daily.download += totals.download
      entry.daily.set(dateKey, daily)
    }
  }

  const rows: AppTrafficRow[] = [...byApp.entries()]
    .map(([key, entry]) => ({
      key,
      display: key,
      upload: entry.upload,
      download: entry.download,
      total: entry.upload + entry.download,
      connections: entry.connectionIds.size,
      hosts: [...entry.hosts.entries()]
        .map(([host, connections]) => ({ host, connections }))
        .sort(
          (a, b) => b.connections - a.connections || (a.host < b.host ? -1 : 1),
        ),
      daily: dateKeys.map((dateKey) => {
        const totals = entry.daily.get(dateKey) ?? { upload: 0, download: 0 }
        return {
          dateKey,
          upload: totals.upload,
          download: totals.download,
          total: totals.upload + totals.download,
        }
      }),
    }))
    // An app that only had idle connections in the selected range has
    // no traffic to rank; it is kept in the store so its connection
    // ids still count if it transfers later in the same day.
    .filter((row) => row.total > 0)

  rows.sort((a, b) => b.total - a.total || (a.key < b.key ? -1 : 1))
  return rows
}

export const pruneStore = (
  store: AppTotalsStore,
  keepDateKeys: string[],
): AppTotalsStore => {
  const keep = new Set(keepDateKeys)
  for (const key of Object.keys(store)) {
    if (!keep.has(key)) delete store[key]
  }
  return store
}
