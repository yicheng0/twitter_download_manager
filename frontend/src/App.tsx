import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, BarChart3, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, CircleUserRound, ClipboardList, Clock3, Database, Edit3, Eye, ExternalLink, FileArchive, FolderKanban, Heart, Image, Info, Layers3, LogOut, Menu, MessageCircle, Network, PanelLeftClose, PanelLeftOpen, Plus, RefreshCcw, Repeat2, Search, ShieldCheck, Play, Save, Square, Target, TrendingUp, UserRoundCheck, Video, X, Zap } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from './lib/api';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader } from './components/ui/card';
import { Input } from './components/ui/input';
import { SelectMenu } from './components/ui/select-menu';
import { Textarea } from './components/ui/textarea';
import type { Account, BitBrowserImportResult, BloggerCategory, DashboardHeatmap, DashboardHeatmapCell, DashboardHeatmapItem, DashboardTask, LocalBrowserLoginHelperStatus, LoginQueueItem, LoginQueueParseResponse, OperationLog, ProxyItem, ResultDbConfig, ResultDbFormValues, RunConfig, RunStatus, ScheduledTask, ScheduleFormValues, Task, TaskFormValues, TaskPreview, TaskResultItem, TaskResultMedia, TaskType, TrackedBlogger } from './lib/types';
import { cn } from './lib/utils';
import { getTaskTemplateById, taskTemplates, type TaskTemplate } from './lib/templates';
import { defaultRunTimeRange, presetFromTimeRange, rangeFromPreset, splitTimeRange, timeRangeError, TIME_PRESETS, todayString, type TimePreset } from './lib/timeRange';
import { TaskLiveView } from './pages/TaskLiveView';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';
type HeatmapMetric = 'count' | 'media_count' | 'task_count';
type HeatmapDays = 1 | 7 | 30;
type ProxyMode = 'auto' | 'pool' | 'manual';

const USABLE_ACCOUNT_STATUSES = new Set(['active', 'unknown', 'check_failed']);
const LOGIN_QUEUE_TERMINAL_STATUSES = new Set(['completed', 'failed', 'expired', 'cancelled', 'skipped']);

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
  target_limits: {},
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
  monitor_new_content: false,
  monitor_interval_minutes: 15,
  first_run_policy: 'baseline',
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
  { to: '/bloggers', icon: UserRoundCheck, label: '博主管理' },
  { to: '/operation-logs', icon: ClipboardList, label: '运维日志' },
  { to: '/result-db', icon: Database, label: '数据库' },
  { to: '/accounts', icon: ShieldCheck, label: '账号' },
  { to: '/proxies', icon: Network, label: '代理' },
];

function proxyModeFromValues(proxyId?: number | null, proxy?: string): ProxyMode {
  if (proxyId) return 'pool';
  if (String(proxy || '').trim()) return 'manual';
  return 'auto';
}

function statusTone(status: string): BadgeTone {
  if (status === 'completed' || status === 'active' || status === 'finished') return 'success';
  if (status === 'running') return 'primary';
  if (status === 'queued' || status === 'pending' || status === 'unknown' || status === 'check_failed' || status === 'rate_limited' || status === 'partial_failed' || status === 'network_failed' || status === 'stopping' || status === 'disabled' || status === 'helper_missing' || status === 'helper_starting') return 'warning';
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
    pending: '等待中',
    skipped: '已跳过',
    helper_missing: '助手未就绪',
    helper_starting: '助手启动中',
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
    pending: '等待前一个登录窗口完成。',
    skipped: '已从队列跳过。',
    helper_missing: '本地登录助手没有响应。',
    helper_starting: '本地登录助手正在启动。',
    idle: '当前没有运行中的任务。',
    stopping: '正在停止当前任务。',
    stopped: '任务已停止。',
    untested: '连接尚未测试。',
    test_failed: '连接测试失败。',
    sync_failed: '结果同步失败。',
  }[status] || '';
}

function levelTone(level: string): BadgeTone {
  if (level === 'error' || level === 'warning') return 'danger';
  return 'success';
}

function operationLogRowClass(level: string) {
  if (level === 'error' || level === 'warning') {
    return 'border-t border-[rgba(248,113,113,0.36)] bg-[rgba(248,113,113,0.08)] align-top text-[hsl(var(--text))] hover:bg-[rgba(248,113,113,0.14)]';
  }
  return 'border-t border-[rgba(34,197,94,0.28)] bg-[rgba(34,197,94,0.06)] align-top text-[hsl(var(--text))] hover:bg-[rgba(34,197,94,0.11)]';
}

function operationLogMessageClass(level: string) {
  if (level === 'error' || level === 'warning') return 'text-[hsl(var(--danger))]';
  return 'text-[hsl(var(--success))]';
}

function accountCapacityTone(level?: string): BadgeTone {
  if (level === 'healthy') return 'success';
  if (level === 'limited' || level === 'cooldown' || level === 'watch') return 'warning';
  if (level === 'expired' || level === 'risky') return 'danger';
  return 'neutral';
}

function accountUsabilityLabel(account: Account) {
  if (account.status === 'active') return '已验证可用';
  if (account.status === 'unknown') return '可尝试 / 未确认';
  if (account.status === 'check_failed') return '可尝试 / 检测异常';
  return '不可用';
}

function accountUsabilityTone(account: Account): BadgeTone {
  if (account.status === 'active') return 'success';
  if (account.status === 'unknown' || account.status === 'check_failed') return 'warning';
  return 'danger';
}

function accountUsabilityDescription(account: Account) {
  if (account.status === 'active') return '检测通过，可自动分配任务。';
  if (account.status === 'unknown') return '检测接口无法确认，不等于失效；任务仍可尝试使用。';
  if (account.status === 'check_failed') return '检测请求异常，不等于失效；任务仍可尝试使用，但需要关注失败原因。';
  if (account.status === 'expired' || account.status === 'auth_expired') return '会话已失效，需要重新登录后再使用。';
  if (account.status === 'disabled') return '账号已停用，不会自动分配任务。';
  return statusDescription(account.status) || '当前不会自动分配任务。';
}

function accountQuotaSummary(account: Account) {
  if (!account.capacity) return '-';
  return `API ${account.capacity.api_remaining_estimate}/${account.capacity.api_budget_24h} · 任务 ${account.capacity.task_remaining_24h}/${account.capacity.task_limit_24h}`;
}

function accountErrorSummary(account: Account) {
  return account.last_error || account.capacity?.reason || accountUsabilityDescription(account) || '-';
}

function localHelperErrorMessage(err: unknown, mode: 'local' | 'remote' = 'remote') {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (mode === 'local') {
    if (!raw || raw === 'Failed to fetch' || raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('Load failed')) {
      return '本机授权助手自动启动后仍未响应。请稍后重试，或手动运行 start_local_login_helper.bat。';
    }
    return raw;
  }
  if (!raw || raw === 'Failed to fetch' || raw.includes('Failed to fetch')) {
    return '首次使用需要运行一次本地授权助手安装器；安装后以后点击“开始本地授权”即可自动打开 Chrome。';
  }
  if (raw.includes('NetworkError') || raw.includes('Load failed')) {
    return '首次使用需要运行一次本地授权助手安装器；安装后以后点击“开始本地授权”即可自动打开 Chrome。';
  }
  return raw;
}

function helperCanAutoStartOnBackend(helper: LocalBrowserLoginHelperStatus) {
  return helper.auto_start_supported !== false && helper.status !== 'unsupported';
}

function helperIsLocalBackendFailure(message: string) {
  return message.includes('自动启动失败') || message.includes('手动运行 start_local_login_helper.bat') || message.includes('本机授权助手自动启动');
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function helperRetryDelay(helper?: LocalBrowserLoginHelperStatus | null) {
  const value = Number(helper?.retry_after_ms || 700);
  return Math.max(250, Math.min(value, 2000));
}

function parseAppTime(value: string) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function relativeTime(value: string, nowMs: number) {
  const parsed = parseAppTime(value);
  if (!parsed) return value || '-';
  const diffSeconds = Math.max(0, Math.floor((nowMs - parsed.getTime()) / 1000));
  if (diffSeconds < 10) return '刚刚';
  if (diffSeconds < 60) return `${diffSeconds} 秒前`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} 天前`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} 个月前`;
  return `${Math.floor(diffMonths / 12)} 年前`;
}

function displayTaskTitle(task: Pick<Task, 'title' | 'task_type'> | Pick<DashboardTask, 'title' | 'task_type'> | Pick<DashboardHeatmapItem, 'task_title' | 'task_type'>) {
  const rawTitle = 'title' in task ? task.title : task.task_title;
  const title = (rawTitle || '').trim();
  if (task.task_type === 'benchmark_account') {
    return title.replace(/^对标账号\s*[-—:：]\s*/u, '') || title || '未命名任务';
  }
  return title || '未命名任务';
}

function proxyStatusLabel(proxy: ProxyItem) {
  if (!proxy.enabled) return '已停用';
  if (proxy.status === 'check_failed') return '自动恢复中';
  return statusLabel(proxy.status);
}

function accountBoundProxySummary(account: Account) {
  if (!account.bound_proxy_id) return '未绑定';
  const label = account.bound_proxy_label || `代理 #${account.bound_proxy_id}`;
  if (account.bound_proxy_available) return label;
  return `${label} · 不可用将回退`;
}

function accountWarmupSummary(account: Account) {
  if (account.tier === 'stable') return `稳定 · 连续健康 ${account.warmup_success_streak || 0}/${3}`;
  if (account.last_warmup_at) return `连续健康 ${account.warmup_success_streak || 0}/3 · ${account.last_warmup_at}`;
  return '未养护';
}

function proxyStatusDescription(proxy: ProxyItem) {
  if (!proxy.enabled) return '当前代理不会参与运行。';
  if (proxy.status === 'check_failed') return '探测失败，系统会继续心跳检测，恢复后自动参与任务。';
  return statusDescription(proxy.status) || '代理状态';
}

function riskLevelLabel(level?: string) {
  return {
    healthy: '健康',
    watch: '观察',
    risky: '高风险',
    cooldown: '冷却',
    expired: '失效',
  }[level || ''] || level || '-';
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
            <div className="flex min-h-16 w-full items-center gap-3 px-4 py-3 sm:px-5 2xl:px-8">
              <Button variant="ghost" size="sm" className="h-10 w-10 px-0 lg:hidden" aria-label="打开导航菜单" onClick={() => setMobileNavOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <main className="w-full px-4 py-5 sm:px-5 2xl:px-8">{children}</main>
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
        <div className="min-w-0 leading-tight">
          <div className="text-[11px] font-medium text-[hsl(var(--primary-dark))] opacity-80">采集控制台</div>
          <div className="truncate text-base font-semibold leading-tight">X 采集工作台</div>
        </div>
      )}
    </div>
  );
}

function SidebarContent({ collapsed, userName, logoutPending, onToggleCollapse, onLogout }: { collapsed: boolean; userName?: string; logoutPending: boolean; onToggleCollapse: () => void; onLogout: () => void }) {
  return (
    <>
      <div className={cn(
        'flex items-center border-b border-[hsl(var(--line))]',
        collapsed ? 'min-h-[96px] flex-col justify-center gap-2 px-0 py-3' : 'min-h-16 justify-between gap-3 px-4',
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
        <Route path="/tasks/:id/live" element={<TaskLiveView />} />
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
  const activeTasks = data?.active_tasks || data?.recent_tasks.filter((task) => task.status === 'running' || task.status === 'queued').slice(0, 5) || [];
  const queueCount = data?.status_counts?.queued ?? Math.max(0, (data?.totals.running || 0) - activeTasks.filter((task) => task.status === 'running').length);
  const runningCount = data?.status_counts?.running ?? activeTasks.filter((task) => task.status === 'running').length;
  const hasActiveWork = runningCount > 0 || queueCount > 0 || activeTasks.length > 0;
  const { data: heatmapItems, isFetching: heatmapItemsLoading } = useQuery({
    queryKey: ['dashboard-heatmap-items', selectedHeatmapCell?.date, selectedHeatmapCell?.hour],
    queryFn: () => api.dashboardHeatmapItems({ date: selectedHeatmapCell!.date, hour: selectedHeatmapCell!.hour, limit: 50 }),
    enabled: hasActiveWork && Boolean(selectedHeatmapCell),
    refetchInterval: hasActiveWork && selectedHeatmapCell ? 5000 : false,
  });
  const dashboard = data;

  useEffect(() => {
    if (!hasActiveWork && selectedHeatmapCell) {
      setSelectedHeatmapCell(null);
    }
  }, [hasActiveWork, selectedHeatmapCell]);

  if (isLoading && !dashboard) return <div className="text-sm text-[hsl(var(--muted))]">加载中...</div>;
  if (!dashboard) return <div>看板数据暂不可用</div>;

  const attentionTasks = dashboard.attention_tasks || dashboard.recent_tasks.filter((task) => statusTone(task.status) === 'danger' || task.status === 'partial_failed').slice(0, 5);
  const recentOutputs = dashboard.recent_outputs || dashboard.recent_tasks.filter((task) => task.status === 'completed').slice(0, 6);
  const resourceAccounts = dashboard.resources?.accounts;
  const resourceProxies = dashboard.resources?.proxies;
  const accountUsable = resourceAccounts?.usable ?? ((health?.accounts?.active ?? 0) + (health?.accounts?.unknown ?? 0) + (health?.accounts?.check_failed ?? 0));
  const accountIssues = (resourceAccounts?.expired ?? health?.accounts?.expired ?? 0) + (resourceAccounts?.cooling ?? 0) + (resourceAccounts?.warning ?? 0);
  const proxyUsable = resourceProxies?.usable ?? (health?.proxies?.active ?? 0);
  const proxyIssues = (resourceProxies?.disabled ?? health?.proxies?.disabled ?? 0) + (resourceProxies?.cooling ?? 0) + (resourceProxies?.warning ?? 0);
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

      {hasActiveWork && (
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
      )}

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
                <span className="truncate text-sm font-semibold">{displayTaskTitle(task)}</span>
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
              <span className="truncate text-sm font-semibold">{displayTaskTitle(task)}</span>
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

type HeatmapDailyRow = {
  date: string;
  value: number;
  count: number;
  media_count: number;
  task_count: number;
  peakHour: number;
  peakValue: number;
  percent: number;
};

function heatmapDailyRows(heatmap: DashboardHeatmap | undefined, metric: HeatmapMetric) {
  const byDate = new Map<string, HeatmapDailyRow>();
  for (const date of heatmap?.dates || []) {
    byDate.set(date, {
      date,
      value: 0,
      count: 0,
      media_count: 0,
      task_count: 0,
      peakHour: 0,
      peakValue: 0,
      percent: 0,
    });
  }
  for (const cell of heatmap?.cells || []) {
    const row = byDate.get(cell.date);
    if (!row) continue;
    const value = heatmapMetricValue(cell, metric);
    row.value += value;
    row.count += Number(cell.count || 0);
    row.media_count += Number(cell.media_count || 0);
    row.task_count += Number(cell.task_count || 0);
    if (value > row.peakValue) {
      row.peakValue = value;
      row.peakHour = cell.hour;
    }
  }
  const rows = Array.from(byDate.values());
  const maxDailyValue = Math.max(0, ...rows.map((row) => row.value));
  return rows.map((row) => ({
    ...row,
    percent: maxDailyValue ? Math.round((row.value / maxDailyValue) * 100) : 0,
  }));
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
  const summary = heatmapSummary(heatmap, metric);
  const metricName = HEATMAP_METRICS.find((item) => item.value === metric)?.label || '记录数';
  const dailyRows = heatmapDailyRows(heatmap, metric);
  const selectedDate = selectedCell?.date;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
            <h2 className="font-semibold">采集进度趋势</h2>
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
        <div className="rounded-lg border border-[hsl(var(--line))] bg-[rgba(15,23,42,0.36)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--line))] px-4 py-3 text-xs text-[hsl(var(--muted))]">
            <div>最近 {heatmap?.days || days} 天 · {metricName} · 数据源：{heatmap?.source === 'external' ? '外部结果库' : '本地索引库'}</div>
            <div>总量 {summary.total} · 峰值时段 {summary.maxValue} · 活跃时段 {summary.taskWindows}</div>
          </div>
          <div className="divide-y divide-[hsl(var(--line))]">
            {dailyRows.map((row) => {
              const selected = selectedDate === row.date;
              const peakLabel = `${String(row.peakHour).padStart(2, '0')}:00`;
              return (
                <button
                  key={row.date}
                  type="button"
                  onClick={() => onCellSelect({ date: row.date, hour: row.peakHour })}
                  className={cn(
                    'grid w-full cursor-pointer gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(14,165,233,0.08)] md:grid-cols-[96px_minmax(0,1fr)_280px]',
                    selected && 'bg-[rgba(14,165,233,0.12)]',
                  )}
                  aria-label={`${row.date} ${metricName} ${row.value}，峰值小时 ${peakLabel}`}
                >
                  <div className="min-w-0">
                    <div className="font-semibold">{row.date.slice(5)}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">峰值 {peakLabel}</div>
                  </div>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-[rgba(148,163,184,0.16)]">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary))_0%,hsl(var(--warning))_100%)] transition-[width] duration-300"
                        style={{ width: `${row.percent}%` }}
                      />
                    </div>
                    <div className="w-14 text-right text-xs font-semibold text-[hsl(var(--primary-dark))]">{row.percent}%</div>
                  </div>
                  <div className="flex flex-wrap items-center justify-start gap-2 text-xs text-[hsl(var(--muted))] md:justify-end">
                    <Badge tone={row.value ? 'primary' : 'neutral'}>{row.value} {summary.metricLabel}</Badge>
                    <span>{row.count} 记录</span>
                    <span>{row.media_count} 媒体</span>
                    <span>{row.task_count} 任务</span>
                  </div>
                </button>
              );
            })}
            {!dailyRows.length && (
              <div className="px-4 py-8 text-center text-sm text-[hsl(var(--muted))]">暂无采集趋势数据</div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--line))] px-4 py-3 text-xs text-[hsl(var(--muted))]">
            <div>点击某天查看当天峰值小时的采集内容。</div>
            <div>总记录 {heatmap?.total || 0} · 原始小时峰值 {heatmap?.max_count || 0}</div>
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
          {item.task_title ? displayTaskTitle(item) : `任务 #${item.task_id}`}
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
          {displayTaskTitle(task)}
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

function CollapsibleTaskCard({
  title,
  summary,
  defaultOpen = false,
  contentClassName,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <CardHeader className="p-0">
        <button
          type="button"
          className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(14,165,233,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--panel))]"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="flex min-w-0 items-center gap-2 font-semibold text-[hsl(var(--text))]">
            {open ? <ChevronDown className="h-4 w-4 shrink-0 text-[hsl(var(--muted))]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--muted))]" />}
            <span className="truncate">{title}</span>
          </span>
          {summary && <span className="shrink-0 text-xs text-[hsl(var(--muted))]">{summary}</span>}
        </button>
      </CardHeader>
      {open && <CardContent className={contentClassName}>{children}</CardContent>}
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
    `任务: #${task.id} ${displayTaskTitle(task)}`,
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
        <div className="font-medium">{displayTaskTitle(task)}</div>
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
  const queryClient = useQueryClient();
  const { data: bloggersData } = useQuery({ queryKey: ['bloggers'], queryFn: () => api.bloggers() });
  const [searchParams] = useSearchParams();
  const selectedTemplateId = searchParams.get('template');
  const accounts = accountData?.accounts;
  const proxies = proxiesData?.proxies || [];
  const usableAccounts = accounts?.filter((account) => USABLE_ACCOUNT_STATUSES.has(account.status));
  const usableProxies = proxies.filter((proxy) => proxy.enabled && proxy.status === 'active');
  const [form, setForm] = useState<TaskFormValues>(DEFAULT_TASK_FORM);
  const [timePreset, setTimePreset] = useState<TimePreset>('7d');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [proxyMode, setProxyMode] = useState<ProxyMode>('auto');
  const [error, setError] = useState('');
  const [bloggerForm, setBloggerForm] = useState({ screen_name: '', default_tweet_limit: 10 });
  const [showBatchLimit, setShowBatchLimit] = useState(false);
  const [batchLimit, setBatchLimit] = useState(10);
  const [savingDefaultLimits, setSavingDefaultLimits] = useState(false);
  const bloggers = bloggersData?.bloggers || [];
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
  const addBlogger = useMutation({
    mutationFn: () => api.addBlogger(bloggerForm),
    onSuccess: async () => {
      setBloggerForm({ screen_name: '', default_tweet_limit: 10 });
      await queryClient.invalidateQueries({ queryKey: ['bloggers'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const updateBlogger = useMutation({
    mutationFn: ({ id, default_tweet_limit }: { id: number; default_tweet_limit: number }) => api.updateBlogger(id, { default_tweet_limit }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bloggers'] }),
    onError: (err: Error) => setError(err.message),
  });
  const deleteBlogger = useMutation({
    mutationFn: (id: number) => api.deleteBlogger(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bloggers'] }),
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
      setProxyMode(proxyModeFromValues(template.payload.proxy_id, template.payload.proxy));
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
  const syncSelectedBloggers = (targetLimits: Record<string, number>) => {
    const targets = Object.keys(targetLimits).join('\n');
    setForm((prev) => ({
      ...prev,
      targets,
      target_limits: targetLimits,
      task_type: 'benchmark_account',
    }));
  };
  const toggleBlogger = (blogger: TrackedBlogger, checked: boolean) => {
    const key = blogger.screen_name.toLowerCase();
    const next = { ...(form.target_limits || {}) };
    if (checked) {
      next[key] = Number(next[key] || blogger.default_tweet_limit || form.tweet_limit || 10);
    } else {
      delete next[key];
    }
    syncSelectedBloggers(next);
  };
  const updateSelectedLimit = (screenName: string, limit: number) => {
    const next = { ...(form.target_limits || {}), [screenName.toLowerCase()]: Math.max(1, Number(limit) || 1) };
    syncSelectedBloggers(next);
  };
  const selectedTargetLimits = form.target_limits || {};
  const selectedBloggers = bloggers.filter((blogger) => Object.prototype.hasOwnProperty.call(selectedTargetLimits, blogger.screen_name.toLowerCase()));
  const selectedBloggerCount = Object.keys(selectedTargetLimits).length;
  const plannedTweetCount = Object.values(selectedTargetLimits).reduce((total, limit) => total + Math.max(1, Number(limit) || 1), 0);
  const applyBatchLimit = () => {
    const safeLimit = Math.max(1, Number(batchLimit) || 1);
    const next = { ...selectedTargetLimits };
    Object.keys(next).forEach((screenName) => {
      next[screenName] = safeLimit;
    });
    syncSelectedBloggers(next);
    setShowBatchLimit(false);
  };
  const clearSelectedBloggers = () => syncSelectedBloggers({});
  const saveSelectedDefaultLimits = async () => {
    if (!selectedBloggers.length) return;
    setSavingDefaultLimits(true);
    setError('');
    try {
      await Promise.all(selectedBloggers.map((blogger) => api.updateBlogger(blogger.id, { default_tweet_limit: Math.max(1, Number(selectedTargetLimits[blogger.screen_name.toLowerCase()]) || 1) })));
      await queryClient.invalidateQueries({ queryKey: ['bloggers'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存默认条数失败');
    } finally {
      setSavingDefaultLimits(false);
    }
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
              onChange={(e) => setForm((prev) => ({ ...prev, targets: e.target.value, target_limits: {} }))}
              rows={3}
              placeholder="https://x.com/arsenal 或 @arsenal"
            />
          </Field>
          <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))]">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[hsl(var(--line))] px-4 py-3">
              <div>
                <div className="font-semibold">博主库</div>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">选择历史博主，并为每个博主设置本次采集条数。</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-[160px_100px_auto]">
                <Input value={bloggerForm.screen_name} onChange={(e) => setBloggerForm((prev) => ({ ...prev, screen_name: e.target.value }))} placeholder="@username" />
                <Input type="number" min={1} value={bloggerForm.default_tweet_limit} onChange={(e) => setBloggerForm((prev) => ({ ...prev, default_tweet_limit: Number(e.target.value) }))} />
                <Button size="sm" onClick={() => addBlogger.mutate()} disabled={addBlogger.isPending || !bloggerForm.screen_name.trim()}>
                  <Plus className="h-4 w-4" />
                  添加
                </Button>
              </div>
            </div>
            <div className="border-b border-[hsl(var(--line))] px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold">博主配置</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                    {selectedBloggerCount ? `已选 ${selectedBloggerCount} 个博主 / 计划采集 ${plannedTweetCount} 条` : '先在下方选择博主，再批量配置本次采集条数。'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setShowBatchLimit((prev) => !prev)} disabled={!selectedBloggerCount}>
                    <Target className="h-4 w-4" />
                    批量设置本次条数
                  </Button>
                  <Button variant="secondary" size="sm" onClick={saveSelectedDefaultLimits} disabled={!selectedBloggers.length || savingDefaultLimits}>
                    <CheckCircle2 className="h-4 w-4" />
                    保存为默认条数
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearSelectedBloggers} disabled={!selectedBloggerCount}>
                    <X className="h-4 w-4" />
                    清空选择
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['bloggers'] })} disabled={bloggersData === undefined}>
                    <RefreshCcw className="h-4 w-4" />
                    刷新博主库
                  </Button>
                </div>
              </div>
              {showBatchLimit && (
                <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[hsl(var(--line))] bg-[rgba(15,23,42,0.58)] p-3 sm:flex-row sm:items-end">
                  <Field label="批量条数">
                    <Input type="number" min={1} value={batchLimit} onChange={(e) => setBatchLimit(Number(e.target.value))} />
                  </Field>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={applyBatchLimit} disabled={!selectedBloggerCount}>
                      应用
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowBatchLimit(false)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                  <tr>
                    <th className="px-4 py-3">选择</th>
                    <th className="px-4 py-3">博主</th>
                    <th className="px-4 py-3">本次条数</th>
                    <th className="px-4 py-3">默认条数</th>
                    <th className="px-4 py-3">最近使用</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {bloggers.map((blogger) => {
                    const key = blogger.screen_name.toLowerCase();
                    const selected = Object.prototype.hasOwnProperty.call(form.target_limits || {}, key);
                    return (
                      <tr key={blogger.id} className="border-t border-[hsl(var(--line))]">
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={selected} onChange={(e) => toggleBlogger(blogger, e.target.checked)} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">@{blogger.screen_name}</div>
                          <div className="text-xs text-[hsl(var(--muted))]">使用 {blogger.use_count} 次</div>
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            min={1}
                            value={selected ? form.target_limits[key] : blogger.default_tweet_limit}
                            onChange={(e) => updateSelectedLimit(blogger.screen_name, Number(e.target.value))}
                            disabled={!selected}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            min={1}
                            value={blogger.default_tweet_limit}
                            onChange={(e) => updateBlogger.mutate({ id: blogger.id, default_tweet_limit: Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-4 py-3 text-[hsl(var(--muted))]">{blogger.last_used_at || '-'}</td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="danger" size="sm" onClick={() => deleteBlogger.mutate(blogger.id)} disabled={deleteBlogger.isPending}>
                            删除
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!bloggers.length && (
                    <tr><td className="px-4 py-8 text-center text-[hsl(var(--muted))]" colSpan={6}>还没有博主记录；创建任务后会自动记录，也可以手动添加。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="采集条数">
              <Input type="number" min={1} value={form.tweet_limit} onChange={(e) => setForm((prev) => ({ ...prev, tweet_limit: Number(e.target.value) }))} />
            </Field>
            <Field label="X账号">
              <SelectMenu
                value={String(form.account_id)}
                onValueChange={(value) => setForm((prev) => ({ ...prev, account_id: Number(value) }))}
                options={[
                  { value: '0', label: '自动分配可用账号' },
                  ...(usableAccounts || []).map((account: Account) => ({
                    value: String(account.id),
                    label: `${account.label}${account.screen_name ? ` (@${account.screen_name})` : ''}${account.capacity ? ` · ${account.capacity.score}分 · API余${account.capacity.api_remaining_estimate}` : ''}${account.status !== 'active' ? ` · ${statusLabel(account.status)}` : ''}${account.cooldown_until ? ` · 冷却至 ${account.cooldown_until}` : ''}`,
                  })),
                ]}
              />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Check label="推文文本" checked={true} disabled onCheckedChange={() => undefined} />
            <Check label="图片" checked={true} disabled onCheckedChange={() => undefined} />
            <Check label="视频" checked={form.has_video} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, has_video: checked }))} />
          </div>
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
          <CardHeader><h3 className="font-semibold">任务类型</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="任务类型">
              <SelectMenu
                value={form.task_type}
                onValueChange={(value) => setForm((prev) => ({ ...prev, task_type: value as TaskType }))}
                options={[
                  { value: 'user_media', label: '用户媒体' },
                  { value: 'benchmark_account', label: '对标账号' },
                  { value: 'search', label: '搜索/Tag' },
                  { value: 'text', label: '用户文本' },
                  { value: 'replies', label: '评论区' },
                  { value: 'profile', label: '主页资料' },
                ]}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold">账号与代理</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="X账号">
              <SelectMenu
                value={String(form.account_id)}
                onValueChange={(value) => setForm((prev) => ({ ...prev, account_id: Number(value) }))}
                options={[
                  { value: '0', label: '自动分配可用账号' },
                  ...(usableAccounts || []).map((account: Account) => ({
                    value: String(account.id),
                    label: `${account.label}${account.screen_name ? ` (@${account.screen_name})` : ''}${account.capacity ? ` · ${account.capacity.score}分 · API余${account.capacity.api_remaining_estimate}` : ''}${account.status !== 'active' ? ` · ${statusLabel(account.status)}` : ''}${account.cooldown_until ? ` · 冷却至 ${account.cooldown_until}` : ''}`,
                  })),
                ]}
              />
            </Field>
            <Field label="代理模式">
              <SelectMenu
                value={proxyMode}
                onValueChange={(value) => {
                  const nextMode = value as ProxyMode;
                  setProxyMode(nextMode);
                  setForm((prev) => ({
                    ...prev,
                    proxy_id: nextMode === 'pool' ? prev.proxy_id : null,
                    proxy: nextMode === 'manual' ? prev.proxy : '',
                  }));
                }}
                options={[
                  { value: 'auto', label: '自动分配或不使用代理' },
                  { value: 'pool', label: '从代理池选择' },
                  { value: 'manual', label: '手填代理' },
                ]}
              />
            </Field>
            {proxyMode === 'pool' && (
              <Field label="代理池">
                <SelectMenu
                  value={form.proxy_id ? String(form.proxy_id) : ''}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, proxy_id: value ? Number(value) : null }))}
                  options={[
                    { value: '', label: '自动分配可用代理' },
                    ...usableProxies.map((proxy) => ({
                      value: String(proxy.id),
                      label: `${proxy.label}${proxy.cooldown_until ? ` · 冷却至 ${proxy.cooldown_until}` : ''}`,
                    })),
                  ]}
                />
              </Field>
            )}
            {proxyMode === 'manual' && (
              <Field label="手填代理">
                <Input value={form.proxy} onChange={(e) => setForm((prev) => ({ ...prev, proxy: e.target.value }))} placeholder={PROXY_PLACEHOLDER} />
              </Field>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold">媒体与输出</h3></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Check label="包含转推" checked={form.has_retweet} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, has_retweet: checked }))} />
              <Check label="亮点" checked={form.high_lights} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, high_lights: checked }))} />
              <Check label="Likes" checked={form.likes} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, likes: checked }))} />
              <Check label="去重日志" checked={form.down_log} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, down_log: checked }))} />
              <Check label="自动同步" checked={form.auto_sync} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, auto_sync: checked }))} />
              <Check label="输出 Markdown" checked={form.md_output} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, md_output: checked }))} />
            </div>
            <Field label="图片格式">
              <SelectMenu
                value={form.image_format}
                onValueChange={(value) => setForm((prev) => ({ ...prev, image_format: value }))}
                options={[
                  { value: 'orig', label: 'orig' },
                  { value: 'jpg', label: 'jpg' },
                  { value: 'png', label: 'png' },
                ]}
              />
            </Field>
            <Field label="单个 Markdown 媒体数量">
              <Input type="number" value={form.media_count_limit} onChange={(e) => setForm((prev) => ({ ...prev, media_count_limit: Number(e.target.value) }))} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold">用户媒体</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="下载内容">
              <div className="grid gap-3 sm:grid-cols-3">
                <Check label="推文文本" checked={true} disabled onCheckedChange={() => undefined} />
                <Check label="图片" checked={true} disabled onCheckedChange={() => undefined} />
                <Check label="视频" checked={form.has_video} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, has_video: checked }))} />
              </div>
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
  const [resultOffset, setResultOffset] = useState(0);
  const [resultQuery, setResultQuery] = useState('');
  const [resultSearch, setResultSearch] = useState('');
  const [mediaFilter, setMediaFilter] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const resultLimit = 10;
  const { data, isLoading } = useQuery({ queryKey: ['task', id], queryFn: () => api.task(id), refetchInterval: 4000 });
  const { data: resultData, isLoading: resultsLoading, refetch: refetchResults } = useQuery({
    queryKey: ['task-items', id, resultOffset, resultSearch, mediaFilter],
    queryFn: () => api.taskItems(id, { offset: resultOffset, limit: resultLimit, q: resultSearch, has_media: mediaFilter }),
    refetchInterval: 4000,
  });
  const { data: logData } = useQuery({ queryKey: ['operation-logs', 'task', id], queryFn: () => api.operationLogs({ task_id: id, limit: 80 }), refetchInterval: 4000 });
  const task = data?.task;
  const operationLogs = logData?.logs || [];
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
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
  const adaptiveChanges = Array.isArray(task.config?.adaptive_throttle_changes)
    ? task.config.adaptive_throttle_changes as Array<{ field: string; from: unknown; to: unknown; reason: string }>
    : [];
  const adaptivePolicy = task.config?.adaptive_policy as { risk_level?: string; recommended_action?: string } | undefined;
  const adaptiveThrottleApplied = task.config?.adaptive_throttle_applied === true;
  const configCount = Object.keys(task.config || {}).length;
  const logLineCount = task.log?.trim() ? task.log.trim().split(/\r?\n/).length : 0;
  const fileCount = task.files?.length || 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">{displayTaskTitle(task)}</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">#{task.id} · {task.username || '-'} · {task.created_at}</p>
      </div>
      <ActionBar>
        <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['task', id] })}>
          <RefreshCcw className="h-4 w-4" />
          刷新
        </Button>
        {task.status === 'running' && (
          <Button onClick={() => navigate(`/tasks/${id}/live`)}>
            <Eye className="h-4 w-4" />
            实时查看
          </Button>
        )}
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

      {adaptiveThrottleApplied && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
                <h3 className="font-semibold">已自动降载</h3>
              </div>
              <Badge tone={accountCapacityTone(adaptivePolicy?.risk_level)}>
                {riskLevelLabel(adaptivePolicy?.risk_level)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-[hsl(var(--muted))]">{adaptivePolicy?.recommended_action || '系统已按账号风险自动收敛任务配置。'}</div>
            <div className="grid gap-2 md:grid-cols-2">
              {adaptiveChanges.map((change) => (
                <div key={`${change.field}-${String(change.to)}`} className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm">
                  <div className="font-medium">{change.field}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">{String(change.from)} → {String(change.to)}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">{change.reason}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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

      <TaskResultsPanel
        task={task}
        data={resultData}
        isLoading={resultsLoading}
        offset={resultOffset}
        limit={resultLimit}
        query={resultQuery}
        mediaFilter={mediaFilter}
        onQueryChange={setResultQuery}
        onSearch={() => {
          setResultOffset(0);
          setResultSearch(resultQuery.trim());
        }}
        onMediaFilterChange={(value) => {
          setResultOffset(0);
          setMediaFilter(value);
        }}
        onPageChange={setResultOffset}
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ['task', id] });
          refetchResults();
        }}
        fallbackPreview={task.preview}
      />

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
            <h3 className="font-semibold">运维事件</h3>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate(`/operation-logs?task_id=${task.id}`)}>查看全部关联日志</Button>
        </div>
        <OperationLogTable logs={operationLogs} nowMs={nowMs} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <CollapsibleTaskCard title="配置" summary={`${configCount} 项`}>
          <pre className="overflow-auto rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-4 text-xs leading-6 text-[hsl(var(--text))]">{JSON.stringify(task.config || {}, null, 2)}</pre>
        </CollapsibleTaskCard>
        <CollapsibleTaskCard title="日志" summary={logLineCount ? `${logLineCount} 行` : '暂无日志'}>
          <pre className="max-h-[540px] overflow-auto whitespace-pre-wrap rounded-lg border border-[hsl(var(--line))] bg-[#020617] p-4 text-xs leading-6 text-slate-100">{task.log || '还没有日志'}</pre>
        </CollapsibleTaskCard>
      </div>

      <CollapsibleTaskCard title="文件" summary={`${fileCount} 个文件`} contentClassName="p-0">
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
      </CollapsibleTaskCard>
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

function TaskPreviewTable({ preview }: { preview?: TaskPreview }) {
  const rows = preview?.rows || [];

  return (
    <div className="overflow-auto border-t border-[hsl(var(--line))]">
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
  );
}

function mediaStatusTone(status: string): BadgeTone {
  if (status === 'downloaded') return 'success';
  if (status === 'indexed') return 'warning';
  return 'neutral';
}

function mediaStatusLabel(status: string) {
  if (status === 'downloaded') return '已下载';
  if (status === 'indexed') return '仅索引';
  return status || '未知';
}

function mediaIsVideo(media: TaskResultMedia) {
  const text = `${media.media_type} ${media.file_name} ${media.media_url}`.toLowerCase();
  return text.includes('video') || text.includes('.mp4') || text.includes('.mov');
}

function mediaIsImage(media: TaskResultMedia) {
  const text = `${media.media_type} ${media.file_name} ${media.media_url}`.toLowerCase();
  return text.includes('image') || /\.(jpe?g|png|gif|webp)(\?|$)/.test(text);
}

function ResultLink({ href, children }: { href?: string | null; children: React.ReactNode }) {
  if (!href) return <span className="text-[hsl(var(--muted))]">-</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-[hsl(var(--primary-dark))] hover:text-[hsl(var(--text))]">
      <span className="truncate">{children}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

function TaskMediaPreview({ media }: { media: TaskResultMedia }) {
  const canPreview = media.status === 'downloaded' && media.local_url;
  return (
    <div className="overflow-hidden rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))]">
      <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--line))] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {mediaIsVideo(media) ? <Video className="h-4 w-4 shrink-0 text-[hsl(var(--primary-dark))]" /> : <Image className="h-4 w-4 shrink-0 text-[hsl(var(--primary-dark))]" />}
          <span className="truncate text-sm font-semibold">{media.file_name || media.media_type || '媒体'}</span>
        </div>
        <Badge tone={mediaStatusTone(media.status)}>{mediaStatusLabel(media.status)}</Badge>
      </div>
      {canPreview && mediaIsImage(media) && (
        <img src={media.local_url || ''} alt={media.file_name || '采集图片'} loading="lazy" className="aspect-video w-full object-contain bg-black/30" />
      )}
      {canPreview && mediaIsVideo(media) && (
        <video src={media.local_url || ''} controls preload="metadata" className="aspect-video w-full bg-black/40" />
      )}
      {!canPreview && (
        <div className="flex aspect-video items-center justify-center px-3 text-sm text-[hsl(var(--muted))]">
          仅有源链接，暂无本地预览
        </div>
      )}
      <div className="space-y-2 px-3 py-3 text-xs">
        <div className="truncate text-[hsl(var(--muted))]">{formatBytes(media.byte_size || 0)}</div>
        <ResultLink href={media.media_url}>媒体源链接</ResultLink>
      </div>
    </div>
  );
}

function xProfileUrl(screenName?: string | null) {
  const clean = (screenName || '').replace(/^@/, '').trim();
  return clean ? `https://x.com/${encodeURIComponent(clean)}` : '';
}

function xSearchUrl(type: 'mention' | 'tag', value: string) {
  const clean = value.replace(/^[@#]/, '');
  if (type === 'mention') return `https://x.com/${encodeURIComponent(clean)}`;
  return `https://x.com/hashtag/${encodeURIComponent(clean)}`;
}

function LinkedTweetText({ text }: { text?: string | null }) {
  const value = text || '无正文内容';
  const pattern = /(https?:\/\/[^\s]+)|(@[A-Za-z0-9_]{1,32})|(#[-\w\u4e00-\u9fff]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push(value.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('http')) {
      const href = token.replace(/[),.;!?，。！？）]+$/, '');
      const trailing = token.slice(href.length);
      parts.push(
        <a key={`${token}-${match.index}`} href={href} target="_blank" rel="noreferrer" className="break-all text-[hsl(var(--primary-dark))] hover:text-[hsl(var(--text))]">
          {href}
        </a>,
      );
      if (trailing) parts.push(trailing);
    } else if (token.startsWith('@')) {
      parts.push(
        <a key={`${token}-${match.index}`} href={xSearchUrl('mention', token)} target="_blank" rel="noreferrer" className="text-[hsl(var(--primary-dark))] hover:text-[hsl(var(--text))]">
          {token}
        </a>,
      );
    } else {
      parts.push(
        <a key={`${token}-${match.index}`} href={xSearchUrl('tag', token)} target="_blank" rel="noreferrer" className="text-[hsl(var(--primary-dark))] hover:text-[hsl(var(--text))]">
          {token}
        </a>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }
  return <>{parts}</>;
}

function XMediaTile({ media, extraCount = 0 }: { media: TaskResultMedia; extraCount?: number }) {
  const canPreview = media.status === 'downloaded' && media.local_url;
  return (
    <div className="relative min-h-0 overflow-hidden bg-black/30">
      {canPreview && mediaIsImage(media) && (
        <img src={media.local_url || ''} alt={media.file_name || '采集图片'} loading="lazy" className="h-full w-full object-cover" />
      )}
      {canPreview && mediaIsVideo(media) && (
        <video src={media.local_url || ''} controls preload="metadata" className="h-full w-full bg-black/60 object-contain" />
      )}
      {!canPreview && (
        <a href={media.media_url || undefined} target="_blank" rel="noreferrer" className="flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-[hsl(var(--muted))] hover:bg-black/10">
          {mediaIsVideo(media) ? <Video className="h-6 w-6" /> : <Image className="h-6 w-6" />}
          <span>仅有源链接</span>
        </a>
      )}
      {extraCount > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-semibold text-white">
          +{extraCount}
        </div>
      )}
    </div>
  );
}

function XMediaGrid({ media }: { media: TaskResultMedia[] }) {
  if (!media.length) return null;
  const visible = media.slice(0, 4);
  const extra = Math.max(0, media.length - visible.length);
  const gridClass = visible.length === 1
    ? 'grid overflow-hidden rounded-2xl border border-[hsl(var(--line))]'
    : 'grid grid-cols-2 gap-0.5 overflow-hidden rounded-2xl border border-[hsl(var(--line))] bg-[hsl(var(--line))]';
  return (
    <div className={gridClass}>
      {visible.map((item, index) => (
        <div key={item.id} className={visible.length === 1 ? 'aspect-[16/10] max-h-[620px]' : visible.length === 3 && index === 0 ? 'row-span-2 min-h-[240px]' : 'aspect-square'}>
          <XMediaTile media={item} extraCount={index === 3 ? extra : 0} />
        </div>
      ))}
    </div>
  );
}

function XMetric({ icon: Icon, value, label }: { icon: typeof MessageCircle; value: number; label: string }) {
  return (
    <div className="inline-flex min-w-[76px] items-center gap-2 text-[hsl(var(--muted))]">
      <Icon className="h-4 w-4" />
      <span className="tabular-nums">{value || 0}</span>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function XStyleResultCard({ item, expanded, onToggle }: { item: TaskResultItem; expanded: boolean; onToggle: () => void }) {
  const displayName = item.display_name || item.screen_name || '未知作者';
  const screenName = (item.screen_name || '').replace(/^@/, '');
  const initials = (displayName || screenName || '?').slice(0, 1).toUpperCase();
  return (
    <article className="border-t border-[hsl(var(--line))] px-4 py-4 transition-colors hover:bg-[rgba(14,165,233,0.05)]">
      <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-3">
        <a
          href={xProfileUrl(screenName) || undefined}
          target="_blank"
          rel="noreferrer"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--panel-soft))] text-sm font-semibold text-[hsl(var(--text))] ring-1 ring-[hsl(var(--line))]"
          aria-label={screenName ? `打开 @${screenName}` : '作者头像占位'}
        >
          {initials}
        </a>
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <button type="button" onClick={onToggle} className="min-w-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--panel))]" aria-expanded={expanded}>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 max-w-full truncate font-semibold">{displayName}</span>
                {screenName && <span className="text-sm text-[hsl(var(--muted))]">@{screenName}</span>}
                <span className="text-sm text-[hsl(var(--muted))]">·</span>
                <span className="text-sm text-[hsl(var(--muted))]">{item.tweet_date || item.created_at}</span>
              </div>
            </button>
            <ResultLink href={item.tweet_url}>原文</ResultLink>
          </div>
          <button type="button" onClick={onToggle} className="block w-full cursor-pointer whitespace-pre-wrap break-words text-left text-[15px] leading-7 text-[hsl(var(--text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--panel))]">
            <LinkedTweetText text={item.content} />
          </button>
          <XMediaGrid media={item.media} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <XMetric icon={MessageCircle} value={item.reply_count} label="评论" />
              <XMetric icon={Repeat2} value={item.retweet_count} label="转推" />
              <XMetric icon={Heart} value={item.favorite_count} label="点赞" />
            </div>
            <button type="button" onClick={onToggle} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[hsl(var(--line))] px-3 text-sm text-[hsl(var(--muted))] hover:bg-[hsl(var(--panel-soft))]" aria-label={expanded ? '收起采集内容详情' : '展开采集内容详情'}>
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {expanded ? '收起详情' : '查看详情'}
            </button>
          </div>
          {expanded && (
            <div className="space-y-4 rounded-xl border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-4">
              <div className="flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                <span>作者：{displayName}</span>
                <span>用户名：{screenName ? `@${screenName}` : '-'}</span>
                <span>媒体：{item.media.length}</span>
                <span>来源文件：{item.source_file || '-'}</span>
              </div>
              {item.media.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {item.media.map((media) => <TaskMediaPreview key={media.id} media={media} />)}
                </div>
              ) : (
                <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3 py-3 text-sm text-[hsl(var(--muted))]">这条记录没有媒体。</div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function TaskResultRow({ item, expanded, onToggle }: { item: TaskResultItem; expanded: boolean; onToggle: () => void }) {
  const mediaLabel = item.media.length ? `${item.media.length} 个媒体` : '无媒体';
  return (
    <div className="border-t border-[hsl(var(--line))]">
      <div className="grid min-h-[96px] gap-3 px-4 py-4 hover:bg-[rgba(14,165,233,0.06)] md:grid-cols-[minmax(0,1fr)_180px_170px]">
        <button type="button" onClick={onToggle} className="min-w-0 cursor-pointer space-y-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--panel))]" aria-expanded={expanded}>
          <div className="flex min-w-0 items-center gap-2">
            <Badge tone={item.media.length ? 'primary' : 'neutral'}>{mediaLabel}</Badge>
            <span className="shrink-0 text-xs text-[hsl(var(--muted))]">{item.tweet_date || item.created_at}</span>
            <span className="min-w-0 truncate text-xs text-[hsl(var(--muted))]">{item.display_name || '-'} {item.screen_name || ''}</span>
          </div>
          <div className="line-clamp-2 min-h-[48px] break-words text-sm leading-6 text-[hsl(var(--text))]">{item.content || '无正文内容'}</div>
        </button>
        <div className="flex items-center gap-3 text-sm text-[hsl(var(--muted))] md:justify-end">
          <span>{item.favorite_count || 0} 赞</span>
          <span>{item.retweet_count || 0} 转</span>
          <span>{item.reply_count || 0} 评</span>
        </div>
        <div className="flex items-center justify-between gap-2 md:justify-end">
          <ResultLink href={item.tweet_url}>打开原文</ResultLink>
          <button type="button" onClick={onToggle} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[hsl(var(--line))] text-[hsl(var(--muted))] hover:bg-[hsl(var(--panel-soft))]" aria-label={expanded ? '收起采集内容' : '展开采集内容'}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="space-y-4 border-t border-[hsl(var(--line))] bg-[rgba(15,23,42,0.38)] px-4 py-4">
          <div className="whitespace-pre-wrap break-words text-sm leading-7">{item.content || '无正文内容'}</div>
          <div className="flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
            <span>作者：{item.display_name || '-'}</span>
            <span>用户名：{item.screen_name || '-'}</span>
            <span>互动：{item.favorite_count || 0}/{item.retweet_count || 0}/{item.reply_count || 0}</span>
          </div>
          {item.media.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {item.media.map((media) => <TaskMediaPreview key={media.id} media={media} />)}
            </div>
          ) : (
            <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-3 text-sm text-[hsl(var(--muted))]">这条记录没有媒体。</div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskResultsPanel({
  task,
  data,
  isLoading,
  offset,
  limit,
  query,
  mediaFilter,
  onQueryChange,
  onSearch,
  onMediaFilterChange,
  onPageChange,
  onRefresh,
  fallbackPreview,
}: {
  task: Task;
  data?: { total: number; offset: number; limit: number; items: TaskResultItem[] };
  isLoading: boolean;
  offset: number;
  limit: number;
  query: string;
  mediaFilter: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onMediaFilterChange: (value: string) => void;
  onPageChange: (value: number) => void;
  onRefresh: () => void;
  fallbackPreview?: TaskPreview;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'x' | 'list'>('x');
  const items = data?.items || [];
  const total = data?.total || 0;
  const canPrev = offset > 0;
  const canNext = offset + limit < total;
  const showFallback = !items.length && (fallbackPreview?.rows?.length || 0) > 0;
  const running = task.status === 'queued' || task.status === 'running';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
            <h3 className="font-semibold">采集内容</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-9 overflow-hidden rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('x')}
                className={cn('h-8 rounded-md px-3 text-sm transition-colors', viewMode === 'x' ? 'bg-[hsl(var(--primary))] text-white' : 'text-[hsl(var(--muted))] hover:bg-[hsl(var(--panel))]')}
              >
                X风格
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn('h-8 rounded-md px-3 text-sm transition-colors', viewMode === 'list' ? 'bg-[hsl(var(--primary))] text-white' : 'text-[hsl(var(--muted))] hover:bg-[hsl(var(--panel))]')}
              >
                列表
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted))]" />
              <Input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSearch();
                }}
                className="h-9 w-[220px] pl-9"
                placeholder="搜索正文/作者/链接"
              />
            </div>
            <SelectMenu
              value={mediaFilter}
              onValueChange={onMediaFilterChange}
              triggerClassName="h-9 w-[120px]"
              options={[
                { value: '', label: '全部记录' },
                { value: 'true', label: '有媒体' },
                { value: 'false', label: '无媒体' },
              ]}
            />
            <Button variant="secondary" size="sm" onClick={onSearch}>搜索</Button>
            <Button variant="secondary" size="sm" onClick={onRefresh}><RefreshCcw className="h-4 w-4" />刷新</Button>
          </div>
        </div>
        <div className="mt-2 text-xs text-[hsl(var(--muted))]">
          共 {total} 条，当前显示 {items.length} 条
          {running && '；任务运行中时会先显示已索引结果，完成后自动补全'}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && !items.length && <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">正在加载采集内容...</div>}
        {!isLoading && viewMode === 'x' && items.map((item) => (
          <XStyleResultCard key={item.id} item={item} expanded={expandedId === item.id} onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)} />
        ))}
        {!isLoading && viewMode === 'list' && items.map((item) => (
          <TaskResultRow key={item.id} item={item} expanded={expandedId === item.id} onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)} />
        ))}
        {!isLoading && !items.length && showFallback && (
          <div>
            <div className="px-4 py-3 text-sm text-[hsl(var(--muted))]">结构化索引暂未生成，先显示 CSV 预览。</div>
            <TaskPreviewTable preview={fallbackPreview} />
          </div>
        )}
        {!isLoading && !items.length && !showFallback && (
          <div className="px-4 py-10 text-center text-sm text-[hsl(var(--muted))]">暂无采集内容</div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--line))] px-4 py-3">
          <div className="text-xs text-[hsl(var(--muted))]">{total ? `${offset + 1}-${Math.min(offset + limit, total)} / ${total}` : '0 / 0'}</div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={!canPrev} onClick={() => onPageChange(Math.max(0, offset - limit))}>上一页</Button>
            <Button variant="secondary" size="sm" disabled={!canNext} onClick={() => onPageChange(offset + limit)}>下一页</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OperationLogTable({ logs, nowMs, onDelete, deletingId }: { logs: OperationLog[]; nowMs: number; onDelete?: (log: OperationLog) => void; deletingId?: number | null }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-auto">
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
              <tr>
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">级别</th>
                <th className="px-4 py-3">事件</th>
                <th className="px-4 py-3">关联</th>
                <th className="px-4 py-3">消息</th>
                <th className="px-4 py-3">错误类型</th>
                {onDelete && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className={operationLogRowClass(log.level)}>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="font-medium" title={log.created_at}>{relativeTime(log.created_at, nowMs)}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">{log.created_at}</div>
                  </td>
                  <td className="px-4 py-3"><Badge tone={levelTone(log.level)}>{levelLabel(log.level)}</Badge></td>
                  <td className="px-4 py-3 font-medium">{log.event_type}</td>
                  <td className="px-4 py-3 text-[hsl(var(--muted))]">
                    {log.task_id ? <a className="text-[hsl(var(--primary-dark))] hover:text-[hsl(var(--text))]" href={`/tasks/${log.task_id}`}>任务 #{log.task_id}</a> : '-'}
                    {log.schedule_id ? <div>计划 #{log.schedule_id}</div> : null}
                  </td>
                  <td className="max-w-[460px] px-4 py-3">
                    <div className={cn('whitespace-pre-wrap break-words font-medium', operationLogMessageClass(log.level))}>{log.message}</div>
                    {Object.keys(log.details || {}).length > 0 && (
                      <pre className="mt-2 max-h-28 overflow-auto rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-2 text-xs text-[hsl(var(--muted))]">{JSON.stringify(log.details, null, 2)}</pre>
                    )}
                  </td>
                  <td className="px-4 py-3">{log.error_type || '-'}</td>
                  {onDelete && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button variant="danger" size="sm" onClick={() => onDelete(log)} disabled={deletingId === log.id}>
                          {deletingId === log.id ? '删除中...' : '删除'}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!logs.length && (
                <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={onDelete ? 7 : 6}>暂无运维日志</td></tr>
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
  const [bulkBloggersText, setBulkBloggersText] = useState('');
  const [bulkImportMessage, setBulkImportMessage] = useState('');
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
  const bulkAddBloggers = useMutation({
    mutationFn: () => api.bulkAddBloggers({ text: bulkBloggersText, default_tweet_limit: form.tweet_limit }),
    onSuccess: (res) => {
      const importedNames = res.imported.map((blogger) => blogger.screen_name);
      const existing = new Set(
        String(form.targets || '')
          .replace(/,/g, '\n')
          .split('\n')
          .map((item) => item.trim().replace(/^@/, '').toLowerCase())
          .filter(Boolean),
      );
      const nextNames = importedNames.filter((name) => !existing.has(name.toLowerCase()));
      if (nextNames.length) {
        setForm((prev) => ({
          ...prev,
          targets: [prev.targets.trim(), ...nextNames].filter(Boolean).join('\n'),
        }));
      }
      setBulkImportMessage(`已导入 ${res.imported.length} 个，重复 ${res.duplicates.length} 个，跳过 ${res.skipped.length} 个。`);
      setBulkBloggersText('');
      queryClient.invalidateQueries({ queryKey: ['bloggers'] });
    },
    onError: (err: Error) => setBulkImportMessage(err.message),
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
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
            <Field label="计划名称"><Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} /></Field>
            <Field label="X账号">
              <SelectMenu
                value={String(form.account_id)}
                onValueChange={(value) => setForm((prev) => ({ ...prev, account_id: Number(value) }))}
                options={[
                  { value: '0', label: '自动分配可用账号' },
                  ...usableAccounts.map((account) => ({
                    value: String(account.id),
                    label: `${account.label}${account.screen_name ? ` (@${account.screen_name})` : ''}${account.capacity ? ` · ${account.capacity.score}分 · API余${account.capacity.api_remaining_estimate}` : ''}`,
                  })),
                ]}
              />
            </Field>
            <Field label="采集类型">
              <SelectMenu
                value={form.task_type}
                onValueChange={(value) => setForm((prev) => ({ ...prev, task_type: value as ScheduleFormValues['task_type'] }))}
                options={[
                  { value: 'benchmark_account', label: '账号近况' },
                  { value: 'user_media', label: '用户媒体' },
                ]}
              />
            </Field>
          </div>
          <Field label="目标博主 / 博主列表">
            <Textarea rows={3} value={form.targets} onChange={(e) => setForm((prev) => ({ ...prev, targets: e.target.value }))} placeholder="每行一个用户名或主页链接" />
          </Field>
          <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <Field label="批量导入博主">
                <Textarea
                  rows={3}
                  value={bulkBloggersText}
                  onChange={(e) => setBulkBloggersText(e.target.value)}
                  placeholder="@username、username 或 https://x.com/username，每行一个"
                  className="min-h-24"
                />
              </Field>
              <Button onClick={() => bulkAddBloggers.mutate()} disabled={bulkAddBloggers.isPending || !bulkBloggersText.trim()}>
                <Plus className="h-4 w-4" />
                导入到博主列表
              </Button>
            </div>
            {bulkImportMessage && <div className="mt-2 text-xs text-[hsl(var(--muted))]">{bulkImportMessage}</div>}
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
            <Field label="执行周期">
              <SelectMenu
                value={form.schedule_type}
                onValueChange={(value) => setForm((prev) => ({ ...prev, schedule_type: value as ScheduleFormValues['schedule_type'] }))}
                options={[
                  { value: 'daily', label: '每日' },
                  { value: 'weekly', label: '每周' },
                ]}
              />
            </Field>
            <Field label="执行时间"><Input type="time" value={form.run_time} onChange={(e) => setForm((prev) => ({ ...prev, run_time: e.target.value }))} /></Field>
            <Field label="采集条数"><Input type="number" min={1} value={form.tweet_limit} onChange={(e) => setForm((prev) => ({ ...prev, tweet_limit: Number(e.target.value) }))} /></Field>
          </div>
          {form.schedule_type === 'weekly' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
              {WEEKDAYS.map((day) => <Check key={day.value} label={day.label} checked={form.weekdays.includes(day.value)} onCheckedChange={() => toggleWeekday(day.value)} />)}
            </div>
          )}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
            <Check label="下载视频" checked={form.has_video} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, has_video: checked }))} />
            <Check label="去重日志" checked={form.down_log} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, down_log: checked }))} />
            <Check label="输出 Markdown" checked={form.md_output} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, md_output: checked }))} />
            <Check label="新内容监控" checked={form.monitor_new_content} onCheckedChange={(checked) => setForm((prev) => ({ ...prev, monitor_new_content: checked }))} />
          </div>
          {form.monitor_new_content && (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
              <Field label="监控间隔（分钟）">
                <Input type="number" min={5} value={form.monitor_interval_minutes} onChange={(e) => setForm((prev) => ({ ...prev, monitor_interval_minutes: Math.max(5, Number(e.target.value) || 15), first_run_policy: 'baseline' }))} />
              </Field>
              <div className="rounded-lg border border-[hsl(var(--line))] bg-[rgba(14,165,233,0.08)] px-3 py-2 text-sm text-[hsl(var(--muted))]">
                首次监控只建立基线；之后只有发现新内容才自动生成采集任务。
              </div>
            </div>
          )}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))]">
            <Field label="代理池">
              <SelectMenu
                value={form.proxy_id ? String(form.proxy_id) : ''}
                onValueChange={(value) => setForm((prev) => ({ ...prev, proxy_id: value ? Number(value) : null }))}
                options={[
                  { value: '', label: '不使用代理池' },
                  ...usableProxies.map((proxy) => ({ value: String(proxy.id), label: proxy.label })),
                ]}
              />
            </Field>
            <Field label="时间范围"><Input value={form.time_range} onChange={(e) => setForm((prev) => ({ ...prev, time_range: e.target.value }))} /></Field>
          </div>
          <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm text-[hsl(var(--muted))]">
            服务器时区：{form.timezone || 'local'} · 错过执行默认跳过 · 连续失败 3 次自动停用
          </div>
          {health?.resource_policy && (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
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
                    <td className="px-4 py-3">
                      {schedule.config.monitor_new_content ? (
                        <div>
                          <Badge tone="primary">监控</Badge>
                          <div className="mt-1 text-xs text-[hsl(var(--muted))]">每 {String(schedule.config.monitor_interval_minutes || 15)} 分钟检查</div>
                        </div>
                      ) : (
                        <span>{schedule.schedule_type === 'daily' ? '每日' : `每周 ${schedule.weekdays.map((day) => WEEKDAYS.find((item) => item.value === day)?.label).join(' ')}`} · {schedule.run_time}</span>
                      )}
                    </td>
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
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [level, setLevel] = useState('');
  const [eventType, setEventType] = useState('');
  const [errorType, setErrorType] = useState('');
  const [query, setQuery] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [offset, setOffset] = useState(0);
  const limit = 100;
  const taskId = Number(searchParams.get('task_id') || 0) || undefined;
  const scheduleId = Number(searchParams.get('schedule_id') || 0) || undefined;
  const filters = {
    task_id: taskId,
    schedule_id: scheduleId,
    level: level || undefined,
    event_type: eventType || undefined,
    error_type: errorType || undefined,
    q: query || undefined,
    start_at: startAt ? `${startAt} 00:00:00` : undefined,
    end_at: endAt ? `${endAt} 23:59:59` : undefined,
  };
  const params = {
    ...filters,
    offset,
    limit,
  };
  const { data, refetch } = useQuery({ queryKey: ['operation-logs', params], queryFn: () => api.operationLogs(params), refetchInterval: 5000 });
  const logs = data?.logs || [];
  const total = data?.total || 0;
  const canPrev = offset > 0;
  const canNext = offset + limit < total;
  const resetPage = () => setOffset(0);
  const hasFilter = Boolean(taskId || scheduleId || level || eventType || errorType || query || startAt || endAt);
  const deleteLog = useMutation({
    mutationFn: (id: number) => api.deleteOperationLog(id),
    onSuccess: async () => {
      setError('');
      setMessage('日志已删除');
      if (logs.length === 1 && offset > 0) {
        setOffset(Math.max(0, offset - limit));
      }
      await queryClient.invalidateQueries({ queryKey: ['operation-logs'] });
    },
    onError: (err: Error) => {
      setMessage('');
      setError(err.message);
    },
  });
  const deleteFilteredLogs = useMutation({
    mutationFn: () => api.deleteOperationLogs(filters),
    onSuccess: async (res) => {
      setError('');
      setMessage(`已删除 ${res.deleted} 条运维日志`);
      setOffset(0);
      await queryClient.invalidateQueries({ queryKey: ['operation-logs'] });
    },
    onError: (err: Error) => {
      setMessage('');
      setError(err.message);
    },
  });
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const handleDeleteLog = (log: OperationLog) => {
    if (window.confirm(`确定删除这条运维日志吗？\n#${log.id} · ${levelLabel(log.level)} · ${log.event_type}`)) {
      deleteLog.mutate(log.id);
    }
  };
  const handleDeleteFilteredLogs = () => {
    const scope = hasFilter ? '当前筛选结果' : '全部运维日志';
    if (window.confirm(`确定删除${scope}吗？此操作不可恢复。`)) {
      deleteFilteredLogs.mutate();
    }
  };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">运维日志</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">记录任务创建、调度、执行、失败分类和重试事件。{taskId ? `当前筛选任务 #${taskId}` : ''}{scheduleId ? `当前筛选计划 #${scheduleId}` : ''}</p>
      </div>
      {error && <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-sm text-[hsl(var(--danger))]">{error}</div>}
      {message && <div className="rounded-lg border border-[hsl(var(--success))] bg-[rgba(34,197,94,0.12)] px-3 py-2 text-sm text-[hsl(var(--success))]">{message}</div>}
      <ActionBar>
        <SelectMenu
          value={level}
          onValueChange={(value) => setLevel(value)}
          triggerClassName="w-[132px]"
          options={[
            { value: '', label: '全部级别' },
            { value: 'info', label: '信息' },
            { value: 'warning', label: '警告' },
            { value: 'error', label: '错误' },
          ]}
        />
        <Input className="w-40" placeholder="事件类型" value={eventType} onChange={(e) => { setEventType(e.target.value); resetPage(); }} />
        <Input className="w-40" placeholder="错误类型" value={errorType} onChange={(e) => { setErrorType(e.target.value); resetPage(); }} />
        <Input className="w-48" placeholder="关键词" value={query} onChange={(e) => { setQuery(e.target.value); resetPage(); }} />
        <Input className="w-40" type="date" value={startAt} onChange={(e) => { setStartAt(e.target.value); resetPage(); }} />
        <Input className="w-40" type="date" value={endAt} onChange={(e) => { setEndAt(e.target.value); resetPage(); }} />
        <Button variant="secondary" onClick={() => { setLevel(''); setEventType(''); setErrorType(''); setQuery(''); setStartAt(''); setEndAt(''); setOffset(0); }}>清空筛选</Button>
        <Button variant="secondary" onClick={() => refetch()}><RefreshCcw className="h-4 w-4" />刷新</Button>
        <Button variant="danger" onClick={handleDeleteFilteredLogs} disabled={deleteFilteredLogs.isPending || !total}>
          {deleteFilteredLogs.isPending ? '删除中...' : hasFilter ? '删除筛选结果' : '删除全部日志'}
        </Button>
      </ActionBar>
      <OperationLogTable logs={logs} nowMs={nowMs} onDelete={handleDeleteLog} deletingId={deleteLog.variables ?? null} />
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
  const testFormConnection = useMutation({
    mutationFn: () => api.testResultDbConnection(form),
    onSuccess: (res) => {
      setError(res.ok ? '' : res.error);
      setMessage(res.ok ? '连接测试通过' : '');
    },
    onError: (err: Error) => {
      setMessage('');
      setError(err.message);
    },
  });
  const testConfig = useMutation({
    mutationFn: (id: number) => api.testResultDb(id),
    onSuccess: (res) => {
      setError(res.ok ? '' : res.error);
      setMessage(res.ok ? '连接测试通过' : '');
      queryClient.invalidateQueries({ queryKey: ['result-db'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => {
      setMessage('');
      setError(err.message);
    },
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
  const canTestFormConnection = Boolean(form.host && form.database_name && form.username);

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
              <SelectMenu
                value={form.db_type}
                onValueChange={(value) => updateDbType(value as ResultDbFormValues['db_type'])}
                options={[
                  { value: 'postgresql', label: 'PostgreSQL' },
                  { value: 'mysql', label: 'MySQL' },
                ]}
              />
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
            <Button variant="secondary" onClick={() => testFormConnection.mutate()} disabled={testFormConnection.isPending || !canTestFormConnection}>
              {testFormConnection.isPending ? '测试中...' : '测试连接'}
            </Button>
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
  const { data: proxiesData } = useQuery({ queryKey: ['proxies'], queryFn: () => api.proxies(), refetchInterval: 8000 });
  const { data: warmupData } = useQuery({ queryKey: ['account-warmup-status'], queryFn: () => api.accountWarmupStatus(), refetchInterval: 2500 });
  const accounts = data?.accounts || [];
  const proxies = proxiesData?.proxies || [];
  const proxyOptions = proxies.filter((proxy) => proxy.enabled);
  const activeWarmup = warmupData?.active;
  const capacityAccounts = accounts.filter((account) => account.capacity);
  const averageCapacity = capacityAccounts.length
    ? Math.round(capacityAccounts.reduce((sum, account) => sum + (account.capacity?.score || 0), 0) / capacityAccounts.length)
    : 0;
  const lowCapacityCount = accounts.filter((account) => (account.capacity?.score ?? 100) < 50).length;
  const [form, setForm] = useState({ label: '', auth_token: '', ct0: '' });
  const [bitBrowserForm, setBitBrowserForm] = useState({ base_url: 'http://127.0.0.1:54345', browser_ids: '' });
  const [bitBrowserResults, setBitBrowserResults] = useState<BitBrowserImportResult[]>([]);
  const [error, setError] = useState('');
  const [browserLoginOpen, setBrowserLoginOpen] = useState(false);
  const [browserLoginToken, setBrowserLoginToken] = useState('');
  const [browserLoginCallbackUrl, setBrowserLoginCallbackUrl] = useState('');
  const [browserLoginExpiresIn, setBrowserLoginExpiresIn] = useState(0);
  const [browserLoginStatus, setBrowserLoginStatus] = useState('');
  const [browserLoginMessage, setBrowserLoginMessage] = useState('');
  const [browserLoginLabel, setBrowserLoginLabel] = useState('');
  const [browserLoginProxyId, setBrowserLoginProxyId] = useState<number | null>(null);
  const [loginQueueText, setLoginQueueText] = useState('');
  const [loginQueuePreview, setLoginQueuePreview] = useState<LoginQueueParseResponse | null>(null);
  const [queueHelperError, setQueueHelperError] = useState('');
  const [expandedAccountId, setExpandedAccountId] = useState<number | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [editingAccountLabel, setEditingAccountLabel] = useState('');
  const [editingAccountProxyId, setEditingAccountProxyId] = useState<number | null>(null);
  const startedQueueTokenRef = useRef('');
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
  const openLocalHelperWindow = async (payload: { token: string; callback_url?: string; expires_in: number }) => {
    const response = await fetch('http://127.0.0.1:18765/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: payload.token,
        callback_url: payload.callback_url,
        expires_in: payload.expires_in,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message || '这台电脑未检测到本地授权助手。');
    }
    return body;
  };
  const openLocalHelperWithFallback = async (session: { token: string; callback_url?: string; expires_in: number }) => {
    try {
      const body = await openLocalHelperWindow(session);
      return {
        status: 'running',
        message: body.message || '已打开这台电脑的 Chrome，请在弹出的窗口完成 X 登录；Cookie 会自动回传到 VPS。',
      };
    } catch (firstErr) {
      setBrowserLoginMessage('未检测到已运行的本地授权助手，正在判断是否可由本机后端自动启动...');
      let helper: LocalBrowserLoginHelperStatus | null = null;
      try {
        helper = await api.ensureLocalBrowserLoginHelper({ wait_seconds: 3 });
      } catch {
        helper = null;
      }
      if (helper?.ok || helper?.status === 'ready' || helper?.status === 'starting') {
        const delay = helperRetryDelay(helper);
        setBrowserLoginMessage(helper?.status === 'ready' ? '本机授权助手已自动启动，正在打开 Chrome...' : '正在启动本机授权助手，通常几秒内完成...');
        for (let attempt = 0; attempt < 8; attempt += 1) {
          if (attempt > 0 || helper?.status === 'starting') {
            await wait(delay);
          }
          try {
            const body = await openLocalHelperWindow(session);
            return {
              status: 'running',
              message: body.message || '已自动启动本机授权助手并打开 Chrome，请在弹出的窗口完成 X 登录；Cookie 会自动回传到 VPS。',
            };
          } catch {
            setBrowserLoginMessage(`正在启动本机授权助手，通常几秒内完成...（${attempt + 1}/8）`);
          }
        }
        throw new Error(helper.message || '本机授权助手自动启动后仍未响应。请稍后重试，或手动运行 start_local_login_helper.bat。');
      }
      if (helper && helperCanAutoStartOnBackend(helper)) {
        return {
          status: 'helper_missing',
          message: helper.message || '本机授权助手自动启动失败。可重试自动启动，或手动运行 start_local_login_helper.bat。',
        };
      }
      setBrowserLoginMessage('当前后端不能直接启动这台电脑的助手，正在尝试通过本机协议唤起...');
      window.location.href = 'tw-login-helper://start';
      await wait(1200);
      try {
        const body = await openLocalHelperWindow(session);
        return {
          status: 'running',
          message: body.message || '已自动唤起本地助手并打开 Chrome，请在弹出的窗口完成 X 登录；Cookie 会自动回传到 VPS。',
        };
      } catch (secondErr) {
        const message = localHelperErrorMessage(secondErr instanceof Error ? secondErr : firstErr, 'remote');
        return {
          status: 'helper_missing',
          message: `${message} VPS 授权任务仍在等待。`,
        };
      }
    }
  };
  const browserLogin = useMutation({
    mutationFn: async () => {
      setBrowserLoginOpen(true);
      setBrowserLoginToken('');
      setBrowserLoginStatus('pending');
      setBrowserLoginMessage('正在向 VPS 创建授权任务...');
      const session = await api.localBrowserLoginStart({ label: browserLoginLabel.trim(), bound_proxy_id: browserLoginProxyId });
      setBrowserLoginToken(session.token);
      setBrowserLoginCallbackUrl(session.callback_url || '');
      setBrowserLoginExpiresIn(session.expires_in);
      setBrowserLoginStatus('helper_starting');
      setBrowserLoginMessage('授权任务已在 VPS 创建，正在自动连接这台电脑上的本地授权助手...');
      const result = await openLocalHelperWithFallback(session);
      return { ...session, ...result };
    },
    onSuccess: (res) => {
      setError('');
      setBrowserLoginOpen(true);
      setBrowserLoginToken(res.token);
      setBrowserLoginCallbackUrl(res.callback_url || '');
      setBrowserLoginExpiresIn(res.expires_in);
      setBrowserLoginStatus(res.status);
      setBrowserLoginMessage(res.message);
      if (res.status === 'running') {
        setBrowserLoginLabel('');
        setBrowserLoginProxyId(null);
      }
    },
    onError: (err: Error) => setError(err.message),
  });
  const browserLoginStatusQuery = useQuery({
    queryKey: ['local-browser-login-status', browserLoginToken],
    queryFn: () => api.localBrowserLoginStatus(browserLoginToken),
    enabled: browserLoginOpen && Boolean(browserLoginToken) && !['helper_missing', 'helper_starting', 'completed', 'failed', 'expired', 'cancelled'].includes(browserLoginStatus),
    refetchInterval: browserLoginOpen ? 2500 : false,
  });
  const cancelBrowserLogin = useMutation({
    mutationFn: () => (browserLoginToken ? api.localBrowserLoginCancel(browserLoginToken) : Promise.resolve({ ok: true })),
    onSuccess: () => {
      setBrowserLoginOpen(false);
      setBrowserLoginToken('');
      setBrowserLoginCallbackUrl('');
      setBrowserLoginExpiresIn(0);
      setBrowserLoginStatus('');
      setBrowserLoginMessage('');
    },
    onError: (err: Error) => setError(err.message),
  });
  const loginQueueQuery = useQuery({
    queryKey: ['login-queue'],
    queryFn: () => api.loginQueueStatus(),
    refetchInterval: 2500,
  });
  const parseLoginQueue = useMutation({
    mutationFn: () => api.parseLoginQueueText({ text: loginQueueText }),
    onSuccess: (res) => {
      setError('');
      setLoginQueuePreview(res);
    },
    onError: (err: Error) => setError(err.message),
  });
  const createLoginQueue = useMutation({
    mutationFn: () => api.createLoginQueue({ labels: (loginQueuePreview?.items || []).map((item) => item.label) }),
    onSuccess: () => {
      setError('');
      setQueueHelperError('');
      setLoginQueueText('');
      setLoginQueuePreview(null);
      queryClient.invalidateQueries({ queryKey: ['login-queue'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const skipLoginQueueItem = useMutation({
    mutationFn: (id: number) => api.skipLoginQueueItem(id),
    onSuccess: () => {
      setQueueHelperError('');
      queryClient.invalidateQueries({ queryKey: ['login-queue'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const retryLoginQueueItem = useMutation({
    mutationFn: (id: number) => api.retryLoginQueueItem(id),
    onSuccess: () => {
      setQueueHelperError('');
      queryClient.invalidateQueries({ queryKey: ['login-queue'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const startLoginQueueHelper = (active: LoginQueueItem) => {
    if (!active.token || LOGIN_QUEUE_TERMINAL_STATUSES.has(active.status)) return;
    startedQueueTokenRef.current = active.token;
    setQueueHelperError('');
    openLocalHelperWindow({
        token: active.token,
        callback_url: loginQueueQuery.data?.callback_url,
        expires_in: active.expires_in,
    }).catch((err: Error) => setQueueHelperError(
      localHelperErrorMessage(err) || '这台电脑上的本地登录助手没有响应；请先启动助手，再重试当前队列项。'
    ));
  };
  const checkAccount = useMutation({
    mutationFn: (id: number) => api.checkAccount(id),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const warmupAccount = useMutation({
    mutationFn: (id: number) => api.warmupAccount(id),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['account-warmup-status'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const warmupAccounts = useMutation({
    mutationFn: () => api.warmupAccounts(),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['account-warmup-status'] });
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
  const updateAccount = useMutation({
    mutationFn: ({ id, label, bound_proxy_id }: { id: number; label: string; bound_proxy_id: number | null }) => api.updateAccount(id, { label, bound_proxy_id }),
    onSuccess: () => {
      setError('');
      setEditingAccountId(null);
      setEditingAccountLabel('');
      setEditingAccountProxyId(null);
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
      setBrowserLoginLabel('');
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  }, [browserLoginStatusQuery.data, queryClient]);

  useEffect(() => {
    const active = loginQueueQuery.data?.active;
    if (!active?.token || LOGIN_QUEUE_TERMINAL_STATUSES.has(active.status)) return;
    if (startedQueueTokenRef.current === active.token) return;
    startLoginQueueHelper(active);
  }, [loginQueueQuery.data?.active?.token, loginQueueQuery.data?.active?.status, loginQueueQuery.data?.active?.expires_in, loginQueueQuery.data?.callback_url]);

  const browserLoginTone = browserLoginStatus === 'completed'
    ? 'success'
    : ['failed', 'expired', 'helper_missing'].includes(browserLoginStatus)
      ? 'danger'
      : 'primary';
  const browserLoginStatusText = {
    pending: '等待助手',
    running: '等待登录',
    helper_missing: '助手未就绪',
    helper_starting: '助手启动中',
    completed: '已完成',
    failed: '失败',
    expired: '已超时',
    cancelled: '已取消',
  }[browserLoginStatus] || 'starting';
  const loginQueueItems = loginQueueQuery.data?.items || [];
  const activeQueueItem = loginQueueQuery.data?.active;
  const pendingQueueCount = loginQueueItems.filter((item) => item.status === 'pending').length;
  const completedQueueCount = loginQueueItems.filter((item) => item.status === 'completed').length;
  const failedQueueCount = loginQueueItems.filter((item) => ['failed', 'expired', 'cancelled'].includes(item.status)).length;
  const warmupRunning = Boolean(activeWarmup);
  const warmupProgress = activeWarmup?.progress ?? 0;
  const warmupTargetCount = accounts.filter((account) => account.tier === 'new' || (account.capacity?.score ?? 100) < 70 || (account.tier !== 'stable' && (account.warmup_success_streak || 0) < 3)).length;

  const retryLocalHelper = async () => {
    if (!browserLoginToken || !browserLoginCallbackUrl) {
      browserLogin.mutate();
      return;
    }
    setBrowserLoginStatus('helper_starting');
    setBrowserLoginMessage('正在自动连接这台电脑上的本地授权助手...');
    try {
      const result = await openLocalHelperWithFallback({
        token: browserLoginToken,
        callback_url: browserLoginCallbackUrl,
        expires_in: browserLoginExpiresIn,
      });
      setBrowserLoginStatus(result.status);
      setBrowserLoginMessage(result.message);
    } catch (err) {
      setBrowserLoginStatus('helper_missing');
      setBrowserLoginMessage(`${localHelperErrorMessage(err, 'local')} VPS 授权任务仍在等待。`);
    }
  };
  const startOneClickLocalLogin = () => {
    if (browserLoginToken && browserLoginCallbackUrl && ['helper_missing', 'pending'].includes(browserLoginStatus)) {
      retryLocalHelper();
      return;
    }
    browserLogin.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold">X 账号池</h2>
        <p className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-[hsl(var(--muted))]">维护会话，任务从这里选账号。</p>
      </div>
      <ActionBar>
        <Input
          value={browserLoginLabel}
          onChange={(event) => setBrowserLoginLabel(event.target.value)}
          className="w-full sm:w-[260px]"
          placeholder="登录账号备注"
          maxLength={80}
        />
        <SelectMenu
          value={browserLoginProxyId ? String(browserLoginProxyId) : ''}
          onValueChange={(value) => setBrowserLoginProxyId(value ? Number(value) : null)}
          triggerClassName="w-full sm:w-[260px]"
          options={[
            { value: '', label: '授权后不绑定代理' },
            ...proxyOptions.map((proxy) => ({
              value: String(proxy.id),
              label: `${proxy.label} · ${proxy.detected_ip || proxyStatusLabel(proxy)}`,
            })),
          ]}
        />
        <Button onClick={startOneClickLocalLogin} disabled={browserLogin.isPending || browserLoginStatus === 'running' || browserLoginStatus === 'helper_starting'}>
          <CircleUserRound className="h-4 w-4" />
          开始本地授权
        </Button>
      </ActionBar>
      {error && <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(248,113,113,0.12)] px-3 py-2 text-sm text-[hsl(var(--danger))]">{error}</div>}
      {browserLoginOpen && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">本地授权登录</h3>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">{browserLoginMessage || 'VPS 创建授权任务，这台电脑打开 Chrome 登录，Cookie 自动回传 VPS。'}</p>
              </div>
              <Badge tone={browserLoginTone as BadgeTone}>
                {browserLoginStatusText}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {browserLoginStatus === 'helper_missing' ? (
              <div className="space-y-3 rounded-lg border border-[hsl(var(--warning))] bg-[rgba(251,191,36,0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]">
                <div className="font-semibold">{helperIsLocalBackendFailure(browserLoginMessage) ? '本机授权助手自动启动失败' : '这台电脑未检测到本地授权助手'}</div>
                <div>{browserLoginMessage || '首次使用需要运行一次安装器；安装后以后点击“开始本地授权”即可自动打开 Chrome。'}</div>
                {helperIsLocalBackendFailure(browserLoginMessage) ? (
                  <div className="rounded-md border border-[rgba(251,191,36,0.28)] bg-[rgba(15,23,42,0.38)] px-3 py-2">
                    当前是本机 Windows 后端，会优先重试自动启动；仍失败时再手动运行 start_local_login_helper.bat。
                  </div>
                ) : (
                  <div className="rounded-md border border-[rgba(251,191,36,0.28)] bg-[rgba(15,23,42,0.38)] px-3 py-2">
                    安装器会注册本机授权助手和自动唤起协议；之后不需要重复下载。
                  </div>
                )}
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
                {browserLoginStatus === 'helper_starting' ? '正在连接这台电脑上的本地登录助手；就绪后会直接弹出 Chrome 登录窗口。' : 'VPS 已创建授权任务；请在这台电脑弹出的 Chrome 窗口里完成 X 登录，Cookie 会自动回传并保存到 VPS。'}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {browserLoginStatus === 'helper_missing' && (
                <>
                  {!helperIsLocalBackendFailure(browserLoginMessage) && (
                    <Button variant="secondary" size="sm" type="button" onClick={() => { window.location.href = '/api/accounts/local-browser-login/helper/install'; }}>
                      首次使用：安装本地授权助手
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={retryLocalHelper} disabled={browserLogin.isPending}>
                    {helperIsLocalBackendFailure(browserLoginMessage) ? '重试自动启动' : '安装完成，继续授权'}
                  </Button>
                </>
              )}
              {browserLoginToken && browserLoginStatus !== 'helper_missing' && browserLoginStatus !== 'helper_starting' && browserLoginStatus !== 'completed' && (
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
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">批量本地授权队列</h3>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">VPS 逐个派发授权任务，这台电脑逐个打开 Chrome；密码、邮箱验证和 2FA 由你在本地窗口完成。</p>
            </div>
            {activeQueueItem ? (
              <Badge tone="primary">正在处理 #{activeQueueItem.id}</Badge>
            ) : (
              <Badge tone="neutral">队列空闲</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Field label="用户名 / 备注">
              <Textarea
                rows={5}
                value={loginQueueText}
                onChange={(e) => {
                  setLoginQueueText(e.target.value);
                  setLoginQueuePreview(null);
                }}
                placeholder="可粘贴原始账号文本；系统只提取用户名，密码、邮箱、Cookie、2FA 链接会被丢弃"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <InfoCard title="等待登录" value={String(pendingQueueCount)} />
              <InfoCard title="已保存" value={String(completedQueueCount)} />
              <InfoCard title="需处理" value={String(failedQueueCount)} />
            </div>
          </div>
          {queueHelperError && (
            <div className="rounded-lg border border-[hsl(var(--warning))] bg-[rgba(251,191,36,0.12)] px-4 py-3 text-sm text-[hsl(var(--text))]">
              {queueHelperError}
            </div>
          )}
          {loginQueuePreview && (
            <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <InfoCard title="将加入" value={String(loginQueuePreview.items.length)} />
                <InfoCard title="重复项" value={String(loginQueuePreview.duplicates.length)} />
                <InfoCard title="已跳过" value={String(loginQueuePreview.skipped.length)} />
                <InfoCard title="已移除敏感字段" value={String(loginQueuePreview.sensitive_fields_removed)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {loginQueuePreview.items.map((item) => (
                  <Badge key={item.label} tone="primary">{item.label}</Badge>
                ))}
                {!loginQueuePreview.items.length && (
                  <span className="text-sm text-[hsl(var(--muted))]">没有识别到可加入队列的用户名。</span>
                )}
              </div>
              {(loginQueuePreview.duplicates.length > 0 || loginQueuePreview.skipped.length > 0) && (
                <div className="mt-3 text-xs text-[hsl(var(--muted))]">
                  重复用户名不会重复加入；无法识别的片段已跳过，敏感内容不会回显。
                </div>
              )}
            </div>
          )}
          {activeQueueItem && (
            <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">当前：{activeQueueItem.label}</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                    {activeQueueItem.message || '等待你在这台电脑的 Chrome 窗口完成登录'} · 剩余 {activeQueueItem.expires_in}s
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => startLoginQueueHelper(activeQueueItem)}>
                    <RefreshCcw className="h-4 w-4" />
                    重开窗口
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => loginQueueQuery.refetch()}>
                    刷新状态
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => skipLoginQueueItem.mutate(activeQueueItem.id)} disabled={skipLoginQueueItem.isPending}>
                    跳过
                  </Button>
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => parseLoginQueue.mutate()} disabled={parseLoginQueue.isPending || !loginQueueText.trim()}>
              <Search className="h-4 w-4" />
              解析预览
            </Button>
            <Button onClick={() => createLoginQueue.mutate()} disabled={createLoginQueue.isPending || !loginQueuePreview?.items.length}>
              <CircleUserRound className="h-4 w-4" />
              确认加入队列
            </Button>
          </div>
          <div className="overflow-auto rounded-lg border border-[hsl(var(--line))]">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr>
                  <th className="px-4 py-3">队列</th>
                  <th className="px-4 py-3">用户名 / 备注</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">结果</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {loginQueueItems.map((item) => (
                  <tr key={item.id} className="border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]">
                    <td className="px-4 py-3">#{item.id}</td>
                    <td className="px-4 py-3 font-medium">{item.label}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                    </td>
                    <td className="max-w-[360px] px-4 py-3 text-[hsl(var(--muted))]">
                      <div className="truncate">{item.screen_name ? `@${item.screen_name}` : item.message || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {['failed', 'expired', 'cancelled', 'skipped'].includes(item.status) && (
                          <Button variant="secondary" size="sm" onClick={() => retryLoginQueueItem.mutate(item.id)} disabled={retryLoginQueueItem.isPending}>
                            重试
                          </Button>
                        )}
                        {['pending', 'running'].includes(item.status) && (
                          <Button variant="danger" size="sm" onClick={() => skipLoginQueueItem.mutate(item.id)} disabled={skipLoginQueueItem.isPending}>
                            跳过
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loginQueueItems.length && (
                  <tr><td className="px-4 py-8 text-center text-[hsl(var(--muted))]" colSpan={5}>还没有登录队列</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard title="可分配账号" value={String(accounts.filter((account) => USABLE_ACCOUNT_STATUSES.has(account.status)).length)} />
        <InfoCard title="平均调度分" value={capacityAccounts.length ? String(averageCapacity) : '-'} />
        <InfoCard title="低分账号" value={String(lowCapacityCount)} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard title="可尝试未确认账号" value={String(accounts.filter((account) => account.status === 'unknown' || account.status === 'check_failed').length)} />
        <InfoCard title="已绑定代理" value={String(accounts.filter((account) => account.bound_proxy_id).length)} />
        <InfoCard title="估算剩余 API" value={String(accounts.reduce((sum, account) => sum + (account.capacity?.api_remaining_estimate || 0), 0))} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <div className="min-w-0">
            <div className="font-semibold">账号养护 / 健康保护</div>
            <div className="mt-1 max-w-[780px] truncate text-xs text-[hsl(var(--muted))]">
              一键养护只做代理、Cookie、额度和冷却检测；连续 3 次健康后自动进入稳定层级，不做自动互动。
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="primary">健康保护</Badge>
            <Badge tone="warning">新号低频</Badge>
            <Badge tone="neutral">无自动互动</Badge>
            <Button variant="secondary" size="sm" onClick={() => warmupAccounts.mutate()} disabled={warmupRunning || warmupAccounts.isPending || warmupTargetCount === 0}>
              <ShieldCheck className="h-4 w-4" />
              一键养护新号
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeWarmup && (
        <Card>
          <CardContent className="space-y-2 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">账号养护进行中</div>
                <div className="mt-1 max-w-[760px] truncate text-xs text-[hsl(var(--muted))]">
                  {activeWarmup.message || '正在执行安全养护'} · {activeWarmup.done}/{activeWarmup.total} · 成功 {activeWarmup.ok} · 需关注 {activeWarmup.failed}
                </div>
              </div>
              <Badge tone="primary">{warmupProgress}%</Badge>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--panel-soft))]">
              <div className="h-full rounded-full bg-[hsl(var(--primary))] transition-all" style={{ width: `${warmupProgress}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

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
            <table className="w-full min-w-[1460px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr>
                  <th className="w-16 px-4 py-3">ID</th>
                  <th className="w-[240px] px-4 py-3">名称</th>
                  <th className="w-[160px] px-4 py-3">用户名</th>
                  <th className="w-[190px] px-4 py-3">状态</th>
                  <th className="w-[190px] px-4 py-3">绑定代理</th>
                  <th className="w-[160px] px-4 py-3">调度</th>
                  <th className="w-[220px] px-4 py-3">额度 / 治理</th>
                  <th className="w-[160px] px-4 py-3">检测时间</th>
                  <th className="px-4 py-3">摘要</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const expanded = expandedAccountId === account.id;
                  const editing = editingAccountId === account.id;
                  return (
                    <Fragment key={account.id}>
                      <tr className={cn('border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]', !USABLE_ACCOUNT_STATUSES.has(account.status) && 'bg-[rgba(248,113,113,0.08)] text-[hsl(var(--muted))]')}>
                        <td className="px-4 py-2 whitespace-nowrap">#{account.id}</td>
                        <td className="px-4 py-2">
                          {editing ? (
                            <div className="grid gap-2">
                              <Input
                                value={editingAccountLabel}
                                onChange={(event) => setEditingAccountLabel(event.target.value)}
                                className="h-8"
                                maxLength={80}
                              />
                              <SelectMenu
                                value={editingAccountProxyId ? String(editingAccountProxyId) : ''}
                                onValueChange={(value) => setEditingAccountProxyId(value ? Number(value) : null)}
                                triggerClassName="h-8 rounded-full px-3 text-xs"
                                options={[
                                  { value: '', label: '不绑定代理' },
                                  ...proxyOptions.map((proxy) => ({
                                    value: String(proxy.id),
                                    label: `${proxy.label} · ${proxy.detected_ip || proxyStatusLabel(proxy)}`,
                                  })),
                                ]}
                              />
                            </div>
                          ) : (
                            <div className="max-w-[220px] truncate font-medium" title={account.label}>{account.label}</div>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="max-w-[140px] truncate">{account.screen_name ? `@${account.screen_name}` : '-'}</div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge tone={statusTone(account.status)}>{statusLabel(account.status)}</Badge>
                            <span className="min-w-0 truncate text-xs text-[hsl(var(--muted))]">{accountUsabilityDescription(account)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge tone={account.bound_proxy_id ? (account.bound_proxy_available ? 'success' : 'warning') : 'neutral'}>
                              {account.bound_proxy_id ? '已绑定' : '自动'}
                            </Badge>
                            <span className="min-w-0 max-w-[120px] truncate text-xs text-[hsl(var(--muted))]" title={accountBoundProxySummary(account)}>
                              {accountBoundProxySummary(account)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          {account.capacity ? (
                            <div className="flex items-center gap-2">
                              <Badge tone={accountCapacityTone(account.capacity.level)}>{account.capacity.score} 分</Badge>
                              <Badge tone={accountUsabilityTone(account)}>{accountUsabilityLabel(account)}</Badge>
                            </div>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2">
                          <div className="max-w-[200px] truncate text-xs text-[hsl(var(--muted))]" title={accountQuotaSummary(account)}>
                            {accountQuotaSummary(account)}
                          </div>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">{account.last_checked_at || '-'}</td>
                        <td className="px-4 py-2">
                          <div className="max-w-[260px] truncate text-[hsl(var(--muted))]" title={accountErrorSummary(account)}>{accountErrorSummary(account)}</div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-2">
                            {editing ? (
                              <>
                                <Button variant="secondary" size="sm" onClick={() => updateAccount.mutate({ id: account.id, label: editingAccountLabel.trim(), bound_proxy_id: editingAccountProxyId })} disabled={updateAccount.isPending || !editingAccountLabel.trim()}>
                                  <Save className="h-4 w-4" />
                                  保存
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => { setEditingAccountId(null); setEditingAccountLabel(''); setEditingAccountProxyId(null); }}>
                                  取消
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button variant="secondary" size="sm" onClick={() => { setEditingAccountId(account.id); setEditingAccountLabel(account.label); setEditingAccountProxyId(account.bound_proxy_id); }}>
                                  <Edit3 className="h-4 w-4" />
                                  编辑
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => checkAccount.mutate(account.id)} disabled={checkAccount.isPending}>
                                  检测
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => warmupAccount.mutate(account.id)} disabled={warmupRunning || warmupAccount.isPending}>
                                  养护
                                </Button>
                                <Button variant="danger" size="sm" onClick={() => deleteAccount.mutate(account.id)} disabled={deleteAccount.isPending}>
                                  删除
                                </Button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => setExpandedAccountId(expanded ? null : account.id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[hsl(var(--line))] text-[hsl(var(--muted))] hover:bg-[hsl(var(--panel-soft))]"
                              aria-label={expanded ? '收起账号详情' : '展开账号详情'}
                            >
                              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${account.id}-details`} className="border-t border-[hsl(var(--line))] bg-[rgba(15,23,42,0.38)]">
                          <td className="px-4 py-4" colSpan={10}>
                            <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-5">
                              <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2">
                                <div className="text-xs text-[hsl(var(--muted))]">状态详情</div>
                                <div className="mt-1">{accountUsabilityDescription(account)}</div>
                                <div className="mt-2 text-xs text-[hsl(var(--muted))]">检测：{account.last_checked_at || '-'}</div>
                              </div>
                              <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2">
                                <div className="text-xs text-[hsl(var(--muted))]">调度能力</div>
                                {account.capacity ? (
                                  <>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                      <Badge tone={accountCapacityTone(account.capacity.level)}>{account.capacity.score} 分</Badge>
                                      <span>{account.capacity.reason}</span>
                                    </div>
                                    <div className="mt-2 text-xs text-[hsl(var(--muted))]">{accountQuotaSummary(account)}</div>
                                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">下次可用：{account.capacity.next_available_at || '现在'}</div>
                                  </>
                                ) : <div className="mt-1 text-[hsl(var(--muted))]">暂无调度评分</div>}
                              </div>
                              <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2">
                                <div className="text-xs text-[hsl(var(--muted))]">治理</div>
                                <div className="mt-1"><Badge tone={account.tier === 'stable' ? 'success' : 'warning'}>{statusLabel(account.tier)}</Badge></div>
                                <div className="mt-2 text-xs text-[hsl(var(--muted))]">{accountWarmupSummary(account)}</div>
                                <div className="mt-2 text-xs text-[hsl(var(--muted))]">任务 {account.task_count} · 成功 {account.success_count} · 失败 {account.failure_count}</div>
                                <div className="mt-1 text-xs text-[hsl(var(--muted))]">上次使用：{account.last_used_at || '-'}</div>
                                <div className="mt-1 text-xs text-[hsl(var(--muted))]">冷却至：{account.cooldown_until || '-'}</div>
                              </div>
                              <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2">
                                <div className="text-xs text-[hsl(var(--muted))]">绑定代理 / IP</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <Badge tone={account.bound_proxy_id ? (account.bound_proxy_available ? 'success' : 'warning') : 'neutral'}>
                                    {account.bound_proxy_id ? '优先绑定' : '自动分配'}
                                  </Badge>
                                  <span className="truncate">{accountBoundProxySummary(account)}</span>
                                </div>
                                <div className="mt-2 text-xs text-[hsl(var(--muted))]">任务未手动指定代理时优先使用绑定代理；不可用时回退自动代理。</div>
                              </div>
                              <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2">
                                <div className="text-xs text-[hsl(var(--muted))]">检测 / 错误</div>
                                {account.capacity?.adaptive_policy && (
                                  <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <Badge tone={accountCapacityTone(account.capacity.adaptive_policy.risk_level)}>
                                      {riskLevelLabel(account.capacity.adaptive_policy.risk_level)}
                                    </Badge>
                                    <span>{account.capacity.adaptive_policy.recommended_action}</span>
                                  </div>
                                )}
                                <div className="mt-2 whitespace-pre-wrap break-words text-xs text-[hsl(var(--muted))]">{account.last_error || account.capacity?.reason || '-'}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!accounts.length && (
                  <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={10}>还没有账号</td></tr>
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
                          {proxyStatusLabel(proxy)}
                        </Badge>
                        <div className="max-w-[240px] text-xs text-[hsl(var(--muted))]">
                          {proxyStatusDescription(proxy)}
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [proxyMode, setProxyMode] = useState<ProxyMode>('auto');

  useEffect(() => {
    if (configData) {
      const template = getTaskTemplateById(selectedTemplateId);
      setForm((prev) => {
        const savedConfig = { ...prev, ...configData };
        setProxyMode(proxyModeFromValues(savedConfig.proxy_id, savedConfig.proxy));
        if (!template?.runPayload) {
          return savedConfig;
        }
        const nextConfig = {
          ...DEFAULT_RUN_FORM,
          ...savedConfig,
          ...template.runPayload,
          cookie: savedConfig.cookie || '',
          save_path: savedConfig.save_path || '',
        };
        setProxyMode(proxyModeFromValues(nextConfig.proxy_id, nextConfig.proxy));
        return nextConfig;
      });
      setTimePreset(presetFromTimeRange(template?.runPayload?.time_range || configData.time_range));
    }
  }, [configData, selectedTemplateId]);

  useEffect(() => {
    const template = getTaskTemplateById(selectedTemplateId);
    if (template?.runPayload) {
      setForm((prev) => ({ ...DEFAULT_RUN_FORM, ...prev, ...template.runPayload, cookie: prev.cookie || '', save_path: prev.save_path || '' }));
      setProxyMode(proxyModeFromValues(template.runPayload.proxy_id, template.runPayload.proxy));
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
              <SelectMenu
                value={form.proxy_id ? String(form.proxy_id) : ''}
                onValueChange={(value) => setForm((prev) => ({ ...prev, proxy_id: value ? Number(value) : null }))}
                options={[
                  { value: '', label: '使用手填代理' },
                  ...usableProxies.map((proxy) => ({ value: String(proxy.id), label: proxy.label })),
                ]}
              />
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
