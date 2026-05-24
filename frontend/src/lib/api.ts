import type { Account, ApiError, Dashboard, ProxyItem, RunConfig, RunStatus, Task } from './types';

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
  dashboard: () => request<Dashboard>('/api/dashboard'),
  tasks: () => request<{ tasks: Task[] }>('/api/tasks'),
  task: (id: number) => request<{ task: Task }>(`/api/tasks/${id}`),
  createTask: (payload: Record<string, unknown>) => request<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  cancelTask: (id: number) => request<{ task: Task }>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  accounts: () => request<{ accounts: Account[] }>('/api/accounts'),
  addAccount: (payload: Record<string, unknown>) => request<{ ok: boolean }>('/api/accounts/manual', { method: 'POST', body: JSON.stringify(payload) }),
  browserLogin: () => request<{ ok: boolean }>('/api/accounts/browser-login', { method: 'POST' }),
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
