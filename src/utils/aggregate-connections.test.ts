import { describe, expect, test } from 'vitest'

import { aggregateConnections } from './aggregate-connections'

// Test cases retained from the verified Tokyo trial
// (~/workspace/temp/tokyo-trial/test.mts and test2.mts), adapted only
// from their standalone runner to this repo's vitest style. The
// aggregateConnections implementation under test is unchanged apart
// from its added export.
describe('aggregateConnections (Tokyo trial cases)', () => {
  test('baseline counts no bytes and resolves process names', () => {
    const result = aggregateConnections(
      {},
      {
        connections: [
          {
            id: 'c1',
            metadata: { process: 'chrome' },
            upload: 100,
            download: 1000,
          },
          {
            id: 'c2',
            metadata: { processPath: 'C:\\Program Files\\Steam\\steam.exe' },
            upload: 50,
            download: 500,
          },
          { id: 'c3', metadata: {}, upload: 0, download: 0 },
        ],
      },
    )
    expect(result.perApp).toEqual([
      { app: 'chrome', upload: 0, download: 0, connections: 1 },
      { app: 'steam.exe', upload: 0, download: 0, connections: 1 },
      { app: '未知进程', upload: 0, download: 0, connections: 1 },
    ])
  })

  test('delta uses the previous process name and drops closed connections', () => {
    const first = aggregateConnections(
      {},
      {
        connections: [
          {
            id: 'c1',
            metadata: { process: 'chrome' },
            upload: 100,
            download: 1000,
          },
          {
            id: 'c2',
            metadata: { processPath: 'C:\\Program Files\\Steam\\steam.exe' },
            upload: 50,
            download: 500,
          },
          { id: 'c3', metadata: {}, upload: 0, download: 0 },
        ],
      },
    )
    const prevCopy = JSON.parse(JSON.stringify(first.nextPrev))
    const second = aggregateConnections(first.nextPrev, {
      connections: [
        {
          id: 'c1',
          metadata: { process: 'ChromeNew' },
          upload: 150,
          download: 1500,
        },
        {
          id: 'c2',
          metadata: { processPath: 'C:\\Program Files\\Steam\\steam.exe' },
          upload: 50,
          download: 500,
        },
        {
          id: 'c4',
          metadata: { process: 'discord' },
          upload: 10,
          download: 20,
        },
      ],
    })
    expect(second.perApp.find((x) => x.app === 'chrome')).toEqual({
      app: 'chrome',
      upload: 50,
      download: 500,
      connections: 1,
    })
    expect(second.perApp.find((x) => x.app === 'ChromeNew')).toBeUndefined()
    expect(second.perApp.find((x) => x.app === 'steam.exe')).toEqual({
      app: 'steam.exe',
      upload: 0,
      download: 0,
      connections: 1,
    })
    expect(second.perApp.find((x) => x.app === 'discord')).toEqual({
      app: 'discord',
      upload: 0,
      download: 0,
      connections: 1,
    })
    expect('c3' in second.nextPrev).toBe(false)
    expect(first.nextPrev).toEqual(prevCopy)
  })

  test('negative deltas are clamped to zero', () => {
    const first = aggregateConnections(
      {},
      {
        connections: [
          {
            id: 'c1',
            metadata: { process: 'chrome' },
            upload: 150,
            download: 1500,
          },
        ],
      },
    )
    const second = aggregateConnections(first.nextPrev, {
      connections: [
        {
          id: 'c1',
          metadata: { process: 'chrome' },
          upload: 10,
          download: 100,
        },
      ],
    })
    expect(second.perApp).toEqual([
      { app: 'chrome', upload: 0, download: 0, connections: 1 },
    ])
  })

  test('blank process falls back to the path basename', () => {
    const result = aggregateConnections(
      {},
      {
        connections: [
          {
            id: 'a',
            metadata: { process: '   ', processPath: '/usr/bin/firefox' },
            upload: 0,
            download: 0,
          },
        ],
      },
    )
    expect(result.perApp).toEqual([
      { app: 'firefox', upload: 0, download: 0, connections: 1 },
    ])
  })

  test('trailing slash path resolves to unknown process', () => {
    const result = aggregateConnections(
      {},
      {
        connections: [
          {
            id: 'a',
            metadata: { processPath: 'C:\\Program Files\\Steam\\' },
            upload: 0,
            download: 0,
          },
        ],
      },
    )
    expect(result.perApp).toEqual([
      { app: '未知进程', upload: 0, download: 0, connections: 1 },
    ])
  })

  test('windows backslash path yields the file name', () => {
    const result = aggregateConnections(
      {},
      {
        connections: [
          {
            id: 'a',
            metadata: { processPath: 'C:\\Users\\x\\AppData\\Discord.exe' },
            upload: 0,
            download: 0,
          },
        ],
      },
    )
    expect(result.perApp[0].app).toBe('Discord.exe')
  })

  test('equal totals sort by app name ascending', () => {
    const first = aggregateConnections(
      {},
      {
        connections: [
          { id: 'b', metadata: { process: 'beta' }, upload: 0, download: 0 },
          { id: 'a', metadata: { process: 'alpha' }, upload: 0, download: 0 },
        ],
      },
    )
    const second = aggregateConnections(first.nextPrev, {
      connections: [
        { id: 'b', metadata: { process: 'beta' }, upload: 10, download: 0 },
        { id: 'a', metadata: { process: 'alpha' }, upload: 0, download: 10 },
      ],
    })
    expect(second.perApp.map((x) => x.app)).toEqual(['alpha', 'beta'])
    expect(second.perApp.map((x) => x.upload + x.download)).toEqual([10, 10])
  })

  test('large integers do not drift', () => {
    const first = aggregateConnections(
      {},
      {
        connections: [
          {
            id: 'x',
            metadata: { process: 'big' },
            upload: 9007199254740990,
            download: 0,
          },
        ],
      },
    )
    const second = aggregateConnections(first.nextPrev, {
      connections: [
        {
          id: 'x',
          metadata: { process: 'big' },
          upload: 9007199254740991,
          download: 0,
        },
      ],
    })
    expect(second.perApp).toEqual([
      { app: 'big', upload: 1, download: 0, connections: 1 },
    ])
  })

  test('empty snapshot yields empty output and drops all previous state', () => {
    const first = aggregateConnections(
      {},
      {
        connections: [
          {
            id: 'x',
            metadata: { process: 'big' },
            upload: 9007199254740990,
            download: 0,
          },
        ],
      },
    )
    expect(aggregateConnections(first.nextPrev, { connections: [] })).toEqual({
      perApp: [],
      nextPrev: {},
    })
  })

  test('chained snapshots count each delta only once', () => {
    const s0 = aggregateConnections(
      {},
      {
        connections: [
          {
            id: 'k',
            metadata: { process: 'wechat' },
            upload: 100,
            download: 200,
          },
        ],
      },
    )
    const s1 = aggregateConnections(s0.nextPrev, {
      connections: [
        {
          id: 'k',
          metadata: { process: 'wechat' },
          upload: 150,
          download: 300,
        },
      ],
    })
    const s2 = aggregateConnections(s1.nextPrev, {
      connections: [
        {
          id: 'k',
          metadata: { process: 'wechat' },
          upload: 150,
          download: 300,
        },
      ],
    })
    expect(s1.perApp).toEqual([
      { app: 'wechat', upload: 50, download: 100, connections: 1 },
    ])
    expect(s2.perApp).toEqual([
      { app: 'wechat', upload: 0, download: 0, connections: 1 },
    ])
  })
})
