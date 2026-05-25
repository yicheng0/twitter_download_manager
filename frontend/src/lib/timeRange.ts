export type TimePreset = '7d' | '30d' | '90d' | 'year' | 'all' | 'custom';

export const TIME_PRESETS: Array<{ key: TimePreset; label: string }> = [
  { key: '7d', label: '最近7天' },
  { key: '30d', label: '最近30天' },
  { key: '90d', label: '最近90天' },
  { key: 'year', label: '今年' },
  { key: 'all', label: '全部' },
];

export function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayString() {
  return formatDate(new Date());
}

function rangeByDays(days: number) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - days + 1);
  return `${formatDate(start)}:${formatDate(today)}`;
}

export function rangeFromPreset(preset: TimePreset) {
  const today = new Date();
  const end = formatDate(today);
  if (preset === 'all') return rangeByDays(365);
  if (preset === 'year') return `${today.getFullYear()}-01-01:${end}`;
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  return rangeByDays(days);
}

export function defaultTaskTimeRange() {
  return rangeFromPreset('90d');
}

export function defaultRunTimeRange() {
  return rangeFromPreset('all');
}

export function splitTimeRange(timeRange: string) {
  const [start = '', end = ''] = String(timeRange || '').split(':');
  return { start, end };
}

export function timeRangeError(timeRange: string) {
  const { start, end } = splitTimeRange(timeRange);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return '请选择完整的开始日期和结束日期。';
  }
  if (end < start) {
    return '结束日期不能早于开始日期。';
  }
  if (end > todayString()) {
    return '结束日期不能晚于今天。';
  }
  return '';
}

export function presetFromTimeRange(timeRange: string): TimePreset {
  return TIME_PRESETS.find((item) => rangeFromPreset(item.key) === timeRange)?.key || 'custom';
}
