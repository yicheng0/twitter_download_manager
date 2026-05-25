import type { Account, ApiError, BitBrowserImportResponse, Dashboard, HealthStatus, ProxyItem, RunConfig, RunStatus, Task } from './types';

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
  dashboard: () => request<Dashboard>('/api/dashboard'),
  tasks: () => request<{ tasks: Task[] }>('/api/tasks'),
  task: (id: number) => request<{ task: Task }>(`/api/tasks/${id}`),
  createTask: (payload: Record<string, unknown>) => request<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  cancelTask: (id: number) => request<{ task: Task }>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  accounts: () => request<{ accounts: Account[] }>('/api/accounts'),
  addAccount: (payload: Record<string, unknown>) => request<{ ok: boolean }>('/api/accounts/manual', { method: 'POST', body: JSON.stringify(payload) }),
  importBitBrowserAccounts: (payload: { base_url: string; browser_ids: string[] }) => request<BitBrowserImportResponse>('/api/accounts/import/bitbrowser', { method: 'POST', body: JSON.stringify(payload) }),
  browserLogin: () => request<{ status: string; message: string; expires_in?: number; screen_name?: string }>('/api/accounts/browser-login/start', { method: 'POST' }),
  browserLoginStatus: () => request<{ status: string; message: string; expires_in?: number; screen_name?: string }>('/api/accounts/browser-login/status'),
  browserLoginInput: (payload: Record<string, unknown>) => request<{ ok: boolean }>('/api/accounts/browser-login/input', { method: 'POST', body: JSON.stringify(payload) }),
  browserLoginCancel: () => request<{ ok: boolean }>('/api/accounts/browser-login/cancel', { method: 'POST' }),
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
