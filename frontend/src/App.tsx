import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CircleUserRound, FolderKanban, LogOut, Plus, RefreshCcw, ShieldCheck, SquareTerminal, Activity, Play, Square } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from './lib/api';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader } from './components/ui/card';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import type { Account, Task, User } from './lib/types';
import { cn } from './lib/utils';

function useSession() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

function statusTone(status: string) {
  if (status === 'completed' || status === 'active') return 'success';
  if (status === 'running') return 'primary';
  if (status === 'queued') return 'warning';
  if (status === 'failed' || status === 'cancelled' || status === 'expired' || status === 'auth_expired') return 'danger';
  if (status === 'rate_limited') return 'warning';
  return 'neutral';
}

function Shell({ user, children }: { user: User; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['me'] });
      location.href = '/login';
    },
  });

  return (
    <div className="min-h-screen bg-[hsl(var(--bg))] text-[hsl(var(--text))]">
      <header className="sticky top-0 z-20 border-b border-[hsl(var(--line))] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4">
          <div className="flex items-center gap-2 font-semibold">
            <SquareTerminal className="h-5 w-5 text-[hsl(var(--primary))]" />
            Twitter Download Web
          </div>
          <nav className="ml-4 hidden items-center gap-2 md:flex">
            <NavItem to="/run" icon={<Activity className="h-4 w-4" />} label="运行控制" />
            <NavItem to="/tasks" icon={<FolderKanban className="h-4 w-4" />} label="任务" />
            <NavItem to="/tasks/new" icon={<Plus className="h-4 w-4" />} label="新建" />
            {user.role === 'admin' && <NavItem to="/accounts" icon={<ShieldCheck className="h-4 w-4" />} label="账号" />}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Badge tone="neutral">{user.username}</Badge>
            <Button variant="ghost" size="sm" onClick={() => logout.mutate()}>
              <LogOut className="mr-2 h-4 w-4" />
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
          'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[hsl(var(--muted))] transition hover:bg-slate-100 hover:text-[hsl(var(--text))]',
          isActive && 'bg-blue-50 text-[hsl(var(--primary))]',
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
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/tasks');
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-2xl font-semibold">Twitter Download Web</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted))]">局域网后台，登录后管理任务、账号和下载结果。</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <label className="grid gap-2 text-sm font-medium">
              用户名
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              密码
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <Button className="w-full" onClick={() => login.mutate()} disabled={login.isPending}>
              登录
            </Button>
            <div className="text-sm text-[hsl(var(--muted))]">默认管理员: admin / admin123</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TaskListPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks(), refetchInterval: 5000 });
  const tasks = data?.tasks || [];
  const stats = {
    total: tasks.length,
    queued: tasks.filter((t) => t.status === 'queued').length,
    running: tasks.filter((t) => t.status === 'running').length,
    done: tasks.filter((t) => t.status === 'completed').length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">任务</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">排队、运行、完成、失败都在这里看。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['tasks'] })}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Button onClick={() => (window.location.href = '/tasks/new')}>
            <Plus className="mr-2 h-4 w-4" />
            新建任务
          </Button>
        </div>
      </div>

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
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
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
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
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

function TaskRow({ task }: { task: Task }) {
  const navigate = useNavigate();
  return (
    <tr className="border-t border-[hsl(var(--line))] hover:bg-slate-50">
      <td className="px-4 py-3">#{task.id}</td>
      <td className="px-4 py-3">
        <div className="font-medium">{task.title}</div>
        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{task.task_type}</div>
      </td>
      <td className="px-4 py-3">
        <Badge tone={statusTone(task.status) as any}>{task.status}</Badge>
      </td>
      <td className="px-4 py-3">{task.username}</td>
      <td className="px-4 py-3">{task.created_at}</td>
      <td className="px-4 py-3 text-right">
        <Button variant="secondary" size="sm" onClick={() => navigate(`/tasks/${task.id}`)}>
          查看
        </Button>
      </td>
    </tr>
  );
}

function TaskFormPage({ user }: { user: User }) {
  const { data: accountData } = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts() });
  const accounts = accountData?.accounts || [];
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">新建任务</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">按任务类型填写对应字段，提交后自动进入队列。</p>
      </div>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><h3 className="font-semibold">基础</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="任务类型">
              <select className="h-10 w-full rounded-lg border border-line bg-white px-3" value={form.task_type} onChange={(e) => setForm((p) => ({ ...p, task_type: e.target.value }))}>
                <option value="user_media">用户媒体</option>
                <option value="search">搜索/Tag</option>
                <option value="text">用户文本</option>
                <option value="replies">评论区</option>
                <option value="profile">主页资料</option>
              </select>
            </Field>
            <Field label="X账号">
              <select className="h-10 w-full rounded-lg border border-line bg-white px-3" value={form.account_id} onChange={(e) => setForm((p) => ({ ...p, account_id: Number(e.target.value) }))}>
                {accounts.map((account: Account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}{account.screen_name ? ` (@${account.screen_name})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="目标用户 / 推文链接">
              <Textarea value={form.targets} onChange={(e) => setForm((p) => ({ ...p, targets: e.target.value }))} rows={4} />
            </Field>
            <Field label="时间范围">
              <Input value={form.time_range} onChange={(e) => setForm((p) => ({ ...p, time_range: e.target.value }))} />
            </Field>
            <Field label="并发下载数">
              <Input type="number" value={form.max_concurrent_requests} onChange={(e) => setForm((p) => ({ ...p, max_concurrent_requests: Number(e.target.value) }))} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold">用户媒体</h3></CardHeader>
          <CardContent className="space-y-4">
            <Check label="下载视频" checked={form.has_video} onCheckedChange={(checked) => setForm((p) => ({ ...p, has_video: checked }))} />
            <Check label="包含转推" checked={form.has_retweet} onCheckedChange={(checked) => setForm((p) => ({ ...p, has_retweet: checked }))} />
            <Check label="亮点" checked={form.high_lights} onCheckedChange={(checked) => setForm((p) => ({ ...p, high_lights: checked }))} />
            <Check label="Likes" checked={form.likes} onCheckedChange={(checked) => setForm((p) => ({ ...p, likes: checked }))} />
            <Check label="去重日志" checked={form.down_log} onCheckedChange={(checked) => setForm((p) => ({ ...p, down_log: checked }))} />
            <Check label="自动同步" checked={form.auto_sync} onCheckedChange={(checked) => setForm((p) => ({ ...p, auto_sync: checked }))} />
            <Check label="输出 Markdown" checked={form.md_output} onCheckedChange={(checked) => setForm((p) => ({ ...p, md_output: checked }))} />
            <Field label="图片格式">
              <select className="h-10 w-full rounded-lg border border-line bg-white px-3" value={form.image_format} onChange={(e) => setForm((p) => ({ ...p, image_format: e.target.value }))}>
                <option value="orig">orig</option>
                <option value="jpg">jpg</option>
                <option value="png">png</option>
              </select>
            </Field>
            <Field label="单个 Markdown 媒体数量">
              <Input type="number" value={form.media_count_limit} onChange={(e) => setForm((p) => ({ ...p, media_count_limit: Number(e.target.value) }))} />
            </Field>
            <Field label="代理">
              <Input value={form.proxy} onChange={(e) => setForm((p) => ({ ...p, proxy: e.target.value }))} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold">搜索 / Tag</h3></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Tag">
              <Input value={form.tag} onChange={(e) => setForm((p) => ({ ...p, tag: e.target.value }))} />
            </Field>
            <Field label="高级搜索">
              <Textarea value={form.advanced_filter} onChange={(e) => setForm((p) => ({ ...p, advanced_filter: e.target.value }))} rows={3} />
            </Field>
            <Field label="下载数量">
              <Input type="number" value={form.down_count} onChange={(e) => setForm((p) => ({ ...p, down_count: Number(e.target.value) }))} />
            </Field>
            <Check label="最新页媒体" checked={form.media_latest} onCheckedChange={(checked) => setForm((p) => ({ ...p, media_latest: checked }))} />
            <Check label="文本模式" checked={form.text_down} onCheckedChange={(checked) => setForm((p) => ({ ...p, text_down: checked }))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold">评论区</h3></CardHeader>
          <CardContent className="space-y-4">
            <Check label="下载评论媒体" checked={form.media_down} onCheckedChange={(checked) => setForm((p) => ({ ...p, media_down: checked }))} />
            <Field label="最小评论数">
              <Input type="number" value={form.min_replies} onChange={(e) => setForm((p) => ({ ...p, min_replies: Number(e.target.value) }))} />
            </Field>
            <Field label="最小喜欢数">
              <Input type="number" value={form.min_faves} onChange={(e) => setForm((p) => ({ ...p, min_faves: Number(e.target.value) }))} />
            </Field>
            <Field label="最小转推数">
              <Input type="number" value={form.min_retweets} onChange={(e) => setForm((p) => ({ ...p, min_retweets: Number(e.target.value) }))} />
            </Field>
            <Field label="评论高级搜索">
              <Textarea value={form.search_advanced} onChange={(e) => setForm((p) => ({ ...p, search_advanced: e.target.value }))} rows={3} />
            </Field>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => create.mutate()} disabled={create.isPending || !accounts.length}>
          提交任务
        </Button>
        <Button variant="secondary" onClick={() => (window.location.href = '/tasks')}>
          取消
        </Button>
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
    <label className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} className="h-4 w-4" />
      <span>{label}</span>
    </label>
  );
}

function TaskDetailPage({ user, id }: { user: User; id: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['task', id], queryFn: () => api.task(id), refetchInterval: 4000 });
  const task = data?.task;
  const cancel = useMutation({
    mutationFn: () => api.cancelTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task', id] }),
  });

  if (isLoading && !task) return <div className="text-sm text-[hsl(var(--muted))]">加载中...</div>;
  if (!task) return <div>任务不存在</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{task.title}</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">#{task.id} · {task.username} · {task.created_at}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['task', id] })}>
            <RefreshCcw className="mr-2 h-4 w-4" />
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
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <InfoCard title="状态" value={task.status} />
        <InfoCard title="开始时间" value={task.started_at || '-'} />
        <InfoCard title="结束时间" value={task.finished_at || '-'} />
        <InfoCard title="错误" value={task.error || '-'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><h3 className="font-semibold">配置</h3></CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{JSON.stringify(task.config || {}, null, 2)}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h3 className="font-semibold">日志</h3></CardHeader>
          <CardContent>
            <pre className="max-h-[540px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{task.log || '还没有日志'}</pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h3 className="font-semibold">文件</h3></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[800px] border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
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

function AccountsPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts(), refetchInterval: 8000 });
  const accounts = data?.accounts || [];
  const browserLogin = useMutation({
    mutationFn: api.browserLogin,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">X 账号池</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">管理员维护会话，任务从这里选账号。</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => browserLogin.mutate()}>
            <CircleUserRound className="mr-2 h-4 w-4" />
            浏览器登录
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full min-w-[1000px] border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
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
                  <tr key={account.id} className="border-t border-[hsl(var(--line))] hover:bg-slate-50">
                    <td className="px-4 py-3">#{account.id}</td>
                    <td className="px-4 py-3 font-medium">{account.label}</td>
                    <td className="px-4 py-3">{account.screen_name ? `@${account.screen_name}` : '-'}</td>
                    <td className="px-4 py-3"><Badge tone={statusTone(account.status) as any}>{account.status}</Badge></td>
                    <td className="px-4 py-3">{account.last_checked_at || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => queryClient.fetchQuery({ queryKey: ['check', account.id], queryFn: () => api.checkAccount(account.id) })}>
                          检测
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => api.deleteAccount(account.id).then(() => queryClient.invalidateQueries({ queryKey: ['accounts'] }))}>
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

function RunControlPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { data: configData } = useQuery({ queryKey: ['run-config'], queryFn: () => api.runConfig() });
  const { data: statusData } = useQuery({ queryKey: ['run-status'], queryFn: () => api.runStatus(), refetchInterval: 2000 });
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
    md_output: false,
    media_count_limit: 350,
  });
  useEffect(() => {
    if (configData) setForm((prev) => ({ ...prev, ...configData }));
  }, [configData]);
  const start = useMutation({
    mutationFn: () => api.runStart(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run-status'] });
    },
  });
  const stop = useMutation({
    mutationFn: api.runStop,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run-status'] });
    },
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">运行控制</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">把原来 7860 的独立面板收进这里。</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            <Play className="mr-2 h-4 w-4" />
            启动
          </Button>
          <Button variant="danger" onClick={() => stop.mutate()} disabled={stop.isPending}>
            <Square className="mr-2 h-4 w-4" />
            停止
          </Button>
        </div>
      </div>

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
            <Field label="保存路径"><Input value={form.save_path} onChange={(e) => setForm((p) => ({ ...p, save_path: e.target.value }))} /></Field>
            <Field label="用户名列表"><Textarea rows={3} value={form.user_lst} onChange={(e) => setForm((p) => ({ ...p, user_lst: e.target.value }))} /></Field>
            <Field label="Cookie"><Textarea rows={3} value={form.cookie} onChange={(e) => setForm((p) => ({ ...p, cookie: e.target.value }))} /></Field>
            <Field label="时间范围"><Input value={form.time_range} onChange={(e) => setForm((p) => ({ ...p, time_range: e.target.value }))} /></Field>
            <Field label="并发数"><Input type="number" value={form.max_concurrent_requests} onChange={(e) => setForm((p) => ({ ...p, max_concurrent_requests: Number(e.target.value) }))} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Check label="包含转推" checked={form.has_retweet} onCheckedChange={(checked) => setForm((p) => ({ ...p, has_retweet: checked }))} />
              <Check label="亮点" checked={form.high_lights} onCheckedChange={(checked) => setForm((p) => ({ ...p, high_lights: checked }))} />
              <Check label="Likes" checked={form.likes} onCheckedChange={(checked) => setForm((p) => ({ ...p, likes: checked }))} />
              <Check label="去重日志" checked={form.down_log} onCheckedChange={(checked) => setForm((p) => ({ ...p, down_log: checked }))} />
              <Check label="自动同步" checked={form.autoSync} onCheckedChange={(checked) => setForm((p) => ({ ...p, autoSync: checked }))} />
              <Check label="视频下载" checked={form.has_video} onCheckedChange={(checked) => setForm((p) => ({ ...p, has_video: checked }))} />
              <Check label="输出 Markdown" checked={form.md_output} onCheckedChange={(checked) => setForm((p) => ({ ...p, md_output: checked }))} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h3 className="font-semibold">日志</h3></CardHeader>
          <CardContent>
            <div className="max-h-[640px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
              {status.logs.length ? status.logs.map((line, index) => <div key={index}>{line}</div>) : '还没有日志'}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function App() {
  const { data, isLoading } = useSession();
  const session = data?.user ? data : null;

  if (isLoading) return <div className="p-6 text-sm text-[hsl(var(--muted))]">加载中...</div>;
  if (!session) return <Routes><Route path="*" element={<LoginPage />} /></Routes>;

  const user = session.user;
  return (
    <Shell user={user}>
      <Routes>
        <Route path="/" element={<Navigate to="/tasks" replace />} />
        <Route path="/run" element={<RunControlPage user={user} />} />
        <Route path="/tasks" element={<TaskListPage user={user} />} />
        <Route path="/tasks/new" element={<TaskFormPage user={user} />} />
        <Route path="/tasks/:id" element={<TaskDetailRoute user={user} />} />
        <Route path="/accounts" element={user.role === 'admin' ? <AccountsPage user={user} /> : <Navigate to="/tasks" replace />} />
        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Routes>
    </Shell>
  );
}

function TaskDetailRoute({ user }: { user: User }) {
  const params = useParams();
  const id = Number(params.id);
  return <TaskDetailPage user={user} id={id} />;
}

export default App;
