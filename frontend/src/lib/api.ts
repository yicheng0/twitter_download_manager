import type { Account, AccountWarmupRun, ApiError, BitBrowserImportResponse, Dashboard, DashboardHeatmapItems, HealthStatus, LocalBrowserLoginHelperStatus, LoginQueueParseResponse, LoginQueueResponse, OperationLogResponse, ProxyItem, ResultDbConfig, ResultDbFormValues, RunConfig, RunStatus, ScheduledTask, Task, TaskItemsResponse, TrackedBlogger } from './types';

type OperationLogParams = {
  task_id?: number;
  schedule_id?: number;
  level?: string;
  event_type?: string;
  error_type?: string;
  start_at?: string;
  end_at?: string;
  q?: string;
  offset?: number;
  limit?: number;
};

function operationLogQuery(params?: OperationLogParams) {
  const query = new URLSearchParams();
  if (params?.task_id) query.set('task_id', String(params.task_id));
  if (params?.schedule_id) query.set('schedule_id', String(params.schedule_id));
  if (params?.level) query.set('level', params.level);
  if (params?.event_type) query.set('event_type', params.event_type);
  if (params?.error_type) query.set('error_type', params.error_type);
  if (params?.start_at) query.set('start_at', params.start_at);
  if (params?.end_at) query.set('end_at', params.end_at);
  if (params?.q) query.set('q', params.q);
  if (params?.offset) query.set('offset', String(params.offset));
  if (params?.limit) query.set('limit', String(params.limit));
  return query;
}

export type LocalBrowserLoginResponse = {
  status: string;
  message: string;
  token: string;
  expires_in: number;
  callback_url?: string;
  screen_name?: string;
};

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    let payload: ApiError | null = null;
    try {
      payload = await response.json();
    } catch {
      payload = { detail: response.statusText };
    }
    throw new Error(payload?.detail || response.statusText);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  me: () => request<{ user: import('./types').User }>('/api/me'),
  login: (payload: { username: string; password: string }) => request<{ user: import('./types').User }>('/api/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),
  healthStatus: () => request<HealthStatus>('/api/health/status'),
  dashboard: (params?: { heatmap_days?: number }) => {
    const query = new URLSearchParams();
    if (params?.heatmap_days) query.set('heatmap_days', String(params.heatmap_days));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<Dashboard>(`/api/dashboard${suffix}`);
  },
  dashboardHeatmapItems: (params: { date: string; hour: number; limit?: number }) => {
    const query = new URLSearchParams({ date: params.date, hour: String(params.hour) });
    if (params.limit) query.set('limit', String(params.limit));
    return request<DashboardHeatmapItems>(`/api/dashboard/heatmap/items?${query.toString()}`);
  },
  tasks: () => request<{ tasks: Task[] }>('/api/tasks'),
  task: (id: number) => request<{ task: Task }>(`/api/tasks/${id}`),
  bloggers: () => request<{ bloggers: TrackedBlogger[] }>('/api/bloggers'),
  addBlogger: (payload: { screen_name: string; display_name?: string; default_tweet_limit?: number }) => request<{ blogger: TrackedBlogger }>('/api/bloggers', { method: 'POST', body: JSON.stringify(payload) }),
  bulkAddBloggers: (payload: { text: string; default_tweet_limit?: number }) => request<{ imported: TrackedBlogger[]; duplicates: Array<{ screen_name: string; reason: string }>; skipped: Array<{ input: string; reason: string }>; total: number }>('/api/bloggers/bulk', { method: 'POST', body: JSON.stringify(payload) }),
  updateBlogger: (id: number, payload: Partial<Pick<TrackedBlogger, 'screen_name' | 'display_name' | 'default_tweet_limit'>>) => request<{ blogger: TrackedBlogger }>(`/api/bloggers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteBlogger: (id: number) => request<{ ok: boolean }>(`/api/bloggers/${id}`, { method: 'DELETE' }),
  taskItems: (id: number, params?: { offset?: number; limit?: number; q?: string; has_media?: string; media_status?: string }) => {
    const query = new URLSearchParams();
    if (params?.offset) query.set('offset', String(params.offset));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.q) query.set('q', params.q);
    if (params?.has_media) query.set('has_media', params.has_media);
    if (params?.media_status) query.set('media_status', params.media_status);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<TaskItemsResponse>(`/api/tasks/${id}/items${suffix}`);
  },
  taskItemsStream: (id: number, params?: { offset?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.offset) query.set('offset', String(params.offset));
    if (params?.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<{
      total: number;
      items: Array<{
        id: number;
        tweet_date: string;
        display_name: string;
        user_name: string;
        tweet_url: string;
        media_type: string;
        media_url: string;
        saved_filename: string;
        tweet_content: string;
        favorite_count: number;
        retweet_count: number;
        reply_count: number;
      }>;
      has_more: boolean;
    }>(`/api/tasks/${id}/items/stream${suffix}`);
  },
  createTask: (payload: Record<string, unknown>) => request<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  cancelTask: (id: number) => request<{ task: Task }>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  deleteTask: (id: number) => request<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' }),
  schedules: () => request<{ schedules: ScheduledTask[] }>('/api/schedules'),
  createSchedule: (payload: Record<string, unknown>) => request<{ schedule: ScheduledTask }>('/api/schedules', { method: 'POST', body: JSON.stringify(payload) }),
  updateSchedule: (id: number, payload: Record<string, unknown>) => request<{ schedule: ScheduledTask }>(`/api/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  toggleSchedule: (id: number) => request<{ schedule: ScheduledTask }>(`/api/schedules/${id}/toggle`, { method: 'POST' }),
  deleteSchedule: (id: number) => request<{ ok: boolean }>(`/api/schedules/${id}`, { method: 'DELETE' }),
  runScheduleNow: (id: number) => request<{ schedule: ScheduledTask; task_id: number }>(`/api/schedules/${id}/run-now`, { method: 'POST' }),
  operationLogs: (params?: OperationLogParams) => {
    const query = operationLogQuery(params);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<OperationLogResponse>(`/api/operation-logs${suffix}`);
  },
  deleteOperationLog: (id: number) => request<{ ok: boolean }>(`/api/operation-logs/${id}`, { method: 'DELETE' }),
  deleteOperationLogs: (params?: OperationLogParams) => {
    const query = operationLogQuery(params);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<{ ok: boolean; deleted: number }>(`/api/operation-logs${suffix}`, { method: 'DELETE' });
  },
  resultDbs: () => request<{ configs: ResultDbConfig[]; credential_key_configured: boolean }>('/api/result-db'),
  saveResultDb: (payload: ResultDbFormValues) => request<{ config: ResultDbConfig }>('/api/result-db', { method: 'POST', body: JSON.stringify(payload) }),
  testResultDbConnection: (payload: ResultDbFormValues) => request<{ ok: boolean; error: string; tested_at: string }>('/api/result-db/test-connection', { method: 'POST', body: JSON.stringify(payload) }),
  testResultDb: (id: number) => request<{ ok: boolean; config: ResultDbConfig; error: string }>(`/api/result-db/${id}/test`, { method: 'POST' }),
  toggleResultDb: (id: number) => request<{ config: ResultDbConfig }>(`/api/result-db/${id}/toggle`, { method: 'POST' }),
  deleteResultDb: (id: number) => request<{ ok: boolean }>(`/api/result-db/${id}`, { method: 'DELETE' }),
  accounts: () => request<{ accounts: Account[] }>('/api/accounts'),
  accountWarmupStatus: () => request<{ active: AccountWarmupRun | null; latest: AccountWarmupRun | null }>('/api/accounts/warmup/status'),
  warmupAccounts: () => request<{ run: AccountWarmupRun }>('/api/accounts/warmup', { method: 'POST' }),
  warmupAccount: (id: number) => request<{ run: AccountWarmupRun }>(`/api/accounts/${id}/warmup`, { method: 'POST' }),
  addAccount: (payload: Record<string, unknown>) => request<{ ok: boolean }>('/api/accounts/manual', { method: 'POST', body: JSON.stringify(payload) }),
  updateAccount: (id: number, payload: { label: string; bound_proxy_id?: number | null }) => request<{ account: Account }>(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  importBitBrowserAccounts: (payload: { base_url: string; browser_ids: string[] }) => request<BitBrowserImportResponse>('/api/accounts/import/bitbrowser', { method: 'POST', body: JSON.stringify(payload) }),
  ensureLocalBrowserLoginHelper: (payload?: { wait_seconds?: number }) => request<LocalBrowserLoginHelperStatus>('/api/accounts/local-browser-login/helper/ensure', { method: 'POST', body: JSON.stringify(payload || {}) }),
  localBrowserLoginStart: (payload?: { label?: string; bound_proxy_id?: number | null }) => request<LocalBrowserLoginResponse>('/api/accounts/local-browser-login/start', { method: 'POST', body: JSON.stringify(payload || {}) }),
  localBrowserLoginStatus: (token: string) => request<LocalBrowserLoginResponse>(`/api/accounts/local-browser-login/status?token=${encodeURIComponent(token)}`),
  localBrowserLoginCancel: (token: string) => request<{ ok: boolean }>('/api/accounts/local-browser-login/cancel', { method: 'POST', body: JSON.stringify({ token }) }),
  parseLoginQueueText: (payload: { text: string }) => request<LoginQueueParseResponse>('/api/accounts/login-queue/parse', { method: 'POST', body: JSON.stringify(payload) }),
  createLoginQueue: (payload: { labels?: string[]; text?: string }) => request<LoginQueueResponse>('/api/accounts/login-queue', { method: 'POST', body: JSON.stringify(payload) }),
  loginQueueStatus: () => request<LoginQueueResponse>('/api/accounts/login-queue/status'),
  skipLoginQueueItem: (id: number) => request<LoginQueueResponse>(`/api/accounts/login-queue/${id}/skip`, { method: 'POST' }),
  retryLoginQueueItem: (id: number) => request<LoginQueueResponse>(`/api/accounts/login-queue/${id}/retry`, { method: 'POST' }),
  checkAccount: (id: number) => request<{ account: Account; ok: boolean; error: string }>(`/api/accounts/${id}/check`, { method: 'POST' }),
  deleteAccount: (id: number) => request<{ ok: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' }),
  proxies: () => request<{ proxies: ProxyItem[] }>('/api/proxies'),
  addProxy: (payload: Record<string, unknown>) => request<{ ok: boolean }>('/api/proxies', { method: 'POST', body: JSON.stringify(payload) }),
  checkProxy: (id: number) => request<{ proxy: ProxyItem; ok: boolean; error: string; ip: string }>(`/api/proxies/${id}/check`, { method: 'POST' }),
  toggleProxy: (id: number) => request<{ proxy: ProxyItem }>(`/api/proxies/${id}/toggle`, { method: 'POST' }),
  deleteProxy: (id: number) => request<{ ok: boolean }>(`/api/proxies/${id}`, { method: 'DELETE' }),
  runConfig: () => request<RunConfig>('/api/run/config'),
  runStatus: () => request<RunStatus>('/api/run/status'),
  runStart: (payload: RunConfig) => request<RunStatus>('/api/run/start', { method: 'POST', body: JSON.stringify(payload) }),
  runStop: () => request<RunStatus>('/api/run/stop', { method: 'POST' }),
  runLogs: () => fetch('/api/run/logs/stream', { credentials: 'include' }),
};
