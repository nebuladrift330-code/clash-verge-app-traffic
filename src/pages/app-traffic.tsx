import {
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseEmpty, BasePage } from '@/components/base'
import { useAppTraffic } from '@/hooks/use-app-traffic'
import parseTraffic from '@/utils/parse-traffic'
import {
  UNKNOWN_APP_KEY,
  type AppTrafficFilter,
  type AppTrafficRange,
} from '@/utils/app-traffic'

const formatBytes = (num: number) => {
  const [value, unit] = parseTraffic(num)
  return unit ? `${value} ${unit}` : value
}

const formatDateLabel = (dateKey: string) => {
  const [, month, day] = dateKey.split('-')
  return `${month}/${day}`
}

const csvEscape = (value: string | number) =>
  `"${String(value).replace(/"/g, '""')}"`

const AppTrafficPage = () => {
  const { t } = useTranslation()
  const [range, setRange] = useState<AppTrafficRange>('last7')
  const [filter, setFilter] = useState<AppTrafficFilter>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const { rows, totals } = useAppTraffic(range, filter)

  useEffect(() => {
    if (!selectedKey && rows.length > 0) setSelectedKey(rows[0].key)
    if (selectedKey && !rows.some((row) => row.key === selectedKey)) {
      setSelectedKey(null)
    }
  }, [rows, selectedKey])

  const selected = useMemo(
    () => rows.find((row) => row.key === selectedKey) ?? null,
    [rows, selectedKey],
  )

  const maxTotal = useMemo(
    () => Math.max(0, ...rows.map((row) => row.total)),
    [rows],
  )

  const maxDailyTotal = useMemo(
    () => Math.max(0, ...(selected?.daily.map((d) => d.total) ?? [0])),
    [selected],
  )

  const handleExportCsv = () => {
    const header = [
      t('app-traffic.table.app'),
      t('app-traffic.table.download'),
      t('app-traffic.table.upload'),
      t('app-traffic.table.total'),
      t('app-traffic.table.connections'),
    ]
    const lines = rows.map((row) =>
      [
        row.display === UNKNOWN_APP_KEY
          ? t('app-traffic.table.unknownApp')
          : row.display,
        row.download,
        row.upload,
        row.total,
        row.connections,
      ]
        .map(csvEscape)
        .join(','),
    )
    const blob = new Blob([[header.map(csvEscape).join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `app-traffic-${range}-${filter}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const rangeOptions: { id: AppTrafficRange; label: string }[] = [
    { id: 'today', label: t('app-traffic.filters.today') },
    { id: 'yesterday', label: t('app-traffic.filters.yesterday') },
    { id: 'last7', label: t('app-traffic.filters.last7') },
    { id: 'last30', label: t('app-traffic.filters.last30') },
  ]
  const filterOptions: { id: AppTrafficFilter; label: string }[] = [
    { id: 'all', label: t('app-traffic.filters.all') },
    { id: 'proxy', label: t('app-traffic.filters.proxyOnly') },
    { id: 'direct', label: t('app-traffic.filters.directOnly') },
  ]

  const summaryCards = [
    { label: t('app-traffic.summary.total'), value: formatBytes(totals.total) },
    {
      label: t('app-traffic.summary.download'),
      value: formatBytes(totals.download),
    },
    {
      label: t('app-traffic.summary.upload'),
      value: formatBytes(totals.upload),
    },
    {
      label: t('app-traffic.summary.apps'),
      value: String(totals.appCount),
    },
  ]

  return (
    <BasePage
      full
      title={t('app-traffic.page.title')}
      contentStyle={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        padding: '16px',
        gap: '16px',
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {t('app-traffic.page.noteMihomo')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('app-traffic.page.noteHistory')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('app-traffic.page.noteFindProcess')}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <ButtonGroup variant="outlined" size="small">
          {rangeOptions.map((option) => (
            <Button
              key={option.id}
              variant={range === option.id ? 'contained' : 'outlined'}
              onClick={() => setRange(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </ButtonGroup>
        <ButtonGroup variant="outlined" size="small">
          {filterOptions.map((option) => (
            <Button
              key={option.id}
              variant={filter === option.id ? 'contained' : 'outlined'}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </ButtonGroup>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="outlined" size="small" onClick={handleExportCsv}>
          {t('app-traffic.filters.exportCsv')}
        </Button>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {summaryCards.map((card) => (
          <Card key={card.label} sx={{ flex: '1 1 180px' }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                {card.label}
              </Typography>
              <Typography variant="h5">{card.value}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {rows.length === 0 ? (
        <BaseEmpty />
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('app-traffic.table.app')}</TableCell>
                <TableCell>{t('app-traffic.table.download')}</TableCell>
                <TableCell>{t('app-traffic.table.upload')}</TableCell>
                <TableCell>{t('app-traffic.table.total')}</TableCell>
                <TableCell>{t('app-traffic.table.share')}</TableCell>
                <TableCell>{t('app-traffic.table.connections')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const share = totals.total > 0 ? row.total / totals.total : 0
                return (
                  <TableRow
                    key={row.key}
                    hover
                    selected={row.key === selectedKey}
                    onClick={() => setSelectedKey(row.key)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      {row.display === UNKNOWN_APP_KEY
                        ? t('app-traffic.table.unknownApp')
                        : row.display}
                    </TableCell>
                    <TableCell>{formatBytes(row.download)}</TableCell>
                    <TableCell>{formatBytes(row.upload)}</TableCell>
                    <TableCell>{formatBytes(row.total)}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box
                          sx={{
                            width: 120,
                            height: 8,
                            bgcolor: 'action.hover',
                            borderRadius: 1,
                            overflow: 'hidden',
                          }}
                        >
                          <Box
                            sx={{
                              width: `${Math.max(0, Math.min(100, share * 100))}%`,
                              height: '100%',
                              bgcolor: 'primary.main',
                            }}
                          />
                        </Box>
                        <span>{(share * 100).toFixed(1)}%</span>
                      </Box>
                    </TableCell>
                    <TableCell>{row.connections.toLocaleString()}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {selected && (
        <Card>
          <CardContent>
            <Typography variant="h6">
              {t('app-traffic.detail.title', {
                app:
                  selected.display === UNKNOWN_APP_KEY
                    ? t('app-traffic.table.unknownApp')
                    : selected.display,
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('app-traffic.detail.total', {
                total: formatBytes(selected.total),
                download: formatBytes(selected.download),
                upload: formatBytes(selected.upload),
              })}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 2,
                height: 110,
                mt: 2,
              }}
            >
              {selected.daily.map((day) => (
                <Box
                  key={day.dateKey}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  <Box
                    sx={{
                      width: 32,
                      height:
                        maxDailyTotal > 0
                          ? Math.max(2, (day.total / maxDailyTotal) * 80)
                          : 2,
                      bgcolor: 'primary.main',
                    }}
                  />
                  <Typography variant="caption">
                    {formatDateLabel(day.dateKey)}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              {t('app-traffic.detail.topHosts')}
            </Typography>
            {selected.hosts.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('app-traffic.detail.noHosts')}
              </Typography>
            ) : (
              selected.hosts.slice(0, 6).map((host) => (
                <Typography key={host.host} variant="body2">
                  {host.host} —{' '}
                  {t('app-traffic.detail.hostConnections', {
                    count: host.connections,
                  })}
                </Typography>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </BasePage>
  )
}

export default AppTrafficPage
