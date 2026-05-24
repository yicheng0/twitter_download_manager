import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BarChart3, CircleUserRound, FileArchive, FolderKanban, Plus, RefreshCcw, ShieldCheck, SquareTerminal, Play, Square, Target, TrendingUp, Network } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from './lib/api';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader } from './components/ui/card';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import type { Account, Dashboard, ProxyItem, RunConfig, RunStatus, Task } from './lib/types';
import { cn } from './lib/utils';

function statusTone(status: string) {
  if (status === 'completed' || status === 'active') return 'success';
  if (status === 'running') return 'primary';
  if (status === 'queued' || status === 'rate_limited') return 'warning';
  if (status === 'failed' || status === 'cancelled' || status === 'expired' || status === 'auth_expired') return 'danger';
  return 'neutral';
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[hsl(var(--bg))] text-[hsl(var(--text))]">
      <header className="sticky top-0 z-20 border-b border-[hsl(var(--line))] bg-[rgba(247,250,250,0.94)] backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] text-[hsl(var(--primary-dark))]">
              <SquareTerminal className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--primary-dark))]">Local Learning Tool</div>
              <div className="text-lg font-semibold leading-tight">Twitter/X 下载学习面板</div>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2 md:ml-4">
            <NavItem to="/" icon={<BarChart3 className="h-4 w-4" />} label="汇报看板" />
            <NavItem to="/run" icon={<Activity className="h-4 w-4" />} label="运行控制" />
            <NavItem to="/tasks" icon={<FolderKanban className="h-4 w-4" />} label="任务" />
            <NavItem to="/tasks/new" icon={<Plus className="h-4 w-4" />} label="新建" />
            <NavItem to="/accounts" icon={<ShieldCheck className="h-4 w-4" />} label="账号" />
            <NavItem to="/proxies" icon={<Network className="h-4 w-4" />} label="代理" />
          </nav>
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
          isActive && 'bg-[rgba(13,148,136,0.08)] text-[hsl(var(--primary-dark))]',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function BeginnerPanel({
  title,
  description,
  steps,
  children,
}: {
  title: string;
  description: string;
  steps: string[];
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-4 shadow-[0_18px_45px_rgba(19,78,74,0.10)]">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--accent))]">小白操作面板</div>
            <h3 className="mt-1 text-lg font-semibold text-[hsl(var(--text))]">{title}</h3>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">{description}</p>
          </div>
          <ol className="grid gap-2 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step} className="flex min-h-12 items-center gap-3 rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3 py-2 text-sm">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary-dark))] text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <span className="leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </div>
        {children && <div className="flex flex-wrap gap-2 lg:justify-end">{children}</div>}
      </div>
    </section>
  );
}

function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard(), refetchInterval: 5000 });
  const dashboard = data;

  if (isLoading && !dashboard) return <div className="text-sm text-[hsl(var(--muted))]">加载中...</div>;
  if (!dashboard) return <div>看板数据暂不可用</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold">X 舆情采集汇报看板</h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted))]">
          面向内部研究和授权账号的采集演示原型，覆盖账号、关键词、评论和主页资料任务。
        </p>
      </div>
      <BeginnerPanel
        title="先从看板了解结果"
        description="这里适合快速看最近采集情况，再决定要新建任务还是查看已有任务。"
        steps={['看总数和最近任务', '打开任务看日志', '套用模板新建任务']}
      >
        <Button onClick={() => (window.location.href = '/tasks/new')}>
          <Plus className="h-4 w-4" />
          新建演示任务
        </Button>
        <Button variant="secondary" onClick={() => (window.location.href = '/tasks')}>
          <FolderKanban className="h-4 w-4" />
          查看任务
        </Button>
      </BeginnerPanel>

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
                      <td className="px-4 py-3"><Badge tone={statusTone(task.status) as any}>{task.status}</Badge></td>
                      <td className="px-4 py-3">{task.summary.records} / {task.summary.files}</td>
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
              <h2 className="font-semibold">汇报边界</h2>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.compliance_notes.map((note) => (
              <div key={note} className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm text-[hsl(var(--muted))]">
                {note}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-[hsl(var(--primary-dark))]" />
            <h2 className="font-semibold">老板演示任务模板</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {dashboard.templates.map((template) => (
              <DemoTemplate key={template.name} template={template} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DemoTemplate({ template }: { template: Dashboard['templates'][number] }) {
  return (
    <div className="flex min-h-40 flex-col justify-between rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] p-4">
      <div>
        <div className="font-semibold">{template.name}</div>
        <p className="mt-2 text-sm text-[hsl(var(--muted))]">{template.description}</p>
      </div>
      <Button className="mt-4 w-full" variant="secondary" onClick={() => (window.location.href = `/tasks/new?template=${encodeURIComponent(template.name)}`)}>
        套用模板
      </Button>
    </div>
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
      <BeginnerPanel
        title="看任务进度"
        description="不确定程序有没有在跑时，先看这里的状态和详情日志。"
        steps={['刷新任务列表', '打开任务详情', '下载结果或查看错误']}
      >
        <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['tasks'] })}>
          <RefreshCcw className="h-4 w-4" />
          刷新
        </Button>
        <Button onClick={() => (window.location.href = '/tasks/new')}>
          <Plus className="h-4 w-4" />
          新建任务
        </Button>
      </BeginnerPanel>

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
    .replace(/("ct0"\s*:\s*")[^"]+/gi, '$1[已隐藏]');
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
  if (!/^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(String(form.time_range || ''))) {
    errors.push('时间范围格式应为 YYYY-MM-DD:YYYY-MM-DD。');
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
    } else if (!proxy.enabled) {
      errors.push('所选代理已停用，请启用代理或改用手填代理。');
    }
  }
  return errors;
}

function runCopyText(status: RunStatus) {
  return [
    '运行控制排查信息',
    `状态: ${status.status}`,
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
    `状态: ${task.status}`,
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
        <Badge tone={statusTone(task.status) as any}>{task.status}</Badge>
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
  const { data: dashboardData } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard() });
  const { data: proxiesData } = useQuery({ queryKey: ['proxies'], queryFn: () => api.proxies() });
  const [searchParams] = useSearchParams();
  const accounts = accountData?.accounts || [];
  const proxies = proxiesData?.proxies || [];
  const [form, setForm] = useState({
    task_type: 'user_media',
    account_id: accounts[0]?.id ?? '',
    targets: '',
    time_range: '1990-01-01:2030-01-01',
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
    proxy_id: null as number | null,
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
  });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => api.createTask(form),
    onSuccess: (res) => (window.location.href = `/tasks/${res.task.id}`),
    onError: (err: Error) => setError(err.message),
  });

  useEffect(() => {
    if (!form.account_id && accounts[0]?.id) {
      setForm((prev) => ({ ...prev, account_id: accounts[0].id }));
    }
  }, [accounts, form.account_id]);

  useEffect(() => {
    const templateName = searchParams.get('template');
    const template = dashboardData?.templates.find((item) => item.name === templateName);
    if (template) {
      setForm((prev) => ({ ...prev, ...template.payload }));
    }
  }, [dashboardData, searchParams]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">新建任务</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">按任务类型填写对应字段，提交后自动进入队列。</p>
      </div>
      <BeginnerPanel
        title="按顺序填任务"
        description="先选账号和任务类型，再填目标用户或搜索词，最后提交进入队列。"
        steps={['选择可用 X 账号', '填写目标和时间范围', '提交任务后看进度']}
      >
        <Button onClick={() => create.mutate()} disabled={create.isPending || !accounts.length}>
          提交任务
        </Button>
        <Button variant="secondary" onClick={() => (window.location.href = '/tasks')}>
          取消
        </Button>
      </BeginnerPanel>
      {error && <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(180,35,24,0.08)] px-3 py-2 text-sm text-[hsl(var(--danger))]">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><h3 className="font-semibold">基础</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="任务类型">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.task_type} onChange={(e) => setForm((prev) => ({ ...prev, task_type: e.target.value }))}>
                <option value="user_media">用户媒体</option>
                <option value="search">搜索/Tag</option>
                <option value="text">用户文本</option>
                <option value="replies">评论区</option>
                <option value="profile">主页资料</option>
              </select>
            </Field>
            <Field label="X账号">
              <select className="h-10 w-full rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3" value={form.account_id} onChange={(e) => setForm((prev) => ({ ...prev, account_id: Number(e.target.value) }))}>
                {accounts.map((account: Account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}{account.screen_name ? ` (@${account.screen_name})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="目标用户 / 推文链接">
              <Textarea value={form.targets} onChange={(e) => setForm((prev) => ({ ...prev, targets: e.target.value }))} rows={4} />
            </Field>
            <Field label="时间范围">
              <Input value={form.time_range} onChange={(e) => setForm((prev) => ({ ...prev, time_range: e.target.value }))} />
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
                {proxies.map((proxy) => (
                  <option key={proxy.id} value={proxy.id}>
                    {proxy.label} {proxy.enabled ? '' : '(停用)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="手填代理">
              <Input value={form.proxy} onChange={(e) => setForm((prev) => ({ ...prev, proxy: e.target.value }))} placeholder="http://127.0.0.1:7890" />
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
      <BeginnerPanel
        title="看单个任务结果"
        description="先确认状态，再看日志判断是否成功，完成后可以打包下载输出文件。"
        steps={['刷新状态', '查看日志和错误', '下载结果文件']}
      >
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
      </BeginnerPanel>
      {copyStatus && <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm text-[hsl(var(--muted))]">{copyStatus}</div>}

      <div className="grid gap-3 md:grid-cols-4">
        <InfoCard title="状态" value={task.status} />
        <InfoCard title="开始时间" value={task.started_at || '-'} />
        <InfoCard title="结束时间" value={task.finished_at || '-'} />
        <InfoCard title="错误" value={task.error || '-'} />
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
            <pre className="overflow-auto rounded-lg border border-[hsl(var(--primary-dark))] bg-[#123b37] p-4 text-xs leading-6 text-[#e6fffb]">{JSON.stringify(task.config || {}, null, 2)}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h3 className="font-semibold">日志</h3></CardHeader>
          <CardContent>
            <pre className="max-h-[540px] overflow-auto whitespace-pre-wrap rounded-lg border border-[hsl(var(--primary-dark))] bg-[#082f2c] p-4 text-xs leading-6 text-[#e6fffb]">{task.log || '还没有日志'}</pre>
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
  const [error, setError] = useState('');
  const addAccount = useMutation({
    mutationFn: () => api.addAccount(form),
    onSuccess: () => {
      setError('');
      setForm({ label: '', auth_token: '', ct0: '' });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const browserLogin = useMutation({
    mutationFn: api.browserLogin,
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">X 账号池</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">维护会话，任务从这里选账号。</p>
      </div>
      <BeginnerPanel
        title="先准备可用账号"
        description="账号状态是 active 后，任务和运行控制才能稳定使用 Cookie。"
        steps={['浏览器登录 X', '检测账号状态', '回到任务或运行控制']}
      >
        <Button onClick={() => browserLogin.mutate()} disabled={browserLogin.isPending}>
          <CircleUserRound className="h-4 w-4" />
          浏览器登录
        </Button>
      </BeginnerPanel>
      {error && <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(180,35,24,0.08)] px-3 py-2 text-sm text-[hsl(var(--danger))]">{error}</div>}

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
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[1000px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">用户名</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">检测时间</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]">
                    <td className="px-4 py-3">#{account.id}</td>
                    <td className="px-4 py-3 font-medium">{account.label}</td>
                    <td className="px-4 py-3">{account.screen_name ? `@${account.screen_name}` : '-'}</td>
                    <td className="px-4 py-3"><Badge tone={statusTone(account.status) as any}>{account.status}</Badge></td>
                    <td className="px-4 py-3">{account.last_checked_at || '-'}</td>
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
                  <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={6}>还没有账号</td></tr>
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
      <BeginnerPanel
        title="先准备可用代理"
        description="先录入代理，再点检测；通过后就能在运行页选择。"
        steps={['录入代理地址', '检测连通性', '在运行页选择代理']}
      >
        <Button onClick={() => addProxy.mutate()} disabled={addProxy.isPending || !form.proxy}>
          <Network className="h-4 w-4" />
          保存代理
        </Button>
      </BeginnerPanel>
      {error && <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(180,35,24,0.08)] px-3 py-2 text-sm text-[hsl(var(--danger))]">{error}</div>}

      <Card>
        <CardHeader>
          <h3 className="font-semibold">新增代理</h3>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <Field label="名称">
            <Input value={form.label} onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))} />
          </Field>
          <Field label="代理地址">
            <Input value={form.proxy} onChange={(e) => setForm((prev) => ({ ...prev, proxy: e.target.value }))} placeholder="http://127.0.0.1:7890" />
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
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--panel-soft))] text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">代理</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">检测时间</th>
                  <th className="px-4 py-3">错误</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {proxies.map((proxy) => (
                  <tr key={proxy.id} className="border-t border-[hsl(var(--line))] hover:bg-[hsl(var(--panel-soft))]">
                    <td className="px-4 py-3">#{proxy.id}</td>
                    <td className="px-4 py-3 font-medium">{proxy.label}</td>
                    <td className="px-4 py-3 break-all">{proxy.proxy}</td>
                    <td className="px-4 py-3">
                      <Badge tone={proxy.enabled ? 'success' : 'neutral'}>{proxy.enabled ? proxy.status : 'disabled'}</Badge>
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
                  <tr><td className="px-4 py-10 text-center text-[hsl(var(--muted))]" colSpan={7}>还没有代理</td></tr>
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
  const { data: configData } = useQuery({ queryKey: ['run-config'], queryFn: () => api.runConfig() });
  const { data: statusData } = useQuery({ queryKey: ['run-status'], queryFn: () => api.runStatus(), refetchInterval: 2000 });
  const { data: proxiesData } = useQuery({ queryKey: ['proxies'], queryFn: () => api.proxies(), refetchInterval: 8000 });
  const proxies = proxiesData?.proxies || [];
  const [preflightErrors, setPreflightErrors] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState('');
  const [form, setForm] = useState({
    save_path: '',
    user_lst: '',
    cookie: '',
    time_range: '1990-01-01:2030-01-01',
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
    proxy_id: null as number | null,
    md_output: false,
    media_count_limit: 350,
  });

  useEffect(() => {
    if (configData) setForm((prev) => ({ ...prev, ...configData }));
  }, [configData]);

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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">运行控制</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">配置下载参数、启动任务并查看实时日志。</p>
      </div>
      <BeginnerPanel
        title="最快启动下载"
        description="第一次使用只需要填 Cookie、用户名列表和保存路径，其它选项可以先保持默认。"
        steps={['粘贴 auth_token 和 ct0', '填写用户名和保存路径', '点击启动后看日志']}
      >
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
      </BeginnerPanel>

      {preflightErrors.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--warning))] bg-[rgba(217,119,6,0.10)] px-4 py-3 text-sm text-[hsl(var(--text))]">
          <div className="font-semibold">启动前请先处理：</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {preflightErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}

      {(start.error || stop.error) && (
        <div className="rounded-lg border border-[hsl(var(--danger))] bg-[rgba(180,35,24,0.08)] px-3 py-2 text-sm text-[hsl(var(--danger))]">
          操作没有成功：{(start.error as Error | null)?.message || (stop.error as Error | null)?.message}
        </div>
      )}

      {copyStatus && <div className="rounded-lg border border-[hsl(var(--line))] bg-[hsl(var(--panel-soft))] px-3 py-2 text-sm text-[hsl(var(--muted))]">{copyStatus}</div>}

      <div className="grid gap-3 md:grid-cols-4">
        <InfoCard title="状态" value={status.status} />
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
                {proxies.map((proxy) => (
                  <option key={proxy.id} value={proxy.id}>
                    {proxy.label} {proxy.enabled ? '' : '(停用)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="时间范围"><Input value={form.time_range} onChange={(e) => setForm((prev) => ({ ...prev, time_range: e.target.value }))} /></Field>
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
            <div className="max-h-[640px] overflow-auto rounded-lg border border-[hsl(var(--primary-dark))] bg-[#082f2c] p-4 text-xs leading-6 text-[#e6fffb]">
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

function TaskDetailRoute() {
  const params = useParams();
  return <TaskDetailPage id={Number(params.id)} />;
}

export default App;
