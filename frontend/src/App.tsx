import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, BarChart3, ChevronRight, CircleUserRound, Clock3, FileArchive, FolderKanban, Info, LogOut, Network, Plus, RefreshCcw, ShieldCheck, Play, Square, Target, TrendingUp, Zap } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from './lib/api';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader } from './components/ui/card';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import type { Account, BitBrowserImportResult, ProxyItem, RunConfig, RunStatus, Task, TaskFormValues, TaskType } from './lib/types';
import { cn } from './lib/utils';
import { getTaskTemplateById, taskTemplates, type TaskTemplate } from './lib/templates';
import { defaultRunTimeRange, defaultTaskTimeRange, presetFromTimeRange, rangeFromPreset, splitTimeRange, timeRangeError, TIME_PRESETS, todayString, type TimePreset } from './lib/timeRange';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

const DEFAULT_TASK_FORM: TaskFormValues = {
  task_type: 'user_media',
  account_id: 0,
  targets: '',
  time_range: defaultTaskTimeRange(),
  max_concurrent_requests: 8,
  has_retweet: false,
  high_lights: false,
  likes: false,
  has_video: true,
  down_log: false,
  auto_sync: false,
  md_output: false,
  image_format: 'orig',
  media_count_limit: 350,
  proxy: '',
  proxy_id: null,
  tag: '',
  advanced_filter: '',
  down_count: 50,
  media_latest: false,
  text_down: false,
  media_down: true,
  min_replies: 1,
  min_faves: 0,
  min_retweets: 0,
  search_advanced: '',
};

const DEFAULT_RUN_FORM: RunConfig = {
  save_path: '',
  user_lst: '',
  cookie: '',
  time_range: defaultRunTimeRange(),
  has_retweet: false,
  high_lights: false,
  likes: false,
  down_log: false,
  autoSync: false,
  image_format: 'orig',
  has_video: true,
  log_output: true,
  max_concurrent_requests: 8,
  proxy: '',
  md_output: false,
  media_count_limit: 350,
};

const PROXY_PLACEHOLDER = 'gate.kookeey.info:1000:user:pass 或 socks5://user:pass@host:port';

function statusTone(status: string): BadgeTone {
  if (status === 'completed' || status === 'active' || status === 'finished') return 'success';
  if (status === 'running') return 'primary';
  if (status === 'queued' || status === 'rate_limited' || status === 'partial_failed' || status === 'network_failed' || status === 'stopping' || status === 'disabled') return 'warning';
  if (status === 'failed' || status === 'cancelled' || status === 'expired' || status === 'auth_expired' || status === 'target_unavailable' || status === 'api_changed') return 'danger';
  return 'neutral';
}

function statusLabel(status: string) {
  return {
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    finished: '已完成',
    failed: '已失败',
    cancelled: '已取消',
    partial_failed: '部分失败',
    rate_limited: '触发限流',
    auth_expired: '会话失效',
    network_failed: '网络异常',
    target_unavailable: '目标不可用',
    api_changed: '接口变化',
    active: '正常',
    expired: '已失效',
    disabled: '已停用',
    idle: '空闲',
    stopping: '停止中',
    stopped: '已停止',
  }[status] || status;
}

function statusDescription(status: string) {
  return {
    queued: '等待 worker 执行。',
    running: '任务正在采集或下载。',
    completed: '任务执行完成。',
    finished: '任务执行完成。',
    failed: '任务异常结束。',
    cancelled: '任务已取消。',
    partial_failed: '部分步骤成功，部分步骤失败。',
    rate_limited: '触发了接口限流，稍后可重试。',
    auth_expired: '账号会话失效，需要重新登录或更新 Cookie。',
    network_failed: '网络、代理或出口连接异常。',
    target_unavailable: '目标不可访问，或内容权限不足。',
    api_changed: '接口结构可能变化，需要排查。',
    active: '当前可用于任务。',
    expired: '当前账号已失效。',
    disabled: '当前代理已停用。',
    idle: '当前没有运行中的任务。',
    stopping: '正在停止当前任务。',
    stopped: '任务已停止。',
  }[status] || '';
}

function displayStatus(status: string) {
  return `${statusLabel(status)}${statusDescription(status) ? ` · ${statusDescription(status)}` : ''}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login';
    },
  });

  return (
    <div className="min-h-screen bg-transparent text-[hsl(var(--text))]">
      <header className="sticky top-0 z-20 border-b border-[hsl(var(--line))] bg-[rgba(9,18,33,0.88)] backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[hsl(var(--line))] bg-[linear-gradient(180deg,#102033_0%,#0b1220_100%)] shadow-[0_10px_24px_rgba(14,165,233,0.14)]">
              <img src="/logo.svg" alt="X 采集工作台" className="h-9 w-9" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--primary-dark))]">采样工作台</div>
              <div className="text-lg font-semibold leading-tight">X 采集工作台</div>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2 md:ml-4">
            <NavItem to="/" icon={<BarChart3 className="h-4 w-4" />} label="看板" />
            <NavItem to="/run" icon={<Activity className="h-4 w-4" />} label="运行控制" />
            <NavItem to="/tasks" icon={<FolderKanban className="h-4 w-4" />} label="任务" />
            <NavItem to="/tasks/new" icon={<Plus className="h-4 w-4" />} label="新建任务" />
            <NavItem to="/accounts" icon={<ShieldCheck className="h-4 w-4" />} label="账号" />
            <NavItem to="/proxies" icon={<Network className="h-4 w-4" />} label="代理" />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {meData?.user && (
              <div className="hidden items-center gap-2 text-sm text-[hsl(var(--muted))] sm:flex">
                <CircleUserRound className="h-4 w-4" />
                {meData.user.username}
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
              <LogOut className="h-4 w-4" />
              退出
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-5">{children}</main>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[hsl(var(--muted))] transition hover:bg-[hsl(var(--panel-soft))] hover:text-[hsl(var(--text))]',
          isActive && 'bg-[rgba(14,165,233,0.16)] text-[hsl(var(--primary-dark))]',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: meData, isLoading } = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.login({ username, password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/run', { replace: true });
    },
  });

  if (isLoading) {
    return <div className="min-h-screen bg-transparent px-4 py-8 text-sm text-[hsl(var(--muted))]">加载中...</div>;
  }
  if (meData?.user) {
    return <Navigate to="/run" replace />;
  }

  return (
    <div className="min-h-screen bg-transparent px-4 py-8 text-[hsl(var(--text))]">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center">
        <Card className="w-full">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[hsl(var(--line))] bg-[linear-gradient(180deg,#102033_0%,#0b1220_100%)] shadow-[0_10px_24px_rgba(14,165,233,0.14)]">
                <img src="/logo.svg" alt="X 采集工作台" className="h-9 w-9" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">登录采集工作台</h1>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">使用部署时配置的管理员账号进入。</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="用户名">
              <Input value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
            </Field>
            <Field label="密码">
              <Input type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
            </Field>
            {login.error && (
              <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-sm text-[hsl(var(--danger))]">
                {(login.error as Error).message}
              </div>
            )}
            <Button className="w-full" onClick={() => login.mutate()} disabled={login.isPending || !username || !password}>
              登录
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { data, isLoading, error } = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });

  if (isLoading) {
    return <div className="min-h-screen bg-transparent px-4 py-8 text-sm text-[hsl(var(--muted))]">加载中...</div>;
  }
  if (error || !data?.user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/run" element={<RunControlPage />} />
        <Route path="/tasks" element={<TaskListPage />} />
        <Route path="/tasks/new" element={<TaskFormPage />} />
        <Route path="/tasks/:id" element={<TaskDetailRoute />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/proxies" element={<ProxyPage />} />
        <Route path="*" element={<Navigate to="/run" replace />} />
      </Routes>
    </Shell>
  );
}

function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-[hsl(var(--line))] bg-[linear-gradient(180deg,rgba(30,41,59,0.92)_0%,rgba(15,23,42,0.92)_100%)] px-4 py-3">
      {children}
    </div>
  );
}

function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard(), refetchInterval: 5000 });
  const { data: health } = useQuery({ queryKey: ['health-status'], queryFn: () => api.healthStatus(), refetchInterval: 15000 });
  const dashboard = data;

  if (isLoading && !dashboard) return <div className="text-sm text-[hsl(var(--muted))]">加载中...</div>;
  if (!dashboard) return <div>看板数据暂不可用</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold">X 采集工作台</h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted))]">
          面向日常采样、任务排队和结果归档的工作台，覆盖账号、关键词、评论和主页资料任务。
        </p>
      </div>
      <ActionBar>
        <Button onClick={() => (window.location.href = '/tasks/new')}>
          <Plus className="h-4 w-4" />
          新建任务
        </Button>
        <Button variant="secondary" onClick={() => (window.location.href = '/tasks')}>
          <FolderKanban className="h-4 w-4" />
          查看任务
        </Button>
      </ActionBar>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="总任务" value={dashboard.totals.tasks} />
        <Metric title="采集记录" value={dashboard.totals.records} />
        <Metric title="输出文件" value={dashboard.totals.files} />
        <Metric title="媒体文件" value={dashboard.totals.media_files} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
              <h2 className="font-semibold">最近采集任务</h2>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                  <tr>
                    <th className="px-4 py-3">任务</th>
                    <th className="px-4 py-3">目标</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">记录/文件</th>
                    <th className="px-4 py-3">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.recent_tasks.map((task) => (
                    <tr key={task.id} className="border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]">
                      <td className="px-4 py-3">
                        <button className="cursor-pointer text-left font-medium hover:text-[hsl(var(--primary-dark))]" onClick={() => (window.location.href = `/tasks/${task.id}`)}>
                          {task.title}
                        </button>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{task.task_type}</div>
                      </td>
                      <td className="max-w-[260px] truncate px-4 py-3">{task.target}</td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                          <div className="max-w-[260px] text-xs text-[hsl(var(--muted))]">{statusDescription(task.status)}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{task.summary.records} / {task.summary.files}</div>
                        <div className="text-xs text-[hsl(var(--muted))]">记录 / 文件</div>
                      </td>
                      <td className="px-4 py-3">{task.created_at}</td>
                    </tr>
                  ))}
                  {!dashboard.recent_tasks.length && (
                    <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={5}>暂无任务</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
              <h2 className="font-semibold">系统健康</h2>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <InfoCard title="账号 active" value={String(health?.accounts?.active ?? 0)} />
              <InfoCard title="代理 active" value={String(health?.proxies?.active ?? 0)} />
            </div>
              <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  {health?.running ? <Activity className="h-4 w-4 text-[hsl(var(--primary-dark))]" /> : <Clock3 className="h-4 w-4 text-[hsl(var(--muted))]" />}
                  健康检查：{health?.running ? '运行中' : '空闲'}
                </div>
                <div className="mt-1 text-[hsl(var(--muted))]">上次完成：{health?.last_finished_at || '-'}</div>
                {health?.last_error && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-[rgba(248,113,113,0.28)] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-[hsl(var(--danger))]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{health.last_error}</span>
                  </div>
                )}
              </div>
            {dashboard.compliance_notes.map((note) => (
              <div key={note} className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm text-[hsl(var(--muted))]">
                {note}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <TemplateShelf />
    </div>
  );
}

function TemplateShelf() {
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
            <h2 className="font-semibold">快捷模板</h2>
          </div>
          <div className="text-sm text-[hsl(var(--muted))]">点击后直接带入参数</div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {taskTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onClick={() => navigate(`${template.targetPath}?template=${encodeURIComponent(template.id)}`)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TemplateCard({ template, onClick }: { template: TaskTemplate; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-44 flex-col justify-between rounded-lg border border-[hsl(var(--line))] bg-[linear-gradient(180deg,rgba(30,41,59,0.88)_0%,rgba(15,23,42,0.9)_100%)] p-4 text-left transition-all duration-200 hover:-translate-y-[2px] hover:border-[hsl(var(--primary))] hover:shadow-[0_16px_34px_rgba(14,165,233,0.14)]"
    >
      <div>
        <div className="flex items-center gap-2">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(14,165,233,0.16)] text-[hsl(var(--primary-dark))] transition-colors group-hover:bg-[rgba(14,165,233,0.24)]">
            <ChevronRight className="h-4 w-4" />
          </div>
          <div className="text-base font-semibold text-[hsl(var(--text))]">{template.name}</div>
        </div>
        <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted))]">{template.description}</p>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Badge tone="primary">{template.task_type}</Badge>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-[hsl(var(--primary-dark))]">
          一键填充
          <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </button>
  );
}

function TaskListPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks(), refetchInterval: 5000 });
  const tasks = data?.tasks || [];
  const stats = {
    total: tasks.length,
    queued: tasks.filter((task) => task.status === 'queued').length,
    running: tasks.filter((task) => task.status === 'running').length,
    done: tasks.filter((task) => task.status === 'completed').length,
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">任务</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">排队、运行、完成、失败都在这里看。</p>
      </div>
      <ActionBar>
        <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['tasks'] })}>
          <RefreshCcw className="h-4 w-4" />
          刷新
        </Button>
        <Button onClick={() => (window.location.href = '/tasks/new')}>
          <Plus className="h-4 w-4" />
          新建任务
        </Button>
      </ActionBar>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="总任务" value={stats.total} />
        <Metric title="排队中" value={stats.queued} />
        <Metric title="运行中" value={stats.running} />
        <Metric title="已完成" value={stats.done} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[1000px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">标题</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">提交人</th>
                  <th className="px-4 py-3">创建时间</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => <TaskRow key={task.id} task={task} />)}
                {!isLoading && tasks.length === 0 && (
                  <tr>
                    <td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={6}>
                      暂无任务
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <CardContent>
        <div className="text-sm text-[hsl(var(--muted))]">{title}</div>
        <div className="mt-2 text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent>
        <div className="text-sm text-[hsl(var(--muted))]">{title}</div>
        <div className="mt-2 break-words text-base font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function formatBytes(value: number) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function maskSensitive(text: string) {
  return text
    .replace(/(auth_token=)[^;\s"]+/gi, '$1[已隐藏]')
    .replace(/(ct0=)[^;\s"]+/gi, '$1[已隐藏]')
    .replace(/("cookie"\s*:\s*")[^"]+/gi, '$1[已隐藏]')
    .replace(/("auth_token"\s*:\s*")[^"]+/gi, '$1[已隐藏]')
    .replace(/("ct0"\s*:\s*")[^"]+/gi, '$1[已隐藏]')
    .replace(/((?:https?|socks5?|socks4):\/\/)([^:@/\s]+):([^@/\s]+)@/gi, '$1[账号]:[密码]@')
    .replace(/(^|[\s"'])([A-Za-z0-9.-]+\.[A-Za-z]{2,}|localhost|127\.0\.0\.1):(\d+):([^:\s"']+):([^:\s"']+)/gi, '$1$2:$3:[账号]:[密码]');
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(maskSensitive(text));
}

function validateRunForm(form: RunConfig, proxies: ProxyItem[]) {
  const errors: string[] = [];
  const cookie = String(form.cookie || '');
  if (!cookie.includes('auth_token=') || !cookie.includes('ct0=')) {
    errors.push('Cookie 需要同时包含 auth_token= 和 ct0=。');
  }
  const users = String(form.user_lst || '').split(',').map((user) => user.trim()).filter(Boolean);
  if (!users.length) {
    errors.push('用户名列表不能为空，多个用户名用英文逗号分隔。');
  }
  const timeError = timeRangeError(form.time_range);
  if (timeError) {
    errors.push(timeError);
  }
  if (!['orig', 'jpg', 'png'].includes(String(form.image_format || ''))) {
    errors.push('图片格式只能是 orig、jpg 或 png。');
  }
  if (!Number.isInteger(Number(form.max_concurrent_requests)) || Number(form.max_concurrent_requests) <= 0) {
    errors.push('并发数需要是大于 0 的整数。');
  }
  if (form.proxy_id) {
    const proxy = proxies.find((item) => item.id === form.proxy_id);
    if (!proxy) {
      errors.push('所选代理不存在，请重新选择代理。');
    } else if (!proxy.enabled || proxy.status !== 'active') {
      errors.push('所选代理不可用，请到代理页检测通过后再使用。');
    }
  }
  return errors;
}

function runCopyText(status: RunStatus) {
  return [
    '运行控制排查信息',
    `状态: ${statusLabel(status.status)}`,
    `状态说明: ${statusDescription(status.status) || '-'}`,
    `消息: ${status.message}`,
    `运行时长: ${status.running_for ?? '-'}s`,
    `返回码: ${status.return_code ?? '-'}`,
    `API 次数: ${status.summary.api_calls}`,
    `下载数: ${status.summary.downloads}`,
    `输出路径: ${status.output_path || '-'}`,
    '',
    '日志:',
    status.logs.length ? status.logs.slice(-120).join('\n') : '还没有日志',
  ].join('\n');
}

function taskCopyText(task: Task) {
  return [
    '任务排查信息',
    `任务: #${task.id} ${task.title}`,
    `类型: ${task.task_type}`,
    `状态: ${statusLabel(task.status)}`,
    `状态说明: ${statusDescription(task.status) || '-'}`,
    `重试: ${task.retry_count}/${task.max_retries}`,
    `最后重试: ${task.last_retry_at || '-'}`,
    `错误类型: ${task.last_error_type || '-'}`,
    `错误: ${task.error || '-'}`,
    `创建时间: ${task.created_at}`,
    `开始时间: ${task.started_at || '-'}`,
    `结束时间: ${task.finished_at || '-'}`,
    '',
    '摘要:',
    `采集记录: ${task.summary?.records ?? 0}`,
    `媒体文件: ${task.summary?.media_files ?? 0}`,
    `输出大小: ${formatBytes(task.summary?.total_bytes ?? 0)}`,
    '',
    '配置:',
    JSON.stringify(task.config || {}, null, 2),
    '',
    '日志:',
    task.log ? task.log.slice(-12000) : '还没有日志',
  ].join('\n');
}

function TaskRow({ task }: { task: Task }) {
  const navigate = useNavigate();
  return (
    <tr className="border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]">
      <td className="px-4 py-3">#{task.id}</td>
      <td className="px-4 py-3">
        <div className="font-medium">{task.title}</div>
        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{task.task_type}</div>
      </td>
      <td className="px-4 py-3">
        <Badge tone={statusTone(task.status)}>{task.status}</Badge>
      </td>
      <td className="px-4 py-3">{task.username || '-'}</td>
      <td className="px-4 py-3">{task.created_at}</td>
      <td className="px-4 py-3 text-right">
        <Button variant="secondary" size="sm" onClick={() => navigate(`/tasks/${task.id}`)}>
          查看
        </Button>
      </td>
    </tr>
  );
}

function TaskFormPage() {
  const { data: accountData } = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts() });
  const { data: proxiesData } = useQuery({ queryKey: ['proxies'], queryFn: () => api.proxies() });
  const [searchParams] = useSearchParams();
  const selectedTemplateId = searchParams.get('template');
  const accounts = accountData?.accounts;
  const proxies = proxiesData?.proxies || [];
  const usableProxies = proxies.filter((proxy) => proxy.enabled && proxy.status === 'active');
  const [form, setForm] = useState<TaskFormValues>(DEFAULT_TASK_FORM);
  const [timePreset, setTimePreset] = useState<TimePreset>('90d');
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => {
      const nextError = timeRangeError(form.time_range);
      if (nextError) {
        setError(nextError);
        return Promise.reject(new Error(nextError));
      }
      return api.createTask(form);
    },
    onSuccess: (res) => (window.location.href = `/tasks/${res.task.id}`),
    onError: (err: Error) => setError(err.message),
  });

  useEffect(() => {
    const firstAccountId = accounts?.[0]?.id;
    if (!form.account_id && firstAccountId) {
      setForm((prev) => ({ ...prev, account_id: firstAccountId }));
    }
  }, [accounts, form.account_id]);

  useEffect(() => {
    const template = getTaskTemplateById(selectedTemplateId);
    if (template) {
      setForm((prev) => ({ ...DEFAULT_TASK_FORM, ...prev, ...template.payload, task_type: template.payload.task_type || prev.task_type }));
      if (template.payload.time_range) {
        const matchedPreset = TIME_PRESETS.find((item) => rangeFromPreset(item.key) === template.payload.time_range);
        setTimePreset(matchedPreset?.key || 'custom');
      }
    }
  }, [selectedTemplateId]);

  const timeError = timeRangeError(form.time_range);
  const applyTimePreset = (preset: TimePreset) => {
    setTimePreset(preset);
    setError('');
    setForm((prev) => ({ ...prev, time_range: rangeFromPreset(preset) }));
  };
  const applyCustomTimeRange = (start: string, end: string) => {
    setTimePreset('custom');
    setError('');
    setForm((prev) => ({ ...prev, time_range: `${start}:${end}` }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">新建任务</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">按任务类型填写对应字段，提交后自动进入队列。</p>
      </div>
      <ActionBar>
        <Button onClick={() => create.mutate()} disabled={create.isPending || !accounts?.length || Boolean(timeError)}>
          提交任务
        </Button>
        <Button variant="secondary" onClick={() => (window.location.href = '/tasks')}>
          取消
        </Button>
      </ActionBar>
      {error && <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-sm text-[hsl(var(--danger))]">{error}</div>}

      <Card>
        <CardHeader>
          <div>
            <h3 className="font-semibold">采集时间范围</h3>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">先选采集周期，系统会自动转换成任务需要的日期格式。</p>
          </div>
        </CardHeader>
        <CardContent>
          <TimeRangePicker
            value={form.time_range}
            preset={timePreset}
            error={timeError}
            onPresetChange={applyTimePreset}
            onCustomChange={applyCustomTimeRange}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><h3 className="font-semibold">基础</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="任务类型">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.task_type} onChange={(e) => setForm((prev) => ({ ...prev, task_type: e.target.value as TaskType }))}>
                <option value="user_media">用户媒体</option>
                <option value="search">搜索/Tag</option>
                <option value="text">用户文本</option>
                <option value="replies">评论区</option>
                <option value="profile">主页资料</option>
              </select>
            </Field>
            <Field label="X账号">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.account_id} onChange={(e) => setForm((prev) => ({ ...prev, account_id: Number(e.target.value) }))}>
                {(accounts || []).map((account: Account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}{account.screen_name ? ` (@${account.screen_name})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="目标用户 / 推文链接">
              <Textarea value={form.targets} onChange={(e) => setForm((prev) => ({ ...prev, targets: e.target.value }))} rows={4} />
            </Field>
            <Field label="并发下载数">
              <Input type="number" value={form.max_concurrent_requests} onChange={(e) => setForm((prev) => ({ ...prev, max_concurrent_requests: Number(e.target.value) }))} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold">用户媒体</h3></CardHeader>
          <CardContent className="space-y-4">
            <Check label="下载视频" checked={form.has_video} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, has_video: checked }))} />
            <Check label="包含转推" checked={form.has_retweet} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, has_retweet: checked }))} />
            <Check label="亮点" checked={form.high_lights} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, high_lights: checked }))} />
            <Check label="Likes" checked={form.likes} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, likes: checked }))} />
            <Check label="去重日志" checked={form.down_log} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, down_log: checked }))} />
            <Check label="自动同步" checked={form.auto_sync} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, auto_sync: checked }))} />
            <Check label="输出 Markdown" checked={form.md_output} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, md_output: checked }))} />
            <Field label="图片格式">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.image_format} onChange={(e) => setForm((prev) => ({ ...prev, image_format: e.target.value }))}>
                <option value="orig">orig</option>
                <option value="jpg">jpg</option>
                <option value="png">png</option>
              </select>
            </Field>
            <Field label="单个 Markdown 媒体数量">
              <Input type="number" value={form.media_count_limit} onChange={(e) => setForm((prev) => ({ ...prev, media_count_limit: Number(e.target.value) }))} />
            </Field>
            <Field label="代理池">
              <select
                className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3"
                value={form.proxy_id ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, proxy_id: e.target.value ? Number(e.target.value) : null }))}
              >
                <option value="">使用手填代理</option>
                {usableProxies.map((proxy) => (
                  <option key={proxy.id} value={proxy.id}>
                    {proxy.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="手填代理">
              <Input value={form.proxy} onChange={(e) => setForm((prev) => ({ ...prev, proxy: e.target.value }))} placeholder={PROXY_PLACEHOLDER} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold">搜索 / Tag</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Tag">
              <Input value={form.tag} onChange={(e) => setForm((prev) => ({ ...prev, tag: e.target.value }))} />
            </Field>
            <Field label="高级搜索">
              <Textarea value={form.advanced_filter} onChange={(e) => setForm((prev) => ({ ...prev, advanced_filter: e.target.value }))} rows={3} />
            </Field>
            <Field label="下载数量">
              <Input type="number" value={form.down_count} onChange={(e) => setForm((prev) => ({ ...prev, down_count: Number(e.target.value) }))} />
            </Field>
            <Check label="最新页媒体" checked={form.media_latest} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, media_latest: checked }))} />
            <Check label="文本模式" checked={form.text_down} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, text_down: checked }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold">评论区</h3></CardHeader>
          <CardContent className="space-y-4">
            <Check label="下载评论媒体" checked={form.media_down} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, media_down: checked }))} />
            <Field label="最小评论数">
              <Input type="number" value={form.min_replies} onChange={(e) => setForm((prev) => ({ ...prev, min_replies: Number(e.target.value) }))} />
            </Field>
            <Field label="最小喜欢数">
              <Input type="number" value={form.min_faves} onChange={(e) => setForm((prev) => ({ ...prev, min_faves: Number(e.target.value) }))} />
            </Field>
            <Field label="最小转推数">
              <Input type="number" value={form.min_retweets} onChange={(e) => setForm((prev) => ({ ...prev, min_retweets: Number(e.target.value) }))} />
            </Field>
            <Field label="评论高级搜索">
              <Textarea value={form.search_advanced} onChange={(e) => setForm((prev) => ({ ...prev, search_advanced: e.target.value }))} rows={3} />
            </Field>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[hsl(var(--line))] px-3 py-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} className="h-4 w-4" />
      <span>{label}</span>
    </label>
  );
}

function TimeRangePicker({
  value,
  preset,
  error,
  onPresetChange,
  onCustomChange,
}: {
  value: string;
  preset: TimePreset;
  error: string;
  onPresetChange: (preset: TimePreset) => void;
  onCustomChange: (start: string, end: string) => void;
}) {
  const { start, end } = splitTimeRange(value);
  return (
    <div className="space-y-3 rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TIME_PRESETS.map((item) => (
          <Button
            key={item.key}
            type="button"
            variant={preset === item.key ? 'default' : item.key === 'all' ? 'ghost' : 'secondary'}
            size="sm"
            onClick={() => onPresetChange(item.key)}
            title={item.key === 'all' ? '最近一年至今天，适合较大范围采集' : undefined}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="开始日期">
          <Input type="date" value={start} max={todayString()} onChange={(event) => onCustomChange(event.target.value, end)} />
        </Field>
        <Field label="结束日期">
          <Input type="date" value={end} max={todayString()} onChange={(event) => onCustomChange(start, event.target.value)} />
        </Field>
      </div>
      <div className={cn('rounded-lg border px-3 py-2 text-sm', error ? 'border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] text-[hsl(var(--danger))]' : 'border-[hsl(var(--line))] bg-[hsl(var(--panel))] text-[hsl(var(--muted))]')}>
        {error || `实际范围：${value}${preset === 'all' ? '（最近一年）' : ''}`}
      </div>
    </div>
  );
}

function TaskDetailPage({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['task', id], queryFn: () => api.task(id), refetchInterval: 4000 });
  const task = data?.task;
  const [copyStatus, setCopyStatus] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.cancelTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task', id] }),
  });

  if (isLoading && !task) return <div className="text-sm text-[hsl(var(--muted))]">加载中...</div>;
  if (!task) return <div>任务不存在</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">{task.title}</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">#{task.id} · {task.username || '-'} · {task.created_at}</p>
      </div>
      <ActionBar>
        <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['task', id] })}>
          <RefreshCcw className="h-4 w-4" />
          刷新
        </Button>
        {(task.status === 'queued' || task.status === 'running') && (
          <Button variant="danger" onClick={() => cancel.mutate()}>
            取消任务
          </Button>
        )}
        <Button variant="secondary" onClick={() => (window.location.href = `/tasks/${task.id}/download`)}>
          打包下载
        </Button>
        <Button
          variant="secondary"
          onClick={() => copyText(taskCopyText(task)).then(() => setCopyStatus('已复制任务排查信息')).catch(() => setCopyStatus('复制失败，请手动选择日志'))}
        >
          复制错误信息
        </Button>
      </ActionBar>
      {copyStatus && <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm text-[hsl(var(--muted))]">{copyStatus}</div>}

      <div className="grid gap-3 md:grid-cols-4">
        <InfoCard title="状态" value={displayStatus(task.status)} />
        <InfoCard title="开始时间" value={task.started_at || '-'} />
        <InfoCard title="结束时间" value={task.finished_at || '-'} />
        <InfoCard title="重试次数" value={`${task.retry_count}/${task.max_retries}`} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard title="最后重试" value={task.last_retry_at || '-'} />
        <InfoCard title="错误类型" value={task.last_error_type ? statusLabel(task.last_error_type) : '-'} />
        <InfoCard title="错误" value={task.error || '暂无错误'} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <InfoCard title="采集记录" value={String(task.summary?.records ?? 0)} />
        <InfoCard title="媒体文件" value={String(task.summary?.media_files ?? 0)} />
        <InfoCard title="互动合计" value={`${task.summary?.favorites ?? 0}/${task.summary?.retweets ?? 0}/${task.summary?.replies ?? 0}`} />
        <InfoCard title="输出大小" value={formatBytes(task.summary?.total_bytes ?? 0)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
              <h3 className="font-semibold">结果摘要</h3>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoCard title="CSV 文件" value={String(task.summary?.csv_files ?? 0)} />
              <InfoCard title="媒体记录" value={String(task.summary?.media_records ?? 0)} />
            </div>
            <div className="mt-4">
              <div className="text-sm font-semibold">Top 链接</div>
              <div className="mt-2 space-y-2">
                {(task.summary?.top_urls || []).map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="block truncate rounded-lg border border-[hsl(var(--line))] px-3 py-2 text-sm text-[hsl(var(--primary-dark))] hover:bg-[hsl(var(--panel-soft))]">
                    {url}
                  </a>
                ))}
                {!task.summary?.top_urls?.length && <div className="text-sm text-[hsl(var(--muted))]">暂无可统计链接</div>}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileArchive className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
              <h3 className="font-semibold">交付说明</h3>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[hsl(var(--muted))]">
            <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2">打包下载会包含 CSV、Markdown、媒体文件和 summary_report.md。</div>
            <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2">页面和日志已隐藏 Cookie、auth_token、ct0 等敏感字段。</div>
            <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2">生产化建议迁移到官方 API 并单独确认授权、限流和数据留存策略。</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><h3 className="font-semibold">配置</h3></CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-4 text-xs leading-6 text-[hsl(var(--text))]">{JSON.stringify(task.config || {}, null, 2)}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h3 className="font-semibold">日志</h3></CardHeader>
          <CardContent>
            <pre className="max-h-[540px] overflow-auto whitespace-pre-wrap rounded-lg border border-[hsl(var(--line))] bg-[#020617] p-4 text-xs leading-6 text-slate-100">{task.log || '还没有日志'}</pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h3 className="font-semibold">文件</h3></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[800px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr><th className="px-4 py-3">文件</th><th className="px-4 py-3">大小</th></tr>
              </thead>
              <tbody>
                {(task.files || []).map((file) => (
                  <tr key={file.name} className="border-t border-[hsl(var(--line))]">
                    <td className="px-4 py-3">{file.name}</td>
                    <td className="px-4 py-3">{file.size} bytes</td>
                  </tr>
                ))}
                {!task.files?.length && (
                  <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={2}>还没有输出文件</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AccountsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts(), refetchInterval: 8000 });
  const accounts = data?.accounts || [];
  const [form, setForm] = useState({ label: '', auth_token: '', ct0: '' });
  const [bitBrowserForm, setBitBrowserForm] = useState({ base_url: 'http://127.0.0.1:54345', browser_ids: '' });
  const [bitBrowserResults, setBitBrowserResults] = useState<BitBrowserImportResult[]>([]);
  const [error, setError] = useState('');
  const [browserLoginOpen, setBrowserLoginOpen] = useState(false);
  const [browserLoginToken, setBrowserLoginToken] = useState('');
  const [browserLoginStatus, setBrowserLoginStatus] = useState('');
  const [browserLoginMessage, setBrowserLoginMessage] = useState('');
  const addAccount = useMutation({
    mutationFn: () => api.addAccount(form),
    onSuccess: () => {
      setError('');
      setForm({ label: '', auth_token: '', ct0: '' });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const importBitBrowserAccounts = useMutation({
    mutationFn: () => {
      const browserIds = bitBrowserForm.browser_ids
        .split(/[\r\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      return api.importBitBrowserAccounts({ base_url: bitBrowserForm.base_url, browser_ids: browserIds });
    },
    onSuccess: (res) => {
      setError('');
      setBitBrowserResults(res.results);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const browserLogin = useMutation({
    mutationFn: async () => {
      const session = await api.localBrowserLoginStart();
      try {
        const response = await fetch('http://127.0.0.1:18765/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: session.token,
            callback_url: session.callback_url,
            expires_in: session.expires_in,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          return {
            ...session,
            status: 'helper_missing',
            message: body.message || '本地登录助手没有响应，请先启动助手后重试。',
          };
        }
        return {
          ...session,
          status: 'running',
          message: body.message || '已请求本地登录助手打开 Chrome，请在弹出的窗口完成 X 登录。',
        };
      } catch {
        return {
          ...session,
          status: 'helper_missing',
          message: '未检测到本地登录助手。请先双击 start_local_login_helper.bat，保持窗口打开后再重试。',
        };
      }
    },
    onSuccess: (res) => {
      setError('');
      setBrowserLoginOpen(true);
      setBrowserLoginToken(res.token);
      setBrowserLoginStatus(res.status);
      setBrowserLoginMessage(res.message);
    },
    onError: (err: Error) => setError(err.message),
  });
  const browserLoginStatusQuery = useQuery({
    queryKey: ['local-browser-login-status', browserLoginToken],
    queryFn: () => api.localBrowserLoginStatus(browserLoginToken),
    enabled: browserLoginOpen && Boolean(browserLoginToken) && !['helper_missing', 'completed', 'failed', 'expired', 'cancelled'].includes(browserLoginStatus),
    refetchInterval: browserLoginOpen ? 2500 : false,
  });
  const cancelBrowserLogin = useMutation({
    mutationFn: () => (browserLoginToken ? api.localBrowserLoginCancel(browserLoginToken) : Promise.resolve({ ok: true })),
    onSuccess: () => {
      setBrowserLoginOpen(false);
      setBrowserLoginToken('');
      setBrowserLoginStatus('');
      setBrowserLoginMessage('');
    },
    onError: (err: Error) => setError(err.message),
  });
  const checkAccount = useMutation({
    mutationFn: (id: number) => api.checkAccount(id),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const deleteAccount = useMutation({
    mutationFn: (id: number) => api.deleteAccount(id),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  useEffect(() => {
    const status = browserLoginStatusQuery.data?.status;
    if (!status) return;
    setBrowserLoginStatus(status);
    setBrowserLoginMessage(browserLoginStatusQuery.data?.message || '');
    if (status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  }, [browserLoginStatusQuery.data, queryClient]);

  const browserLoginTone = browserLoginStatus === 'completed'
    ? 'success'
    : ['failed', 'expired', 'helper_missing'].includes(browserLoginStatus)
      ? 'danger'
      : 'primary';
  const browserLoginStatusText = {
    pending: '等待助手',
    running: '等待登录',
    helper_missing: '助手未启动',
    completed: '已完成',
    failed: '失败',
    expired: '已超时',
    cancelled: '已取消',
  }[browserLoginStatus] || 'starting';

  const retryLocalHelper = () => {
    browserLogin.mutate();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">X 账号池</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">维护会话，任务从这里选账号。</p>
      </div>
      <ActionBar>
        <Button onClick={() => browserLogin.mutate()} disabled={browserLogin.isPending}>
          <CircleUserRound className="h-4 w-4" />
          本地 Chrome 登录
        </Button>
      </ActionBar>
      {error && <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-sm text-[hsl(var(--danger))]">{error}</div>}
      {browserLoginOpen && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">本地 Chrome 授权登录</h3>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">{browserLoginMessage || '请在本机 Chrome 授权窗口完成 X 登录'}</p>
              </div>
              <Badge tone={browserLoginTone as BadgeTone}>
                {browserLoginStatusText}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {browserLoginStatus === 'helper_missing' ? (
              <div className="rounded-lg border border-[hsl(var(--warning))] bg-[rgba(251,191,36,0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]">
                请先在本机双击项目目录里的 start_local_login_helper.bat，看到“本地 Chrome 授权登录助手已启动”后再点击重试。
              </div>
            ) : browserLoginStatus === 'completed' ? (
              <div className="rounded-lg border border-[hsl(var(--success))] bg-[rgba(34,197,94,0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]">
                登录成功，账号已保存到账号池。
              </div>
            ) : browserLoginStatus === 'failed' || browserLoginStatus === 'expired' ? (
              <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] px-4 py-3 text-sm text-[hsl(var(--danger))]">
                {browserLoginMessage || '本地 Chrome 授权登录没有成功，请重新开始。'}
              </div>
            ) : (
              <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
                本地助手会弹出一个临时 Chrome 授权窗口。请在窗口里完成 X 登录，工作台会自动检测并保存 Cookie。
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {browserLoginStatus === 'helper_missing' && (
                <Button variant="secondary" size="sm" onClick={retryLocalHelper} disabled={browserLogin.isPending}>
                  重试连接助手
                </Button>
              )}
              {browserLoginToken && browserLoginStatus !== 'helper_missing' && browserLoginStatus !== 'completed' && (
                <Button variant="secondary" size="sm" onClick={() => browserLoginStatusQuery.refetch()}>
                  检查登录状态
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={() => cancelBrowserLogin.mutate()}>
                取消登录
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard title="可用账号" value={String(accounts.filter((account) => account.status === 'active').length)} />
        <InfoCard title="失效账号" value={String(accounts.filter((account) => account.status !== 'active').length)} />
        <InfoCard title="最近检测" value={accounts[0]?.last_checked_at || '-'} />
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-semibold">手动录入账号</h3>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Field label="名称">
            <Input value={form.label} onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))} />
          </Field>
          <Field label="auth_token">
            <Input value={form.auth_token} onChange={(e) => setForm((prev) => ({ ...prev, auth_token: e.target.value }))} />
          </Field>
          <Field label="ct0">
            <Input value={form.ct0} onChange={(e) => setForm((prev) => ({ ...prev, ct0: e.target.value }))} />
          </Field>
          <div className="md:col-span-3 flex justify-end">
            <Button onClick={() => addAccount.mutate()} disabled={addAccount.isPending || !form.auth_token || !form.ct0}>
              保存账号
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <h3 className="font-semibold">从比特浏览器导入</h3>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">读取已登录环境的 X Cookie，不需要输入账号密码。</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
            <Field label="本地 API 地址">
              <Input
                value={bitBrowserForm.base_url}
                onChange={(e) => setBitBrowserForm((prev) => ({ ...prev, base_url: e.target.value }))}
                placeholder="http://127.0.0.1:54345"
              />
            </Field>
            <Field label="窗口/Profile ID">
              <Textarea
                rows={3}
                value={bitBrowserForm.browser_ids}
                onChange={(e) => setBitBrowserForm((prev) => ({ ...prev, browser_ids: e.target.value }))}
                placeholder="每行一个，最多 10 个"
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => importBitBrowserAccounts.mutate()}
              disabled={importBitBrowserAccounts.isPending || !bitBrowserForm.browser_ids.trim()}
            >
              导入比特浏览器账号
            </Button>
          </div>
          {bitBrowserResults.length > 0 && (
            <div className="space-y-2">
              {bitBrowserResults.map((item) => (
                <div
                  key={item.browser_id}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm',
                    item.status === 'imported'
                      ? 'border-[rgba(34,197,94,0.32)] bg-[rgba(34,197,94,0.12)] text-[hsl(var(--success))]'
                      : 'border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] text-[hsl(var(--danger))]',
                  )}
                >
                  <span className="font-semibold">{item.browser_id}</span>
                  {' · '}
                  {item.status === 'imported' ? `导入成功${item.screen_name ? `：@${item.screen_name}` : ''}` : item.message}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[1120px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">用户名</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">检测时间</th>
                  <th className="px-4 py-3">失败原因</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className={cn('border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]', account.status !== 'active' && 'bg-[rgba(248,113,113,0.08)] text-[hsl(var(--muted))]')}>
                    <td className="px-4 py-3">#{account.id}</td>
                    <td className="px-4 py-3 font-medium">{account.label}</td>
                    <td className="px-4 py-3">{account.screen_name ? `@${account.screen_name}` : '-'}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <Badge tone={statusTone(account.status)}>{statusLabel(account.status)}</Badge>
                        <div className="max-w-[220px] text-xs text-[hsl(var(--muted))]">{statusDescription(account.status) || '账号状态'}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{account.last_checked_at || '-'}</td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-[hsl(var(--muted))]">{account.last_error || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => checkAccount.mutate(account.id)} disabled={checkAccount.isPending}>
                          检测
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => deleteAccount.mutate(account.id)} disabled={deleteAccount.isPending}>
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!accounts.length && (
                  <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={7}>还没有账号</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProxyPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['proxies'], queryFn: () => api.proxies(), refetchInterval: 8000 });
  const proxies = data?.proxies || [];
  const [form, setForm] = useState({ label: '', proxy: '' });
  const [error, setError] = useState('');
  const addProxy = useMutation({
    mutationFn: () => api.addProxy(form),
    onSuccess: () => {
      setError('');
      setForm({ label: '', proxy: '' });
      queryClient.invalidateQueries({ queryKey: ['proxies'] });
      queryClient.invalidateQueries({ queryKey: ['run-config'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const checkProxy = useMutation({
    mutationFn: (id: number) => api.checkProxy(id),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['proxies'] });
      queryClient.invalidateQueries({ queryKey: ['run-config'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const toggleProxy = useMutation({
    mutationFn: (id: number) => api.toggleProxy(id),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['proxies'] });
      queryClient.invalidateQueries({ queryKey: ['run-config'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const deleteProxy = useMutation({
    mutationFn: (id: number) => api.deleteProxy(id),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['proxies'] });
      queryClient.invalidateQueries({ queryKey: ['run-config'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">IP / 代理池</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">保存可用代理，运行时从这里选择生效代理。</p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <InfoCard title="可用代理" value={String(proxies.filter((proxy) => proxy.enabled && proxy.status === 'active').length)} />
        <InfoCard title="停用代理" value={String(proxies.filter((proxy) => !proxy.enabled).length)} />
        <InfoCard title="失败次数" value={String(proxies.reduce((sum, proxy) => sum + (proxy.failure_count || 0), 0))} />
        <InfoCard title="最近检测" value={proxies[0]?.last_checked_at || '-'} />
      </div>
      {error && <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-sm text-[hsl(var(--danger))]">{error}</div>}

      <Card>
        <CardHeader>
          <h3 className="font-semibold">新增代理</h3>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <Field label="名称">
            <Input value={form.label} onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))} />
          </Field>
          <Field label="代理地址">
            <Input value={form.proxy} onChange={(e) => setForm((prev) => ({ ...prev, proxy: e.target.value }))} placeholder={PROXY_PLACEHOLDER} />
          </Field>
          <div className="flex items-end">
            <Button onClick={() => addProxy.mutate()} disabled={addProxy.isPending || !form.proxy}>
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[1280px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">代理</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">出口 IP</th>
                  <th className="px-4 py-3">失败次数</th>
                  <th className="px-4 py-3">检测时间</th>
                  <th className="px-4 py-3">错误</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {proxies.map((proxy) => (
                  <tr key={proxy.id} className={cn('border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]', (!proxy.enabled || proxy.status !== 'active') && 'bg-[rgba(148,163,184,0.08)] text-[hsl(var(--muted))]')}>
                    <td className="px-4 py-3">#{proxy.id}</td>
                    <td className="px-4 py-3 font-medium">{proxy.label}</td>
                    <td className="px-4 py-3 break-all">{proxy.proxy}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <Badge tone={proxy.enabled && proxy.status === 'active' ? 'success' : statusTone(proxy.enabled ? proxy.status : 'disabled')}>
                          {proxy.enabled ? statusLabel(proxy.status) : '已停用'}
                        </Badge>
                        <div className="max-w-[240px] text-xs text-[hsl(var(--muted))]">
                          {proxy.enabled ? (statusDescription(proxy.status) || '代理状态') : '当前代理不会参与运行。'}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{proxy.detected_ip || '-'}</td>
                    <td className="px-4 py-3">{proxy.failure_count}</td>
                    <td className="px-4 py-3">{proxy.last_checked_at || '-'}</td>
                    <td className="px-4 py-3 max-w-[280px] truncate text-[hsl(var(--muted))]">{proxy.last_error || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => checkProxy.mutate(proxy.id)} disabled={checkProxy.isPending}>
                          检测
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => toggleProxy.mutate(proxy.id)} disabled={toggleProxy.isPending}>
                          {proxy.enabled ? '停用' : '启用'}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => deleteProxy.mutate(proxy.id)} disabled={deleteProxy.isPending}>
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!proxies.length && (
                  <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={9}>还没有代理</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RunControlPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: configData } = useQuery({ queryKey: ['run-config'], queryFn: () => api.runConfig() });
  const { data: statusData } = useQuery({ queryKey: ['run-status'], queryFn: () => api.runStatus(), refetchInterval: 2000 });
  const { data: proxiesData } = useQuery({ queryKey: ['proxies'], queryFn: () => api.proxies(), refetchInterval: 8000 });
  const [searchParams] = useSearchParams();
  const selectedTemplateId = searchParams.get('template');
  const proxies = proxiesData?.proxies || [];
  const usableProxies = proxies.filter((proxy) => proxy.enabled && proxy.status === 'active');
  const [preflightErrors, setPreflightErrors] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState('');
  const [form, setForm] = useState<RunConfig>(DEFAULT_RUN_FORM);
  const [timePreset, setTimePreset] = useState<TimePreset>('all');

  useEffect(() => {
    if (configData) {
      const template = getTaskTemplateById(selectedTemplateId);
      setForm((prev) => {
        const savedConfig = { ...prev, ...configData };
        if (!template?.runPayload) {
          return savedConfig;
        }
        return {
          ...DEFAULT_RUN_FORM,
          ...savedConfig,
          ...template.runPayload,
          cookie: savedConfig.cookie || '',
          save_path: savedConfig.save_path || '',
        };
      });
      setTimePreset(presetFromTimeRange(template?.runPayload?.time_range || configData.time_range));
    }
  }, [configData, selectedTemplateId]);

  useEffect(() => {
    const template = getTaskTemplateById(selectedTemplateId);
    if (template?.runPayload) {
      setForm((prev) => ({ ...DEFAULT_RUN_FORM, ...prev, ...template.runPayload, cookie: prev.cookie || '', save_path: prev.save_path || '' }));
      setTimePreset(presetFromTimeRange(template.runPayload.time_range || DEFAULT_RUN_FORM.time_range));
    }
  }, [selectedTemplateId]);

  const start = useMutation({
    mutationFn: () => api.runStart({ ...form, proxy_id: form.proxy_id ?? undefined }),
    onSuccess: () => {
      setPreflightErrors([]);
      queryClient.invalidateQueries({ queryKey: ['run-status'] });
    },
  });
  const stop = useMutation({
    mutationFn: api.runStop,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run-status'] }),
  });

  const status = statusData || {
    status: 'idle',
    message: '等待启动',
    logs: [],
    summary: { elapsed: null, api_calls: 0, downloads: 0 },
    output_path: '',
    running_for: null,
    started_at: null,
    ended_at: null,
    return_code: null,
    log_version: 0,
  };

  const handleStart = () => {
    const errors = validateRunForm(form, proxies);
    setPreflightErrors(errors);
    if (errors.length) return;
    start.mutate();
  };
  const timeError = timeRangeError(form.time_range);
  const applyTimePreset = (preset: TimePreset) => {
    setTimePreset(preset);
    setPreflightErrors([]);
    setForm((prev) => ({ ...prev, time_range: rangeFromPreset(preset) }));
  };
  const applyCustomTimeRange = (start: string, end: string) => {
    setTimePreset('custom');
    setPreflightErrors([]);
    setForm((prev) => ({ ...prev, time_range: `${start}:${end}` }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">运行控制</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">配置下载参数、启动任务并查看实时日志。</p>
      </div>
      <ActionBar>
        <Button onClick={handleStart} disabled={start.isPending}>
          <Play className="h-4 w-4" />
          启动
        </Button>
        <Button variant="danger" onClick={() => stop.mutate()} disabled={stop.isPending}>
          <Square className="h-4 w-4" />
          停止
        </Button>
        <Button
          variant="secondary"
          onClick={() => copyText(runCopyText(status)).then(() => setCopyStatus('已复制运行日志')).catch(() => setCopyStatus('复制失败，请手动选择日志'))}
        >
          复制日志
        </Button>
      </ActionBar>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
              <h3 className="font-semibold">快捷模板</h3>
            </div>
            <div className="text-sm text-[hsl(var(--muted))]">点击后进入新建任务并填入参数</div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {taskTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onClick={() => navigate(`/tasks/new?template=${encodeURIComponent(template.id)}`)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {preflightErrors.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--warning))] bg-[rgba(251,191,36,0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]">
          <div className="font-semibold">启动前请先处理：</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {preflightErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}

      {(start.error || stop.error) && (
        <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-sm text-[hsl(var(--danger))]">
          操作没有成功：{(start.error as Error | null)?.message || (stop.error as Error | null)?.message}
        </div>
      )}

      {copyStatus && <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm text-[hsl(var(--muted))]">{copyStatus}</div>}
      <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-4 py-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Info className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
          运行状态：{status.status}
        </div>
        <div className="mt-1 text-[hsl(var(--muted))]">{status.message}</div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <InfoCard title="状态" value={displayStatus(status.status)} />
        <InfoCard title="API 次数" value={String(status.summary.api_calls)} />
        <InfoCard title="下载数" value={String(status.summary.downloads)} />
        <InfoCard title="运行时长" value={status.running_for ? `${status.running_for}s` : '-'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><h3 className="font-semibold">配置</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="保存路径"><Input value={form.save_path} onChange={(e) => setForm((prev) => ({ ...prev, save_path: e.target.value }))} /></Field>
            <Field label="用户名列表"><Textarea rows={3} value={form.user_lst} onChange={(e) => setForm((prev) => ({ ...prev, user_lst: e.target.value }))} /></Field>
            <Field label="Cookie"><Textarea rows={3} value={form.cookie} onChange={(e) => setForm((prev) => ({ ...prev, cookie: e.target.value }))} /></Field>
            <Field label="代理池">
              <select
                className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3"
                value={form.proxy_id ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, proxy_id: e.target.value ? Number(e.target.value) : null }))}
              >
                <option value="">使用手填代理</option>
                {usableProxies.map((proxy) => (
                  <option key={proxy.id} value={proxy.id}>
                    {proxy.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-2 text-sm font-medium">
              <span>时间范围</span>
              <TimeRangePicker
                value={form.time_range}
                preset={timePreset}
                error={timeError}
                onPresetChange={applyTimePreset}
                onCustomChange={applyCustomTimeRange}
              />
            </div>
            <Field label="并发数"><Input type="number" value={form.max_concurrent_requests} onChange={(e) => setForm((prev) => ({ ...prev, max_concurrent_requests: Number(e.target.value) }))} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Check label="包含转推" checked={form.has_retweet} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, has_retweet: checked }))} />
              <Check label="亮点" checked={form.high_lights} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, high_lights: checked }))} />
              <Check label="Likes" checked={form.likes} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, likes: checked }))} />
              <Check label="去重日志" checked={form.down_log} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, down_log: checked }))} />
              <Check label="自动同步" checked={form.autoSync} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, autoSync: checked }))} />
              <Check label="视频下载" checked={form.has_video} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, has_video: checked }))} />
              <Check label="输出 Markdown" checked={form.md_output} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, md_output: checked }))} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h3 className="font-semibold">日志</h3></CardHeader>
          <CardContent>
              <div className="max-h-[640px] overflow-auto rounded-lg border border-[hsl(var(--line))] bg-[#020617] p-4 text-xs leading-6 text-slate-100">
                {status.logs.length ? status.logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : '还没有日志'}
              </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<AuthenticatedApp />} />
    </Routes>
  );
}

function TaskDetailRoute() {
  const params = useParams();
  return <TaskDetailPage id={Number(params.id)} />;
}

export default App;
