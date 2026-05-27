export type User = {
  id: number;
  username: string;
  role: 'admin' | 'user';
};

export type Account = {
  id: number;
  label: string;
  screen_name: string | null;
  status: string;
  last_checked_at: string | null;
  last_error: string | null;
  success_count: number;
  failure_count: number;
  task_count: number;
  last_used_at: string | null;
  cooldown_until: string | null;
  tier: string;
  created_at: string;
};

export type ProxyItem = {
  id: number;
  label: string;
  proxy: string;
  enabled: boolean;
  status: string;
  last_checked_at: string | null;
  last_error: string | null;
  detected_ip: string | null;
  failure_count: number;
  success_count: number;
  last_used_at: string | null;
  cooldown_until: string | null;
  created_at: string;
};

export type Task = {
  id: number;
  user_id: number;
  username: string | null;
  account_id: number | null;
  proxy_id: number | null;
  schedule_id: number | null;
  resource_mode: string;
  task_type: string;
  title: string;
  status: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  process_id: number | null;
  locked_by?: string | null;
  locked_at?: string | null;
  heartbeat_at?: string | null;
  progress_total?: number;
  progress_done?: number;
  api_calls?: number;
  download_count?: number;
  progress?: { total: number; done: number };
  worker_id?: string | null;
  indexed_counts?: { items: number; media_assets: number };
  retry_count: number;
  max_retries: number;
  last_retry_at: string | null;
  last_error_type: string | null;
  config?: Record<string, unknown>;
  log?: string;
  files?: Array<{ name: string; size: number }>;
  summary?: TaskSummary;
  preview?: TaskPreview;
};

export type ScheduledTask = {
  id: number;
  user_id: number;
  username: string | null;
  account_id: number;
  proxy_id: number | null;
  name: string;
  enabled: boolean;
  schedule_type: 'daily' | 'weekly';
  run_time: string;
  weekdays: number[];
  config: Record<string, unknown>;
  next_run_at: string | null;
  last_run_at: string | null;
  last_task_id: number | null;
  created_at: string;
  updated_at: string;
};

export type OperationLog = {
  id: number;
  created_at: string;
  level: 'info' | 'warning' | 'error';
  event_type: string;
  task_id: number | null;
  schedule_id: number | null;
  error_type: string | null;
  message: string;
  details: Record<string, unknown>;
};

export type ScheduleFormValues = {
  name: string;
  account_id: number;
  proxy_id: number | null;
  task_type: 'benchmark_account' | 'user_media';
  targets: string;
  schedule_type: 'daily' | 'weekly';
  run_time: string;
  weekdays: number[];
  time_range: string;
  max_concurrent_requests: number;
  tweet_limit: number;
  has_video: boolean;
  has_retweet: boolean;
  down_log: boolean;
  md_output: boolean;
  image_format: string;
  media_count_limit: number;
  proxy: string;
};

export type TaskPreview = {
  headers: string[];
  rows: Array<Record<string, string>>;
  total: number;
  csv_files: number;
};

export type TaskSummary = {
  csv_files: number;
  records: number;
  media_records: number;
  favorites: number;
  retweets: number;
  replies: number;
  top_urls: string[];
  files: number;
  media_files: number;
  total_bytes: number;
};

export type DashboardTask = {
  id: number;
  title: string;
  task_type: string;
  status: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  worker_id?: string | null;
  progress?: { total: number; done: number };
  indexed_counts?: { items: number; media_assets: number };
  target: string;
  summary: TaskSummary;
  error?: string | null;
  last_error_type?: string | null;
  retry_count?: number;
  max_retries?: number;
};

export type Dashboard = {
  totals: {
    tasks: number;
    running: number;
    completed: number;
    failed: number;
    files: number;
    media_files: number;
    records: number;
    api_calls: number;
    downloads: number;
  };
  accounts: Record<string, number>;
  status_counts?: Record<string, number>;
  resources?: {
    accounts: {
      total: number;
      usable: number;
      cooling: number;
      expired: number;
      warning: number;
    };
    proxies: {
      total: number;
      usable: number;
      cooling: number;
      disabled: number;
      warning: number;
    };
  };
  active_tasks?: DashboardTask[];
  attention_tasks?: DashboardTask[];
  recent_outputs?: DashboardTask[];
  recent_tasks: DashboardTask[];
  templates: Array<{
    name: string;
    description: string;
    payload: Record<string, unknown>;
  }>;
  compliance_notes: string[];
};

export type HealthStatus = {
  running: boolean;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_error: string | null;
  interval_seconds: number;
  accounts: Record<string, number>;
  proxies: Record<string, number>;
};

export type ApiError = {
  detail: string;
};

export type BitBrowserImportResult = {
  browser_id: string;
  status: 'imported' | 'failed';
  message: string;
  screen_name?: string;
};

export type BitBrowserImportResponse = {
  imported: number;
  failed: number;
  results: BitBrowserImportResult[];
};

export type RunStatus = {
  status: string;
  started_at: number | null;
  ended_at: number | null;
  running_for: number | null;
  return_code: number | null;
  summary: {
    elapsed: number | null;
    api_calls: number;
    downloads: number;
  };
  output_path: string;
  message: string;
  log_version: number;
  logs: string[];
};

export type RunConfig = {
  save_path: string;
  user_lst: string;
  cookie: string;
  time_range: string;
  has_retweet: boolean;
  high_lights: boolean;
  likes: boolean;
  down_log: boolean;
  autoSync: boolean;
  image_format: string;
  has_video: boolean;
  log_output: boolean;
  max_concurrent_requests: number;
  proxy: string;
  proxy_id?: number | null;
  proxies?: ProxyItem[];
  md_output: boolean;
  media_count_limit: number;
  project_path?: string;
};

export type TaskType = 'user_media' | 'benchmark_account' | 'search' | 'text' | 'replies' | 'profile';

export type TaskFormValues = {
  task_type: TaskType;
  account_id: number;
  targets: string;
  time_range: string;
  max_concurrent_requests: number;
  has_retweet: boolean;
  high_lights: boolean;
  likes: boolean;
  has_video: boolean;
  down_log: boolean;
  auto_sync: boolean;
  md_output: boolean;
  image_format: string;
  media_count_limit: number;
  proxy: string;
  proxy_id: number | null;
  tag: string;
  advanced_filter: string;
  down_count: number;
  tweet_limit: number;
  media_latest: boolean;
  text_down: boolean;
  media_down: boolean;
  min_replies: number;
  min_faves: number;
  min_retweets: number;
  search_advanced: string;
};
