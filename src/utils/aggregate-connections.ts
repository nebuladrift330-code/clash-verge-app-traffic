type Conn = {
  id: string
  metadata: { process?: string; processPath?: string }
  upload: number
  download: number
}

type Snapshot = { connections: Conn[] }

type PrevEntry = { upload: number; download: number; process: string }

type Prev = Record<string, PrevEntry>

type AppStat = {
  app: string
  upload: number
  download: number
  connections: number
}

type Result = { perApp: AppStat[]; nextPrev: Prev }

function resolveProcessName(metadata: Conn['metadata']): string {
  const processValue = metadata.process
  if (typeof processValue === 'string') {
    const trimmed = processValue.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }

  const processPathValue = metadata.processPath
  if (typeof processPathValue === 'string' && processPathValue.length > 0) {
    // Split on both forward slash and backslash
    const parts = processPathValue.split(/[\\/]/)
    if (parts.length > 0) {
      const baseName = parts[parts.length - 1]
      if (typeof baseName === 'string') {
        const trimmedBase = baseName.trim()
        if (trimmedBase.length > 0) {
          return trimmedBase
        }
      }
    }
  }

  return '未知进程'
}

export function aggregateConnections(prev: Prev, snap: Snapshot): Result {
  const nextPrev: Prev = {}
  const appBucketMap = new Map<
    string,
    { upload: number; download: number; connections: number }
  >()

  const snapConnections = snap.connections

  for (let i = 0; i < snapConnections.length; i++) {
    const conn = snapConnections[i]
    const connId = conn.id

    const prevEntry = prev[connId]

    if (prevEntry !== undefined) {
      // Connection existed before: use process name stored in prev
      const bucketApp = prevEntry.process

      // Calculate deltas (never negative)
      let deltaUpload = conn.upload - prevEntry.upload
      if (deltaUpload < 0) {
        deltaUpload = 0
      }

      let deltaDownload = conn.download - prevEntry.download
      if (deltaDownload < 0) {
        deltaDownload = 0
      }

      // Update nextPrev with current upload/download and prev process name
      nextPrev[connId] = {
        upload: conn.upload,
        download: conn.download,
        process: prevEntry.process,
      }

      // Add to bucket
      const existingBucket = appBucketMap.get(bucketApp)
      if (existingBucket === undefined) {
        appBucketMap.set(bucketApp, {
          upload: deltaUpload,
          download: deltaDownload,
          connections: 1,
        })
      } else {
        existingBucket.upload += deltaUpload
        existingBucket.download += deltaDownload
        existingBucket.connections += 1
        appBucketMap.set(bucketApp, existingBucket)
      }
    } else {
      // Connection not in prev: baseline only
      const resolvedApp = resolveProcessName(conn.metadata)

      // Count 0 bytes now
      // Record in nextPrev with current upload/download and resolved process name
      nextPrev[connId] = {
        upload: conn.upload,
        download: conn.download,
        process: resolvedApp,
      }

      // Count in connections for its app, 0 bytes
      const existingBucket = appBucketMap.get(resolvedApp)
      if (existingBucket === undefined) {
        appBucketMap.set(resolvedApp, {
          upload: 0,
          download: 0,
          connections: 1,
        })
      } else {
        existingBucket.connections += 1
        // upload and download remain the same
        appBucketMap.set(resolvedApp, existingBucket)
      }
    }
  }

  // Build perApp array
  const perAppArray: AppStat[] = []
  appBucketMap.forEach((bucketValue, appName) => {
    perAppArray.push({
      app: appName,
      upload: bucketValue.upload,
      download: bucketValue.download,
      connections: bucketValue.connections,
    })
  })

  // Sort: by (upload+download) descending, then app name ascending
  perAppArray.sort((a, b) => {
    const totalA = a.upload + a.download
    const totalB = b.upload + b.download
    if (totalA !== totalB) {
      if (totalA > totalB) {
        return -1
      }
      if (totalA < totalB) {
        return 1
      }
      return 0
    }
    // Compare app names ascending
    if (a.app < b.app) {
      return -1
    }
    if (a.app > b.app) {
      return 1
    }
    return 0
  })

  const result: Result = {
    perApp: perAppArray,
    nextPrev: nextPrev,
  }

  return result
}
