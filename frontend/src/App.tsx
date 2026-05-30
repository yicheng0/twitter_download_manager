import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, BarChart3, CalendarClock, CheckCircle2, ChevronRight, CircleUserRound, ClipboardList, Clock3, Database, Eye, FileArchive, FolderKanban, Info, LogOut, Menu, Network, PanelLeftClose, PanelLeftOpen, Plus, RefreshCcw, ShieldCheck, Play, Square, Target, TrendingUp, X, Zap } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from './lib/api';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader } from './components/ui/card';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import type { Account, BitBrowserImportResult, DashboardHeatmap, DashboardHeatmapCell, DashboardHeatmapItem, DashboardTask, OperationLog, ProxyItem, ResultDbConfig, ResultDbFormValues, RunConfig, RunStatus, ScheduledTask, ScheduleFormValues, Task, TaskFormValues, TaskPreview, TaskType } from './lib/types';
import { cn } from './lib/utils';
import { getTaskTemplateById, taskTemplates, type TaskTemplate } from './lib/templates';
import { defaultRunTimeRange, defaultTaskTimeRange, presetFromTimeRange, rangeFromPreset, splitTimeRange, timeRangeError, TIME_PRESETS, todayString, type TimePreset } from './lib/timeRange';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';
type HeatmapMetric = 'count' | 'media_count' | 'task_count';
type HeatmapDays = 1 | 7 | 30;

const USABLE_ACCOUNT_STATUSES = new Set(['active', 'unknown', 'check_failed']);

const DEFAULT_TASK_FORM: TaskFormValues = {
  task_type: 'benchmark_account',
  account_id: 0,
  targets: '',
  time_range: rangeFromPreset('7d'),
  max_concurrent_requests: 2,
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
  tweet_limit: 10,
  media_latest: false,
  text_down: true,
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
  max_concurrent_requests: 2,
  proxy: '',
  md_output: false,
  media_count_limit: 350,
};

const DEFAULT_SCHEDULE_FORM: ScheduleFormValues = {
  name: '每日博主采集',
  account_id: 0,
  proxy_id: null,
  task_type: 'benchmark_account',
  targets: '',
  schedule_type: 'daily',
  run_time: '09:00',
  weekdays: [1, 2, 3, 4, 5],
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
  time_range: rangeFromPreset('7d'),
  max_concurrent_requests: 2,
  tweet_limit: 10,
  has_video: true,
  has_retweet: false,
  down_log: true,
  md_output: false,
  image_format: 'orig',
  media_count_limit: 350,
  proxy: '',
};

const DEFAULT_RESULT_DB_FORM: ResultDbFormValues = {
  label: '采集结果库',
  db_type: 'postgresql',
  host: '',
  port: 5432,
  database_name: '',
  username: '',
  password: '',
  ssl_enabled: false,
  enabled: false,
};

const PROXY_PLACEHOLDER = 'gate.kookeey.info:1000:user:pass 或 socks5://user:pass@host:port';
const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
];

const NAV_ITEMS = [
  { to: '/', icon: BarChart3, label: '看板' },
  { to: '/run', icon: Activity, label: '运行控制' },
  { to: '/tasks', icon: FolderKanban, label: '任务' },
  { to: '/tasks/new', icon: Plus, label: '新建任务' },
  { to: '/schedules', icon: CalendarClock, label: '定时任务' },
  { to: '/operation-logs', icon: ClipboardList, label: '运维日志' },
  { to: '/result-db', icon: Database, label: '数据库' },
  { to: '/accounts', icon: ShieldCheck, label: '账号' },
  { to: '/proxies', icon: Network, label: '代理' },
];

function statusTone(status: string): BadgeTone {
  if (status === 'completed' || status === 'active' || status === 'finished') return 'success';
  if (status === 'running') return 'primary';
  if (status === 'queued' || status === 'unknown' || status === 'check_failed' || status === 'rate_limited' || status === 'partial_failed' || status === 'network_failed' || status === 'stopping' || status === 'disabled') return 'warning';
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
    unknown: '待确认',
    check_failed: '检测异常',
    expired: '已失效',
    disabled: '已停用',
    idle: '空闲',
    stopping: '停止中',
    stopped: '已停止',
    new: '新号保护',
    stable: '稳定',
    untested: '未测试',
    test_failed: '测试失败',
    sync_failed: '同步失败',
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
    unknown: '检测接口无法确认状态，账号暂不禁用。',
    check_failed: '检测请求异常，账号暂不禁用。',
    expired: '当前账号已失效。',
    disabled: '当前代理已停用。',
    idle: '当前没有运行中的任务。',
    stopping: '正在停止当前任务。',
    stopped: '任务已停止。',
    untested: '连接尚未测试。',
    test_failed: '连接测试失败。',
    sync_failed: '结果同步失败。',
  }[status] || '';
}

function levelTone(level: string): BadgeTone {
  if (level === 'error') return 'danger';
  if (level === 'warning') return 'warning';
  return 'primary';
}

function levelLabel(level: string) {
  return {
    info: '信息',
    warning: '警告',
    error: '错误',
  }[level] || level;
}

function displayStatus(status: string) {
  return `${statusLabel(status)}${statusDescription(status) ? ` · ${statusDescription(status)}` : ''}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login';
    },
  });

  return (
    <div className="min-h-screen bg-transparent text-[hsl(var(--text))]">
      <div className="flex min-h-screen">
        <aside className={cn(
          'sticky top-0 hidden h-screen shrink-0 border-r border-[hsl(var(--line))] bg-[rgba(9,18,33,0.9)] backdrop-blur transition-[width] duration-200 lg:flex lg:flex-col',
          sidebarCollapsed ? 'w-[88px]' : 'w-[264px]',
        )}>
          <SidebarContent
            collapsed={sidebarCollapsed}
            userName={meData?.user?.username}
            logoutPending={logout.isPending}
            onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
            onLogout={() => logout.mutate()}
          />
        </aside>

        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="关闭导航菜单"
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="relative z-10 flex h-full w-[min(320px,calc(100vw-2rem))] flex-col border-r border-[hsl(var(--line))] bg-[rgba(9,18,33,0.98)] shadow-[0_24px_70px_rgba(2,8,23,0.55)]">
              <div className="flex min-h-16 items-center justify-between border-b border-[hsl(var(--line))] px-4">
                <BrandMark collapsed={false} />
                <Button variant="ghost" size="sm" className="h-10 w-10 px-0" aria-label="关闭导航菜单" onClick={() => setMobileNavOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <SidebarNav collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
            </aside>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-[hsl(var(--line))] bg-[rgba(9,18,33,0.86)] backdrop-blur lg:hidden">
            <div className="mx-auto flex min-h-16 max-w-[1440px] items-center gap-3 px-4 py-3">
              <Button variant="ghost" size="sm" className="h-10 w-10 px-0 lg:hidden" aria-label="打开导航菜单" onClick={() => setMobileNavOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <main className="mx-auto max-w-[1440px] px-4 py-5">{children}</main>
        </div>
      </div>
    </div>
  );
}

function BrandMark({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', collapsed && 'justify-center')}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--line))] bg-[linear-gradient(180deg,#102033_0%,#0b1220_100%)] shadow-[0_10px_24px_rgba(14,165,233,0.14)]">
        <img src="/logo.svg" alt="X 采集工作台" className="h-9 w-9" />
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--primary-dark))]">采样工作台</div>
          <div className="truncate text-lg font-semibold leading-tight">X 采集工作台</div>
        </div>
      )}
    </div>
  );
}

function SidebarContent({ collapsed, userName, logoutPending, onToggleCollapse, onLogout }: { collapsed: boolean; userName?: string; logoutPending: boolean; onToggleCollapse: () => void; onLogout: () => void }) {
  return (
    <>
      <div className={cn(
        'flex min-h-16 items-center border-b border-[hsl(var(--line))] px-4',
        collapsed ? 'justify-center' : 'justify-between gap-3',
      )}>
        <BrandMark collapsed={collapsed} />
        <Button
          variant="ghost"
          size="sm"
          className="h-10 w-10 shrink-0 px-0"
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          onClick={onToggleCollapse}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>
      <SidebarNav collapsed={collapsed} />
      <div className="mt-auto border-t border-[hsl(var(--line))] p-3">
        {userName && (
          <div className={cn(
            'mb-2 flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-[hsl(var(--muted))]',
            collapsed && 'justify-center px-0',
          )}>
            <CircleUserRound className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{userName}</span>}
          </div>
        )}
        <Button variant="secondary" size="sm" className={cn('w-full', collapsed && 'px-0')} onClick={onLogout} disabled={logoutPending} aria-label="退出">
          <LogOut className="h-4 w-4" />
          {!collapsed && '退出'}
        </Button>
      </div>
    </>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {NAV_ITEMS.map((item) => (
        <NavItem key={item.to} to={item.to} icon={<item.icon className="h-4 w-4" />} label={item.label} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

function NavItem({ to, icon, label, collapsed, onNavigate }: { to: string; icon: React.ReactNode; label: string; collapsed?: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const isActive = to === '/'
    ? location.pathname === '/'
    : to === '/tasks'
      ? location.pathname === '/tasks' || /^\/tasks\/\d+/.test(location.pathname)
      : location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      onClick={onNavigate}
      className={() =>
        cn(
          'inline-flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[hsl(var(--muted))] transition hover:bg-[hsl(var(--panel-soft))] hover:text-[hsl(var(--text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(14,165,233,0.36)]',
          collapsed ? 'justify-center px-0' : 'w-full',
          isActive && 'bg-[rgba(14,165,233,0.16)] text-[hsl(var(--primary-dark))]',
        )
      }
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
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
        <Route path="/schedules" element={<SchedulesPage />} />
        <Route path="/operation-logs" element={<OperationLogsPage />} />
        <Route path="/result-db" element={<ResultDbPage />} />
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
  const [heatmapDays, setHeatmapDays] = useState<HeatmapDays>(7);
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>('count');
  const [selectedHeatmapCell, setSelectedHeatmapCell] = useState<{ date: string; hour: number } | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['dashboard', heatmapDays], queryFn: () => api.dashboard({ heatmap_days: heatmapDays }), refetchInterval: 5000 });
  const { data: health } = useQuery({ queryKey: ['health-status'], queryFn: () => api.healthStatus(), refetchInterval: 15000 });
  const { data: heatmapItems, isFetching: heatmapItemsLoading } = useQuery({
    queryKey: ['dashboard-heatmap-items', selectedHeatmapCell?.date, selectedHeatmapCell?.hour],
    queryFn: () => api.dashboardHeatmapItems({ date: selectedHeatmapCell!.date, hour: selectedHeatmapCell!.hour, limit: 50 }),
    enabled: Boolean(selectedHeatmapCell),
    refetchInterval: selectedHeatmapCell ? 5000 : false,
  });
  const dashboard = data;

  if (isLoading && !dashboard) return <div className="text-sm text-[hsl(var(--muted))]">加载中...</div>;
  if (!dashboard) return <div>看板数据暂不可用</div>;

  const activeTasks = dashboard.active_tasks || dashboard.recent_tasks.filter((task) => task.status === 'running' || task.status === 'queued').slice(0, 5);
  const attentionTasks = dashboard.attention_tasks || dashboard.recent_tasks.filter((task) => statusTone(task.status) === 'danger' || task.status === 'partial_failed').slice(0, 5);
  const recentOutputs = dashboard.recent_outputs || dashboard.recent_tasks.filter((task) => task.status === 'completed').slice(0, 6);
  const resourceAccounts = dashboard.resources?.accounts;
  const resourceProxies = dashboard.resources?.proxies;
  const accountUsable = resourceAccounts?.usable ?? ((health?.accounts?.active ?? 0) + (health?.accounts?.unknown ?? 0) + (health?.accounts?.check_failed ?? 0));
  const accountIssues = (resourceAccounts?.expired ?? health?.accounts?.expired ?? 0) + (resourceAccounts?.cooling ?? 0) + (resourceAccounts?.warning ?? 0);
  const proxyUsable = resourceProxies?.usable ?? (health?.proxies?.active ?? 0);
  const proxyIssues = (resourceProxies?.disabled ?? health?.proxies?.disabled ?? 0) + (resourceProxies?.cooling ?? 0) + (resourceProxies?.warning ?? 0);
  const queueCount = dashboard.status_counts?.queued ?? Math.max(0, dashboard.totals.running - activeTasks.filter((task) => task.status === 'running').length);
  const runningCount = dashboard.status_counts?.running ?? activeTasks.filter((task) => task.status === 'running').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">运行监控</h1>
          <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted))]">
            当前任务、异常处理和资源可用性集中在这里，适合日常盯采集进度。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => (window.location.href = '/tasks')}>
            <FolderKanban className="h-4 w-4" />
            任务列表
          </Button>
          <Button onClick={() => (window.location.href = '/tasks/new')}>
            <Plus className="h-4 w-4" />
            新建任务
          </Button>
        </div>
      </div>

      <Card>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-5">
            <StatusTile title="运行中" value={runningCount} detail={activeTasks[0]?.title || '当前没有运行任务'} tone={runningCount ? 'primary' : 'neutral'} icon={<Activity className="h-4 w-4" />} />
            <StatusTile title="排队中" value={queueCount} detail={queueCount ? '等待 worker 执行' : '队列空闲'} tone={queueCount ? 'warning' : 'neutral'} icon={<Clock3 className="h-4 w-4" />} />
            <StatusTile title="待处理" value={dashboard.totals.failed} detail={attentionTasks[0]?.error || attentionTasks[0]?.last_error_type || '暂无异常任务'} tone={dashboard.totals.failed ? 'danger' : 'success'} icon={<AlertTriangle className="h-4 w-4" />} />
            <StatusTile title="账号可用" value={accountUsable} detail={accountIssues ? `${accountIssues} 个账号需关注` : '账号池可用'} tone={accountUsable ? 'success' : 'danger'} icon={<ShieldCheck className="h-4 w-4" />} />
            <StatusTile title="代理可用" value={proxyUsable} detail={proxyIssues ? `${proxyIssues} 个代理需关注` : '代理池可用'} tone={proxyUsable ? 'success' : 'warning'} icon={<Network className="h-4 w-4" />} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <DashboardTaskPanel title="当前队列" icon={<Activity className="h-4 w-4 text-[hsl(var(--primary-dark))]" />} tasks={activeTasks} emptyTitle="当前空闲" emptyText="没有运行中或排队中的任务。" actionLabel="新建任务" actionHref="/tasks/new" />
        <AttentionPanel tasks={attentionTasks} accountIssues={accountIssues} proxyIssues={proxyIssues} healthError={health?.last_error || ''} />
      </div>

      <HeatmapPanel
        heatmap={dashboard.heatmap}
        days={heatmapDays}
        metric={heatmapMetric}
        selectedCell={selectedHeatmapCell}
        items={heatmapItems?.items || []}
        itemsLoading={heatmapItemsLoading}
        onDaysChange={(value) => {
          setHeatmapDays(value);
          setSelectedHeatmapCell(null);
        }}
        onMetricChange={setHeatmapMetric}
        onCellSelect={setSelectedHeatmapCell}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="采集记录" value={dashboard.totals.records} />
        <Metric title="媒体文件" value={dashboard.totals.media_files} />
        <Metric title="输出文件" value={dashboard.totals.files} />
        <Metric title="总任务" value={dashboard.totals.tasks} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
                <h2 className="font-semibold">最近产出</h2>
              </div>
              <Button variant="secondary" size="sm" onClick={() => (window.location.href = '/tasks')}>
                查看全部
              </Button>
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
                    <th className="px-4 py-3">产出</th>
                    <th className="px-4 py-3">完成时间</th>
                  </tr>
                </thead>
                <tbody>
                  {(recentOutputs.length ? recentOutputs : dashboard.recent_tasks).slice(0, 8).map((task) => <DashboardTableRow key={task.id} task={task} />)}
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
              <h2 className="font-semibold">资源健康</h2>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <InfoCard title="账号可用" value={String(accountUsable)} />
              <InfoCard title="代理可用" value={String(proxyUsable)} />
            </div>
              <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  {health?.running ? <Activity className="h-4 w-4 text-[hsl(var(--primary-dark))]" /> : <Clock3 className="h-4 w-4 text-[hsl(var(--muted))]" />}
                  健康检查：{health?.running ? '运行中' : '空闲'}
                </div>
                <div className="mt-1 text-[hsl(var(--muted))]">上次完成：{health?.last_finished_at || '-'}</div>
                <div className="mt-1 text-[hsl(var(--muted))]">账号关注：{accountIssues} · 代理关注：{proxyIssues}</div>
                {health?.last_error && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-[rgba(248,113,113,0.28)] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-[hsl(var(--danger))]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{health.last_error}</span>
                  </div>
                )}
              </div>
          </CardContent>
        </Card>
      </div>

      <TemplateShelf />
    </div>
  );
}

function StatusTile({ title, value, detail, tone, icon }: { title: string; value: number; detail: string; tone: BadgeTone; icon: React.ReactNode }) {
  return (
    <div className="min-h-28 rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-[hsl(var(--muted))]">{title}</div>
        <Badge tone={tone}>{icon}</Badge>
      </div>
      <div className="mt-2 text-3xl font-semibold leading-none">{value}</div>
      <div className="mt-2 line-clamp-2 text-xs leading-5 text-[hsl(var(--muted))]">{detail || '-'}</div>
    </div>
  );
}

function DashboardTaskPanel({ title, icon, tasks, emptyTitle, emptyText, actionLabel, actionHref }: { title: string; icon: React.ReactNode; tasks: DashboardTask[]; emptyTitle: string; emptyText: string; actionLabel: string; actionHref: string }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {icon}
            <h2 className="font-semibold">{title}</h2>
          </div>
          <Button variant="secondary" size="sm" onClick={() => (window.location.href = actionHref)}>
            {actionLabel}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => (window.location.href = `/tasks/${task.id}`)}
            className="grid w-full cursor-pointer gap-3 rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-3 text-left transition-colors hover:border-[hsl(var(--primary))] hover:bg-[rgba(14,165,233,0.08)] md:grid-cols-[1fr_auto]"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                <span className="truncate text-sm font-semibold">{task.title}</span>
              </div>
              <div className="mt-1 truncate text-xs text-[hsl(var(--muted))]">{task.target}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-right text-xs text-[hsl(var(--muted))]">
              <div><span className="block text-base font-semibold text-[hsl(var(--text))]">{task.summary.records}</span>记录</div>
              <div><span className="block text-base font-semibold text-[hsl(var(--text))]">{task.summary.media_files}</span>媒体</div>
              <div><span className="block text-base font-semibold text-[hsl(var(--text))]">{task.retry_count ?? 0}/{task.max_retries ?? 2}</span>重试</div>
            </div>
          </button>
        ))}
        {!tasks.length && (
          <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-4 py-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(34,197,94,0.14)] text-[hsl(var(--success))]">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="mt-3 font-semibold">{emptyTitle}</div>
            <div className="mt-1 text-sm text-[hsl(var(--muted))]">{emptyText}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttentionPanel({ tasks, accountIssues, proxyIssues, healthError }: { tasks: DashboardTask[]; accountIssues: number; proxyIssues: number; healthError: string }) {
  const hasIssues = tasks.length > 0 || accountIssues > 0 || proxyIssues > 0 || Boolean(healthError);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" />
            <h2 className="font-semibold">需要处理</h2>
          </div>
          <Button variant="secondary" size="sm" onClick={() => (window.location.href = '/tasks')}>
            排查任务
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => (window.location.href = `/tasks/${task.id}`)}
            className="w-full cursor-pointer rounded-lg border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.08)] px-3 py-3 text-left transition-colors hover:bg-[rgba(248,113,113,0.12)]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
              <span className="truncate text-sm font-semibold">{task.title}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-[hsl(var(--muted))]">{task.error || statusDescription(task.last_error_type || task.status) || task.target}</div>
          </button>
        ))}
        {accountIssues > 0 && <AttentionNote label="账号池" value={`${accountIssues} 个账号需要检查、冷却或重新登录`} href="/accounts" />}
        {proxyIssues > 0 && <AttentionNote label="代理池" value={`${proxyIssues} 个代理不可用、冷却或停用`} href="/proxies" />}
        {healthError && <AttentionNote label="健康检查" value={healthError} href="/accounts" />}
        {!hasIssues && (
          <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-4 py-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(34,197,94,0.14)] text-[hsl(var(--success))]">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="mt-3 font-semibold">暂无待处理事项</div>
            <div className="mt-1 text-sm text-[hsl(var(--muted))]">任务、账号和代理当前没有明显异常。</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttentionNote({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <button
      type="button"
      onClick={() => (window.location.href = href)}
      className="flex w-full cursor-pointer items-start justify-between gap-3 rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-3 text-left transition-colors hover:border-[hsl(var(--primary))] hover:bg-[rgba(14,165,233,0.08)]"
    >
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-1 text-xs leading-5 text-[hsl(var(--muted))]">{value}</div>
      </div>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[hsl(var(--primary-dark))]" />
    </button>
  );
}

const HEATMAP_DAY_OPTIONS: Array<{ label: string; value: HeatmapDays }> = [
  { label: '24小时', value: 1 },
  { label: '7天', value: 7 },
  { label: '30天', value: 30 },
];

const HEATMAP_METRICS: Array<{ label: string; value: HeatmapMetric; totalLabel: string }> = [
  { label: '记录数', value: 'count', totalLabel: '记录' },
  { label: '媒体数', value: 'media_count', totalLabel: '媒体' },
  { label: '任务数', value: 'task_count', totalLabel: '任务' },
];

function heatmapMetricValue(cell: DashboardHeatmapCell | undefined, metric: HeatmapMetric) {
  if (!cell) return 0;
  return Number(cell[metric] || 0);
}

function heatmapLevel(value: number, maxValue: number, selected = false) {
  if (selected) return 'bg-[rgba(249,115,22,0.98)] border-[rgba(255,237,213,0.95)] ring-2 ring-[rgba(255,237,213,0.45)]';
  if (!value || !maxValue) return 'bg-[rgba(148,163,184,0.12)] border-[rgba(148,163,184,0.18)]';
  const ratio = value / maxValue;
  if (ratio >= 0.8) return 'bg-[rgba(249,115,22,0.92)] border-[rgba(249,115,22,0.95)]';
  if (ratio >= 0.55) return 'bg-[rgba(251,191,36,0.78)] border-[rgba(251,191,36,0.82)]';
  if (ratio >= 0.3) return 'bg-[rgba(14,165,233,0.62)] border-[rgba(14,165,233,0.68)]';
  return 'bg-[rgba(59,130,246,0.34)] border-[rgba(59,130,246,0.42)]';
}

function heatmapSummary(heatmap: DashboardHeatmap | undefined, metric: HeatmapMetric) {
  const cells = heatmap?.cells || [];
  const today = heatmap?.dates?.[heatmap.dates.length - 1];
  const yesterday = heatmap?.dates?.[heatmap.dates.length - 2];
  const metricLabel = HEATMAP_METRICS.find((item) => item.value === metric)?.totalLabel || '记录';
  let total = 0;
  let todayTotal = 0;
  let yesterdayTotal = 0;
  let maxValue = 0;
  let peak: DashboardHeatmapCell | null = null;
  const tasks = new Set<string>();
  for (const cell of cells) {
    const value = heatmapMetricValue(cell, metric);
    total += value;
    if (cell.date === today) todayTotal += value;
    if (cell.date === yesterday) yesterdayTotal += value;
    if (value > maxValue) {
      maxValue = value;
      peak = cell;
    }
    if (cell.task_count) tasks.add(`${cell.date}-${cell.hour}`);
  }
  return {
    total,
    todayTotal,
    yesterdayTotal,
    maxValue,
    peakLabel: peak ? `${peak.date.slice(5)} ${String(peak.hour).padStart(2, '0')}:00` : '-',
    taskWindows: tasks.size,
    metricLabel,
  };
}

function HeatmapPanel({
  heatmap,
  days,
  metric,
  selectedCell,
  items,
  itemsLoading,
  onDaysChange,
  onMetricChange,
  onCellSelect,
}: {
  heatmap?: DashboardHeatmap;
  days: HeatmapDays;
  metric: HeatmapMetric;
  selectedCell: { date: string; hour: number } | null;
  items: DashboardHeatmapItem[];
  itemsLoading: boolean;
  onDaysChange: (value: HeatmapDays) => void;
  onMetricChange: (value: HeatmapMetric) => void;
  onCellSelect: (value: { date: string; hour: number }) => void;
}) {
  const cells = heatmap?.cells || [];
  const cellByKey = new Map(cells.map((cell) => [`${cell.date}-${cell.hour}`, cell]));
  const dates = heatmap?.dates || [];
  const hours = heatmap?.hours || Array.from({ length: 24 }, (_, index) => index);
  const summary = heatmapSummary(heatmap, metric);
  const metricName = HEATMAP_METRICS.find((item) => item.value === metric)?.label || '记录数';
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
            <h2 className="font-semibold">采集时间热力图</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl options={HEATMAP_DAY_OPTIONS} value={days} onChange={onDaysChange} />
            <SegmentedControl options={HEATMAP_METRICS} value={metric} onChange={onMetricChange} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-4">
          <InfoCard title={`总${summary.metricLabel}`} value={String(summary.total)} />
          <InfoCard title={`今日${summary.metricLabel}`} value={String(summary.todayTotal)} />
          <InfoCard title={`昨日${summary.metricLabel}`} value={String(summary.yesterdayTotal)} />
          <InfoCard title="峰值时段" value={summary.peakLabel} />
        </div>
        <div className="overflow-auto">
          <div className="min-w-[980px]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[hsl(var(--muted))]">
              <div>最近 {heatmap?.days || days} 天 · {metricName} · 数据源：{heatmap?.source === 'external' ? '外部结果库' : '本地索引库'}</div>
              <div>总量 {summary.total} · 峰值 {summary.maxValue} · 活跃时段 {summary.taskWindows}</div>
            </div>
            <div className="grid gap-1" style={{ gridTemplateColumns: `88px repeat(${hours.length}, minmax(28px, 1fr))` }}>
              <div />
              {hours.map((hour) => (
                <div key={hour} className="text-center text-[10px] text-[hsl(var(--muted))]">{hour}</div>
              ))}
              {dates.map((date) => (
                <div key={date} className="contents">
                  <div className="flex items-center text-xs text-[hsl(var(--muted))]">{date.slice(5)}</div>
                  {hours.map((hour) => {
                    const cell = cellByKey.get(`${date}-${hour}`) || { date, hour, count: 0, media_count: 0, task_count: 0 };
                    const value = heatmapMetricValue(cell, metric);
                    const selected = selectedCell?.date === date && selectedCell.hour === hour;
                    return (
                      <button
                        key={`${date}-${hour}`}
                        type="button"
                        onClick={() => onCellSelect({ date, hour })}
                        title={`${date} ${String(hour).padStart(2, '0')}:00 记录 ${cell.count} · 媒体 ${cell.media_count} · 任务 ${cell.task_count}`}
                        className={cn('h-7 cursor-pointer rounded border transition-colors hover:border-[hsl(var(--text))]', heatmapLevel(value, summary.maxValue, selected))}
                        aria-label={`${date} ${hour}点 ${metricName} ${value}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[hsl(var(--muted))]">
              <div>总记录 {heatmap?.total || 0} · 峰值 {heatmap?.max_count || 0}</div>
              <div className="flex items-center gap-2">
                <span>低</span>
                <span className="h-3 w-6 rounded bg-[rgba(59,130,246,0.34)]" />
                <span className="h-3 w-6 rounded bg-[rgba(14,165,233,0.62)]" />
                <span className="h-3 w-6 rounded bg-[rgba(251,191,36,0.78)]" />
                <span className="h-3 w-6 rounded bg-[rgba(249,115,22,0.92)]" />
                <span>高</span>
              </div>
            </div>
          </div>
        </div>
        <HeatmapDrilldown selectedCell={selectedCell} items={items} loading={itemsLoading} />
      </CardContent>
    </Card>
  );
}

function SegmentedControl<T extends string | number>({ options, value, onChange }: { options: Array<{ label: string; value: T }>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="flex rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-1">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-8 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors',
            option.value === value ? 'bg-[hsl(var(--primary))] text-slate-950' : 'text-[hsl(var(--muted))] hover:bg-[rgba(148,163,184,0.12)] hover:text-[hsl(var(--text))]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function HeatmapDrilldown({ selectedCell, items, loading }: { selectedCell: { date: string; hour: number } | null; items: DashboardHeatmapItem[]; loading: boolean }) {
  if (!selectedCell) {
    return (
      <div className="rounded-lg border border-dashed border-[hsl(var(--line))] px-4 py-6 text-center text-sm text-[hsl(var(--muted))]">
        点击热力图中的任意时段，查看对应采集内容。
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--line))] px-4 py-3">
        <div>
          <div className="font-semibold">{selectedCell.date} {String(selectedCell.hour).padStart(2, '0')}:00</div>
          <div className="text-xs text-[hsl(var(--muted))]">最新 {items.length} 条采集内容</div>
        </div>
        {loading && <div className="text-xs text-[hsl(var(--muted))]">刷新中...</div>}
      </div>
      <div className="divide-y divide-[hsl(var(--line))]">
        {items.map((item) => (
          <HeatmapItemRow key={`${item.task_id}-${item.tweet_url}-${item.activity_at}`} item={item} />
        ))}
        {!items.length && (
          <div className="px-4 py-8 text-center text-sm text-[hsl(var(--muted))]">
            {loading ? '正在读取采集内容...' : '该时段暂无采集内容'}
          </div>
        )}
      </div>
    </div>
  );
}

function HeatmapItemRow({ item }: { item: DashboardHeatmapItem }) {
  const metrics = [
    item.favorite_count ? `${item.favorite_count} 赞` : '',
    item.retweet_count ? `${item.retweet_count} 转` : '',
    item.reply_count ? `${item.reply_count} 评` : '',
    item.media_count ? `${item.media_count} 媒体` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[180px_1fr_auto]">
      <div className="min-w-0">
        <button className="block truncate font-semibold hover:text-[hsl(var(--primary-dark))]" onClick={() => (window.location.href = `/tasks/${item.task_id}`)}>
          {item.task_title || `任务 #${item.task_id}`}
        </button>
        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{item.activity_at || '-'}</div>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted))]">
          <span>{item.display_name || '-'}</span>
          {item.screen_name && <span>@{item.screen_name.replace(/^@/, '')}</span>}
        </div>
        <div className="mt-1 line-clamp-2 leading-5">{item.content || item.tweet_url || '-'}</div>
      </div>
      <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
        {metrics && <span className="text-xs text-[hsl(var(--muted))]">{metrics}</span>}
        {item.tweet_url && (
          <Button variant="secondary" size="sm" onClick={() => window.open(item.tweet_url, '_blank', 'noopener,noreferrer')}>
            <Eye className="h-4 w-4" />
            原文
          </Button>
        )}
      </div>
    </div>
  );
}

function DashboardTableRow({ task }: { task: DashboardTask }) {
  return (
    <tr className="border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]">
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
        <div className="font-medium">{task.summary.records} / {task.summary.media_files} / {formatBytes(task.summary.total_bytes)}</div>
        <div className="text-xs text-[hsl(var(--muted))]">记录 / 媒体 / 大小</div>
      </td>
      <td className="px-4 py-3">{task.finished_at || task.created_at}</td>
    </tr>
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
  const deleteTask = useMutation({
    mutationFn: (id: number) => api.deleteTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const handleDeleteTask = (id: number) => {
    if (window.confirm('确定删除这个任务吗？任务记录和输出文件都会被删除。')) {
      deleteTask.mutate(id);
    }
  };
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
                {tasks.map((task) => <TaskRow key={task.id} task={task} onDelete={handleDeleteTask} deleting={deleteTask.isPending} />)}
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

function TaskRow({ task, onDelete, deleting }: { task: Task; onDelete: (id: number) => void; deleting: boolean }) {
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
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate(`/tasks/${task.id}`)}>
            查看
          </Button>
          <Button variant="danger" size="sm" onClick={() => onDelete(task.id)} disabled={deleting}>
            删除
          </Button>
        </div>
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
  const usableAccounts = accounts?.filter((account) => USABLE_ACCOUNT_STATUSES.has(account.status));
  const usableProxies = proxies.filter((proxy) => proxy.enabled && proxy.status === 'active');
  const [form, setForm] = useState<TaskFormValues>(DEFAULT_TASK_FORM);
  const [timePreset, setTimePreset] = useState<TimePreset>('7d');
  const [showAdvanced, setShowAdvanced] = useState(false);
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
    const selectedAccountUsable = usableAccounts?.some((account) => account.id === form.account_id);
    if (form.account_id && usableAccounts && !selectedAccountUsable) {
      setForm((prev) => ({ ...prev, account_id: 0 }));
    }
  }, [usableAccounts, form.account_id]);

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
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">默认采集账号近况：粘贴 X 主页链接，选择条数和内容类型后提交。</p>
      </div>
      <ActionBar>
        <Button onClick={() => create.mutate()} disabled={create.isPending || !usableAccounts?.length || Boolean(timeError)}>
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
            <h3 className="font-semibold">基础采集</h3>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">例如输入 https://x.com/arsenal，采最近 10 条推文，包含图片和视频。</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="目标账号">
            <Textarea
              value={form.targets}
              onChange={(e) => setForm((prev) => ({ ...prev, targets: e.target.value }))}
              rows={3}
              placeholder="https://x.com/arsenal 或 @arsenal"
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="采集条数">
              <Input type="number" min={1} value={form.tweet_limit} onChange={(e) => setForm((prev) => ({ ...prev, tweet_limit: Number(e.target.value) }))} />
            </Field>
            <Field label="X账号">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.account_id} onChange={(e) => setForm((prev) => ({ ...prev, account_id: Number(e.target.value) }))}>
                <option value={0}>自动分配可用账号</option>
                {(usableAccounts || []).map((account: Account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}{account.screen_name ? ` (@${account.screen_name})` : ''}{account.status !== 'active' ? ` · ${statusLabel(account.status)}` : ''}{account.cooldown_until ? ` · 冷却至 ${account.cooldown_until}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Check label="推文文本" checked={true} disabled onCheckedChange={() => undefined} />
            <Check label="图片" checked={true} disabled onCheckedChange={() => undefined} />
            <Check label="视频" checked={form.has_video} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, has_video: checked }))} />
          </div>
          <Field label="代理池">
            <select
              className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3"
              value={form.proxy_id ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, proxy_id: e.target.value ? Number(e.target.value) : null }))}
            >
              <option value="">自动分配或不使用代理</option>
              {usableProxies.map((proxy) => (
                <option key={proxy.id} value={proxy.id}>
                  {proxy.label}{proxy.cooldown_until ? ` · 冷却至 ${proxy.cooldown_until}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <TimeRangePicker
            value={form.time_range}
            preset={timePreset}
            error={timeError}
            onPresetChange={applyTimePreset}
            onCustomChange={applyCustomTimeRange}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setShowAdvanced((value) => !value)}>
          {showAdvanced ? '收起更多设置' : '更多设置'}
        </Button>
      </div>

      {showAdvanced && <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><h3 className="font-semibold">基础</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="任务类型">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.task_type} onChange={(e) => setForm((prev) => ({ ...prev, task_type: e.target.value as TaskType }))}>
                <option value="user_media">用户媒体</option>
                <option value="benchmark_account">对标账号</option>
                <option value="search">搜索/Tag</option>
                <option value="text">用户文本</option>
                <option value="replies">评论区</option>
                <option value="profile">主页资料</option>
              </select>
            </Field>
            <Field label="X账号">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.account_id} onChange={(e) => setForm((prev) => ({ ...prev, account_id: Number(e.target.value) }))}>
                <option value={0}>自动分配可用账号</option>
                {(usableAccounts || []).map((account: Account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}{account.screen_name ? ` (@${account.screen_name})` : ''}{account.status !== 'active' ? ` · ${statusLabel(account.status)}` : ''}{account.cooldown_until ? ` · 冷却至 ${account.cooldown_until}` : ''}
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
          <CardHeader><h3 className="font-semibold">对标账号</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="拉取条数">
              <Input type="number" min={1} value={form.tweet_limit} onChange={(e) => setForm((prev) => ({ ...prev, tweet_limit: Number(e.target.value) }))} />
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
                <option value="">自动分配或使用手填代理</option>
                {usableProxies.map((proxy) => (
                  <option key={proxy.id} value={proxy.id}>
                    {proxy.label}{proxy.cooldown_until ? ` · 冷却至 ${proxy.cooldown_until}` : ''}
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
      </div>}

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

function Check({ label, checked, onCheckedChange, disabled = false }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn('flex min-h-11 items-center gap-3 rounded-lg border border-[hsl(var(--line))] px-3 py-2 text-sm', disabled && 'text-[hsl(var(--muted))]')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onCheckedChange(event.target.checked)} className="h-4 w-4" />
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
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['task', id], queryFn: () => api.task(id), refetchInterval: 4000 });
  const { data: logData } = useQuery({ queryKey: ['operation-logs', 'task', id], queryFn: () => api.operationLogs({ task_id: id, limit: 80 }), refetchInterval: 4000 });
  const task = data?.task;
  const operationLogs = logData?.logs || [];
  const [copyStatus, setCopyStatus] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.cancelTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task', id] }),
  });
  const deleteTask = useMutation({
    mutationFn: () => api.deleteTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      navigate('/tasks');
    },
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
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm('确定删除这个任务吗？任务记录和输出文件都会被删除。')) {
              deleteTask.mutate();
            }
          }}
          disabled={deleteTask.isPending}
        >
          删除任务
        </Button>
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
        <InfoCard title={task.task_type === 'profile' ? '资料文件' : '采集记录'} value={String(task.task_type === 'profile' ? task.summary?.files ?? 0 : task.summary?.records ?? 0)} />
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

      <TaskPreviewPanel preview={task.preview} />

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
            <h3 className="font-semibold">运维事件</h3>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/operation-logs?task_id=${task.id}`)}>查看全部关联日志</Button>
        </div>
        <OperationLogTable logs={operationLogs} />
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

const PREVIEW_COLUMNS: Array<{ label: string; keys: string[]; type?: 'text' | 'link' | 'media' | 'metrics' }> = [
  { label: '时间', keys: ['Tweet Date', 'Reply Date'] },
  { label: '作者', keys: ['Display Name', 'Replier Display Name'] },
  { label: '用户名', keys: ['User Name', 'Replier User Name'] },
  { label: '内容', keys: ['Tweet Content', 'Reply Content'], type: 'text' },
  { label: '链接', keys: ['Tweet URL', 'Reply URL', 'Parent Tweet URL'], type: 'link' },
  { label: '媒体', keys: ['Media URL'], type: 'media' },
  { label: '互动', keys: ['Favorite Count', 'Reply Favorite Count', 'Retweet Count', 'Reply Retweet Count', 'Reply Count', 'Reply Reply Count'], type: 'metrics' },
];

function previewValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value) return value;
  }
  return '';
}

function PreviewLink({ value }: { value: string }) {
  if (!value) return <span className="text-[hsl(var(--muted))]">-</span>;
  return (
    <a href={value} target="_blank" rel="noreferrer" className="inline-flex max-w-[220px] items-center gap-1 truncate text-[hsl(var(--primary-dark))] hover:text-[hsl(var(--text))]">
      <span className="truncate">{value}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

function PreviewMetrics({ row }: { row: Record<string, string> }) {
  const favorites = previewValue(row, ['Favorite Count', 'Reply Favorite Count']);
  const retweets = previewValue(row, ['Retweet Count', 'Reply Retweet Count']);
  const replies = previewValue(row, ['Reply Count', 'Reply Reply Count']);
  if (!favorites && !retweets && !replies) return <span className="text-[hsl(var(--muted))]">-</span>;
  return <span className="whitespace-nowrap">{favorites || 0} / {retweets || 0} / {replies || 0}</span>;
}

function PreviewCell({ column, row }: { column: (typeof PREVIEW_COLUMNS)[number]; row: Record<string, string> }) {
  if (column.type === 'link') {
    return <PreviewLink value={previewValue(row, column.keys)} />;
  }
  if (column.type === 'media') {
    const mediaUrl = previewValue(row, column.keys);
    const mediaType = previewValue(row, ['Media Type']);
    if (!mediaUrl && !mediaType) return <span className="text-[hsl(var(--muted))]">-</span>;
    return (
      <div className="max-w-[240px] space-y-1">
        {mediaType && <div className="text-xs font-semibold text-[hsl(var(--muted))]">{mediaType}</div>}
        <PreviewLink value={mediaUrl} />
      </div>
    );
  }
  if (column.type === 'metrics') {
    return <PreviewMetrics row={row} />;
  }
  const value = previewValue(row, column.keys);
  if (!value) return <span className="text-[hsl(var(--muted))]">-</span>;
  if (column.type === 'text') {
    return <div className="max-w-[420px] whitespace-pre-wrap break-words leading-6">{value}</div>;
  }
  return <span className="whitespace-nowrap">{value}</span>;
}

function TaskPreviewPanel({ preview }: { preview?: TaskPreview }) {
  const rows = preview?.rows || [];
  const hiddenCount = Math.max((preview?.total || 0) - rows.length, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
            <h3 className="font-semibold">采集内容</h3>
          </div>
          <div className="text-xs text-[hsl(var(--muted))]">
            共 {preview?.total || 0} 条，预览最新 {rows.length} 条
            {hiddenCount > 0 ? `，另有 ${hiddenCount} 条请打包下载查看` : ''}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-auto">
          <table className="w-full min-w-[1080px] border-collapse text-sm">
            <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
              <tr>
                {PREVIEW_COLUMNS.map((column) => (
                  <th key={column.label} className="px-4 py-3">{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-[hsl(var(--line))] align-top hover:bg-[rgba(14,165,233,0.06)]">
                  {PREVIEW_COLUMNS.map((column) => (
                    <td key={column.label} className="px-4 py-3">
                      <PreviewCell column={column} row={row} />
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={PREVIEW_COLUMNS.length}>
                    暂无采集内容
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function OperationLogTable({ logs }: { logs: OperationLog[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-auto">
          <table className="w-full min-w-[1080px] border-collapse text-sm">
            <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
              <tr>
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">级别</th>
                <th className="px-4 py-3">事件</th>
                <th className="px-4 py-3">关联</th>
                <th className="px-4 py-3">消息</th>
                <th className="px-4 py-3">错误类型</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-[hsl(var(--line))] align-top hover:bg-[hsl(var(--panel-soft))]">
                  <td className="whitespace-nowrap px-4 py-3">{log.created_at}</td>
                  <td className="px-4 py-3"><Badge tone={levelTone(log.level)}>{levelLabel(log.level)}</Badge></td>
                  <td className="px-4 py-3 font-medium">{log.event_type}</td>
                  <td className="px-4 py-3 text-[hsl(var(--muted))]">
                    {log.task_id ? <a className="text-[hsl(var(--primary-dark))] hover:text-[hsl(var(--text))]" href={`/tasks/${log.task_id}`}>任务 #{log.task_id}</a> : '-'}
                    {log.schedule_id ? <div>计划 #{log.schedule_id}</div> : null}
                  </td>
                  <td className="max-w-[460px] px-4 py-3">
                    <div className="whitespace-pre-wrap break-words">{log.message}</div>
                    {Object.keys(log.details || {}).length > 0 && (
                      <pre className="mt-2 max-h-28 overflow-auto rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-2 text-xs text-[hsl(var(--muted))]">{JSON.stringify(log.details, null, 2)}</pre>
                    )}
                  </td>
                  <td className="px-4 py-3">{log.error_type || '-'}</td>
                </tr>
              ))}
              {!logs.length && (
                <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={6}>暂无运维日志</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SchedulesPage() {
  const queryClient = useQueryClient();
  const { data: scheduleData } = useQuery({ queryKey: ['schedules'], queryFn: () => api.schedules(), refetchInterval: 8000 });
  const { data: accountData } = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts() });
  const { data: proxiesData } = useQuery({ queryKey: ['proxies'], queryFn: () => api.proxies() });
  const { data: health } = useQuery({ queryKey: ['health-status'], queryFn: () => api.healthStatus(), refetchInterval: 15000 });
  const schedules = scheduleData?.schedules || [];
  const usableAccounts = (accountData?.accounts || []).filter((account) => USABLE_ACCOUNT_STATUSES.has(account.status));
  const usableProxies = (proxiesData?.proxies || []).filter((proxy) => proxy.enabled && proxy.status === 'active');
  const [form, setForm] = useState<ScheduleFormValues>(DEFAULT_SCHEDULE_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const saveSchedule = useMutation({
    mutationFn: () => editingId ? api.updateSchedule(editingId, form) : api.createSchedule(form),
    onSuccess: () => {
      setError('');
      setEditingId(null);
      setForm((prev) => ({ ...DEFAULT_SCHEDULE_FORM, account_id: prev.account_id }));
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const toggleSchedule = useMutation({
    mutationFn: (id: number) => api.toggleSchedule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  });
  const deleteSchedule = useMutation({
    mutationFn: (id: number) => api.deleteSchedule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  });
  const runScheduleNow = useMutation({
    mutationFn: (id: number) => api.runScheduleNow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const editSchedule = (schedule: ScheduledTask) => {
    setEditingId(schedule.id);
    setForm({
      ...DEFAULT_SCHEDULE_FORM,
      ...schedule.config,
      name: schedule.name,
      account_id: schedule.account_id,
      proxy_id: schedule.proxy_id,
      schedule_type: schedule.schedule_type,
      run_time: schedule.run_time,
      weekdays: schedule.weekdays.length ? schedule.weekdays : DEFAULT_SCHEDULE_FORM.weekdays,
      timezone: schedule.timezone || DEFAULT_SCHEDULE_FORM.timezone,
    } as ScheduleFormValues);
  };

  const toggleWeekday = (day: number) => {
    setForm((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(day) ? prev.weekdays.filter((item) => item !== day) : [...prev.weekdays, day].sort(),
    }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">定时任务</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">按每日或每周固定时间自动生成博主采集任务。</p>
      </div>
      {error && <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-sm text-[hsl(var(--danger))]">{error}</div>}
      <Card>
        <CardHeader><h3 className="font-semibold">{editingId ? `编辑计划 #${editingId}` : '新建计划'}</h3></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="计划名称"><Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} /></Field>
            <Field label="X账号">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.account_id} onChange={(e) => setForm((prev) => ({ ...prev, account_id: Number(e.target.value) }))}>
                <option value={0}>自动分配可用账号</option>
                {usableAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}{account.screen_name ? ` (@${account.screen_name})` : ''}</option>)}
              </select>
            </Field>
            <Field label="采集类型">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.task_type} onChange={(e) => setForm((prev) => ({ ...prev, task_type: e.target.value as ScheduleFormValues['task_type'] }))}>
                <option value="benchmark_account">账号近况</option>
                <option value="user_media">用户媒体</option>
              </select>
            </Field>
          </div>
          <Field label="目标博主 / 博主列表">
            <Textarea rows={3} value={form.targets} onChange={(e) => setForm((prev) => ({ ...prev, targets: e.target.value }))} placeholder="每行一个用户名或主页链接" />
          </Field>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="执行周期">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.schedule_type} onChange={(e) => setForm((prev) => ({ ...prev, schedule_type: e.target.value as ScheduleFormValues['schedule_type'] }))}>
                <option value="daily">每日</option>
                <option value="weekly">每周</option>
              </select>
            </Field>
            <Field label="执行时间"><Input type="time" value={form.run_time} onChange={(e) => setForm((prev) => ({ ...prev, run_time: e.target.value }))} /></Field>
            <Field label="采集条数"><Input type="number" min={1} value={form.tweet_limit} onChange={(e) => setForm((prev) => ({ ...prev, tweet_limit: Number(e.target.value) }))} /></Field>
            <Field label="并发数"><Input type="number" min={1} value={form.max_concurrent_requests} onChange={(e) => setForm((prev) => ({ ...prev, max_concurrent_requests: Number(e.target.value) }))} /></Field>
          </div>
          {form.schedule_type === 'weekly' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
              {WEEKDAYS.map((day) => <Check key={day.value} label={day.label} checked={form.weekdays.includes(day.value)} onCheckedChange={() => toggleWeekday(day.value)} />)}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <Check label="下载视频" checked={form.has_video} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, has_video: checked }))} />
            <Check label="去重日志" checked={form.down_log} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, down_log: checked }))} />
            <Check label="输出 Markdown" checked={form.md_output} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, md_output: checked }))} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="代理池">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.proxy_id ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, proxy_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">不使用代理池</option>
                {usableProxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.label}</option>)}
              </select>
            </Field>
            <Field label="时间范围"><Input value={form.time_range} onChange={(e) => setForm((prev) => ({ ...prev, time_range: e.target.value }))} /></Field>
          </div>
          <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm text-[hsl(var(--muted))]">
            服务器时区：{form.timezone || 'local'} · 错过执行默认跳过 · 连续失败 3 次自动停用
          </div>
          {health?.resource_policy && (
            <div className="grid gap-2 md:grid-cols-3">
              <InfoCard title="新号每日上限" value={String(health.resource_policy.account_new_task_limit_24h)} />
              <InfoCard title="稳定号每日上限" value={String(health.resource_policy.account_stable_task_limit_24h)} />
              <InfoCard title="限流冷却" value={`${Math.round(health.resource_policy.account_rate_limit_cooldown_seconds / 3600)}h`} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            {editingId && <Button variant="secondary" onClick={() => { setEditingId(null); setForm(DEFAULT_SCHEDULE_FORM); }}>取消编辑</Button>}
            <Button onClick={() => saveSchedule.mutate()} disabled={saveSchedule.isPending || !form.targets.trim()}>保存计划</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[1120px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr><th className="px-4 py-3">计划</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">周期</th><th className="px-4 py-3">目标</th><th className="px-4 py-3">下次执行</th><th className="px-4 py-3">失败</th><th className="px-4 py-3">最近任务</th><th className="px-4 py-3"></th></tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.id} className="border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]">
                    <td className="px-4 py-3"><div className="font-medium">#{schedule.id} {schedule.name}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">{schedule.username || '-'}</div></td>
                    <td className="px-4 py-3"><Badge tone={schedule.enabled ? 'success' : 'neutral'}>{schedule.enabled ? '已启用' : '已停用'}</Badge></td>
                    <td className="px-4 py-3">{schedule.schedule_type === 'daily' ? '每日' : `每周 ${schedule.weekdays.map((day) => WEEKDAYS.find((item) => item.value === day)?.label).join(' ')}`} · {schedule.run_time}</td>
                    <td className="max-w-[260px] truncate px-4 py-3">{String(schedule.config.targets || '-')}</td>
                    <td className="px-4 py-3">{schedule.next_run_at || '-'}</td>
                    <td className="px-4 py-3">{schedule.consecutive_failures}{schedule.last_error ? <div className="max-w-[220px] truncate text-xs text-[hsl(var(--danger))]">{schedule.last_error}</div> : null}</td>
                    <td className="px-4 py-3">{schedule.last_task_id ? <a className="text-[hsl(var(--primary-dark))]" href={`/tasks/${schedule.last_task_id}`}>#{schedule.last_task_id}</a> : '-'}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={() => runScheduleNow.mutate(schedule.id)}>立即执行</Button><Button variant="secondary" size="sm" onClick={() => editSchedule(schedule)}>编辑</Button><Button variant="secondary" size="sm" onClick={() => toggleSchedule.mutate(schedule.id)}>{schedule.enabled ? '停用' : '启用'}</Button><Button variant="danger" size="sm" onClick={() => deleteSchedule.mutate(schedule.id)}>删除</Button></div></td>
                  </tr>
                ))}
                {!schedules.length && <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={8}>暂无定时任务</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OperationLogsPage() {
  const [searchParams] = useSearchParams();
  const [level, setLevel] = useState('');
  const [eventType, setEventType] = useState('');
  const [errorType, setErrorType] = useState('');
  const [query, setQuery] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 100;
  const taskId = Number(searchParams.get('task_id') || 0) || undefined;
  const scheduleId = Number(searchParams.get('schedule_id') || 0) || undefined;
  const params = {
    task_id: taskId,
    schedule_id: scheduleId,
    level: level || undefined,
    event_type: eventType || undefined,
    error_type: errorType || undefined,
    q: query || undefined,
    start_at: startAt ? `${startAt} 00:00:00` : undefined,
    end_at: endAt ? `${endAt} 23:59:59` : undefined,
    offset,
    limit,
  };
  const { data, refetch } = useQuery({ queryKey: ['operation-logs', params], queryFn: () => api.operationLogs(params), refetchInterval: 5000 });
  const logs = data?.logs || [];
  const total = data?.total || 0;
  const canPrev = offset > 0;
  const canNext = offset + limit < total;
  const resetPage = () => setOffset(0);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">运维日志</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">记录任务创建、调度、执行、失败分类和重试事件。{taskId ? `当前筛选任务 #${taskId}` : ''}{scheduleId ? `当前筛选计划 #${scheduleId}` : ''}</p>
      </div>
      <ActionBar>
        <select className="h-10 rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3 text-sm" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">全部级别</option>
          <option value="info">信息</option>
          <option value="warning">警告</option>
          <option value="error">错误</option>
        </select>
        <Input className="w-40" placeholder="事件类型" value={eventType} onChange={(e) => { setEventType(e.target.value); resetPage(); }} />
        <Input className="w-40" placeholder="错误类型" value={errorType} onChange={(e) => { setErrorType(e.target.value); resetPage(); }} />
        <Input className="w-48" placeholder="关键词" value={query} onChange={(e) => { setQuery(e.target.value); resetPage(); }} />
        <Input className="w-40" type="date" value={startAt} onChange={(e) => { setStartAt(e.target.value); resetPage(); }} />
        <Input className="w-40" type="date" value={endAt} onChange={(e) => { setEndAt(e.target.value); resetPage(); }} />
        <Button variant="secondary" onClick={() => { setLevel(''); setEventType(''); setErrorType(''); setQuery(''); setStartAt(''); setEndAt(''); setOffset(0); }}>清空筛选</Button>
        <Button variant="secondary" onClick={() => refetch()}><RefreshCcw className="h-4 w-4" />刷新</Button>
      </ActionBar>
      <OperationLogTable logs={logs} />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[hsl(var(--muted))]">
        <div>共 {total} 条，当前 {total ? offset + 1 : 0}-{Math.min(offset + limit, total)}</div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={!canPrev} onClick={() => setOffset(Math.max(0, offset - limit))}>上一页</Button>
          <Button variant="secondary" size="sm" disabled={!canNext} onClick={() => setOffset(offset + limit)}>下一页</Button>
        </div>
      </div>
    </div>
  );
}

function ResultDbPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['result-db'], queryFn: () => api.resultDbs(), refetchInterval: 10000 });
  const configs = data?.configs || [];
  const [form, setForm] = useState<ResultDbFormValues>(DEFAULT_RESULT_DB_FORM);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const saveConfig = useMutation({
    mutationFn: () => api.saveResultDb(form),
    onSuccess: () => {
      setError('');
      setMessage('数据库配置已保存');
      setForm(DEFAULT_RESULT_DB_FORM);
      queryClient.invalidateQueries({ queryKey: ['result-db'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const testConfig = useMutation({
    mutationFn: (id: number) => api.testResultDb(id),
    onSuccess: (res) => {
      setError(res.ok ? '' : res.error);
      setMessage(res.ok ? '连接测试通过，结果表已准备好' : '');
      queryClient.invalidateQueries({ queryKey: ['result-db'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const toggleConfig = useMutation({
    mutationFn: (id: number) => api.toggleResultDb(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['result-db'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const deleteConfig = useMutation({
    mutationFn: (id: number) => api.deleteResultDb(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['result-db'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const editConfig = (config: ResultDbConfig) => {
    setForm({
      id: config.id,
      label: config.label,
      db_type: config.db_type,
      host: config.host,
      port: config.port,
      database_name: config.database_name,
      username: config.username,
      password: '',
      ssl_enabled: config.ssl_enabled,
      enabled: config.enabled,
    });
    setMessage(config.has_password ? '已载入配置；如不修改密码，保存时会沿用原密码。' : '');
  };

  const updateDbType = (dbType: ResultDbFormValues['db_type']) => {
    setForm((prev) => ({ ...prev, db_type: dbType, port: dbType === 'postgresql' ? 5432 : 3306 }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">外部结果库</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">连接 PostgreSQL 或 MySQL 保存采集结果，任务队列和账号仍保留在本地 SQLite。</p>
      </div>
      {error && <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-sm text-[hsl(var(--danger))]">{error}</div>}
      {message && <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm text-[hsl(var(--muted))]">{message}</div>}
      {!data?.credential_key_configured && (
        <div className="rounded-lg border border-[hsl(var(--warning))] bg-[rgba(251,191,36,0.12)] px-3 py-2 text-sm">
          未检测到 <span className="font-semibold">TW_WEB_CREDENTIAL_KEY</span>。本地模式会用会话密钥派生加密密钥；生产模式必须配置后才能保存密码。
        </div>
      )}
      <Card>
        <CardHeader><h3 className="font-semibold">{form.id ? `编辑连接 #${form.id}` : '新增连接'}</h3></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="名称"><Input value={form.label} onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))} /></Field>
            <Field label="类型">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.db_type} onChange={(e) => updateDbType(e.target.value as ResultDbFormValues['db_type'])}>
                <option value="postgresql">PostgreSQL</option>
                <option value="mysql">MySQL</option>
              </select>
            </Field>
            <Field label="端口"><Input type="number" value={form.port} onChange={(e) => setForm((prev) => ({ ...prev, port: Number(e.target.value) }))} /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="主机"><Input value={form.host} onChange={(e) => setForm((prev) => ({ ...prev, host: e.target.value }))} placeholder="127.0.0.1" /></Field>
            <Field label="数据库名"><Input value={form.database_name} onChange={(e) => setForm((prev) => ({ ...prev, database_name: e.target.value }))} /></Field>
            <Field label="用户名"><Input value={form.username} onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))} /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <Field label="密码"><Input type="password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} placeholder={form.id ? '留空则沿用原密码' : ''} /></Field>
            <div className="flex items-end"><Check label="启用 SSL" checked={form.ssl_enabled} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, ssl_enabled: checked }))} /></div>
            <div className="flex items-end"><Check label="设为启用" checked={form.enabled} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))} /></div>
          </div>
          <div className="flex justify-end gap-2">
            {form.id && <Button variant="secondary" onClick={() => setForm(DEFAULT_RESULT_DB_FORM)}>取消编辑</Button>}
            <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending || !form.host || !form.database_name || !form.username}>
              保存连接
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr><th className="px-4 py-3">连接</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">地址</th><th className="px-4 py-3">测试/同步</th><th className="px-4 py-3">错误</th><th className="px-4 py-3"></th></tr>
              </thead>
              <tbody>
                {configs.map((config) => (
                  <tr key={config.id} className="border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]">
                    <td className="px-4 py-3"><div className="font-medium">{config.label}</div><div className="mt-1 text-xs text-[hsl(var(--muted))]">{config.db_type} · {config.username} · {config.has_password ? '已保存密码' : '无密码'}</div></td>
                    <td className="px-4 py-3"><div className="space-y-1"><Badge tone={config.enabled ? 'success' : 'neutral'}>{config.enabled ? '已启用' : '未启用'}</Badge><div><Badge tone={statusTone(config.status)}>{statusLabel(config.status)}</Badge></div></div></td>
                    <td className="px-4 py-3">{config.host}:{config.port}/{config.database_name}</td>
                    <td className="px-4 py-3"><div className="space-y-1 text-xs text-[hsl(var(--muted))]"><div>测试：{config.last_tested_at || '-'}</div><div>同步：{config.last_synced_at || '-'}</div></div></td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-[hsl(var(--muted))]">{config.last_error || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => editConfig(config)}>编辑</Button>
                        <Button variant="secondary" size="sm" onClick={() => testConfig.mutate(config.id)} disabled={testConfig.isPending}>测试</Button>
                        <Button variant="secondary" size="sm" onClick={() => toggleConfig.mutate(config.id)} disabled={toggleConfig.isPending}>{config.enabled ? '停用' : '启用'}</Button>
                        <Button variant="danger" size="sm" onClick={() => { if (window.confirm('确定删除这个外部数据库连接吗？')) deleteConfig.mutate(config.id); }} disabled={deleteConfig.isPending}>删除</Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!configs.length && <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={6}>还没有外部数据库连接</td></tr>}
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
        <InfoCard title="可用账号" value={String(accounts.filter((account) => USABLE_ACCOUNT_STATUSES.has(account.status)).length)} />
        <InfoCard title="待确认账号" value={String(accounts.filter((account) => account.status === 'unknown' || account.status === 'check_failed').length)} />
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
            <table className="w-full min-w-[1320px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">用户名</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">治理</th>
                  <th className="px-4 py-3">检测时间</th>
                  <th className="px-4 py-3">失败原因</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className={cn('border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]', !USABLE_ACCOUNT_STATUSES.has(account.status) && 'bg-[rgba(248,113,113,0.08)] text-[hsl(var(--muted))]')}>
                    <td className="px-4 py-3">#{account.id}</td>
                    <td className="px-4 py-3 font-medium">{account.label}</td>
                    <td className="px-4 py-3">{account.screen_name ? `@${account.screen_name}` : '-'}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <Badge tone={statusTone(account.status)}>{statusLabel(account.status)}</Badge>
                        <div className="max-w-[220px] text-xs text-[hsl(var(--muted))]">{statusDescription(account.status) || '账号状态'}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1 text-xs text-[hsl(var(--muted))]">
                        <div><Badge tone={account.tier === 'stable' ? 'success' : 'warning'}>{statusLabel(account.tier)}</Badge></div>
                        <div>任务 {account.task_count} · 成功 {account.success_count} · 失败 {account.failure_count}</div>
                        <div>上次使用：{account.last_used_at || '-'}</div>
                        <div>冷却至：{account.cooldown_until || '-'}</div>
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
                  <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={8}>还没有账号</td></tr>
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
                  <th className="px-4 py-3">治理</th>
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
                    <td className="px-4 py-3">
                      <div className="space-y-1 text-xs text-[hsl(var(--muted))]">
                        <div>成功 {proxy.success_count} · 失败 {proxy.failure_count}</div>
                        <div>上次使用：{proxy.last_used_at || '-'}</div>
                        <div>冷却至：{proxy.cooldown_until || '-'}</div>
                      </div>
                    </td>
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
