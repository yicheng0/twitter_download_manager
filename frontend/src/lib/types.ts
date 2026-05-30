export type User = {
  id: number;
  username: string;
  role: 'admin' | 'user';
};

export type AccountCapacity = {
  score: number;
  level: 'healthy' | 'limited' | 'cooldown' | 'expired' | 'risky';
  reason: string;
  api_used_24h: number;
  api_budget_24h: number;
  api_remaining_estimate: number;
  task_used_24h: number;
  task_limit_24h: number;
  task_remaining_24h: number;
  cooldown_remaining_seconds: number;
  next_available_at: string | null;
  rate_limited_24h: number;
  failure_24h: number;
  adaptive_policy?: {
    enabled: boolean;
    risk_level: 'healthy' | 'watch' | 'risky' | 'cooldown' | 'expired' | string;
    allowed_task_types: string[];
    max_tweet_limit: number | null;
    min_interval_seconds: number;
    recommended_action: string;
  };
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
  bound_proxy_id: number | null;
  bound_proxy_label: string | null;
  bound_proxy_status: string | null;
  bound_proxy_enabled: boolean | null;
  bound_proxy_available: boolean;
  capacity?: AccountCapacity;
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

export type TrackedBlogger = {
  id: number;
  screen_name: string;
  display_name: string | null;
  default_tweet_limit: number;
  last_used_at: string | null;
  use_count: number;
  created_at: string;
  updated_at: string;
};

export type TargetLimitMap = Record<string, number>;

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
  timezone: string;
  missed_run_policy: string;
  failure_policy: string;
  consecutive_failures: number;
  last_error: string | null;
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

export type OperationLogResponse = {
  logs: OperationLog[];
  total: number;
  offset: number;
  limit: number;
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
  timezone: string;
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
  monitor_new_content: boolean;
  monitor_interval_minutes: number;
  first_run_policy: 'baseline';
};

export type TaskPreview = {
  headers: string[];
  rows: Array<Record<string, string>>;
  total: number;
  csv_files: number;
};

export type TaskResultMedia = {
  id: number;
  task_id: number;
  task_item_id: number | null;
  tweet_url: string;
  media_type: string;
  media_url: string;
  file_name: string;
  status: 'downloaded' | 'indexed' | string;
  error: string | null;
  byte_size: number;
  created_at: string;
  local_url: string | null;
};

export type TaskResultItem = {
  id: number;
  task_id: number;
  source_file: string | null;
  tweet_url: string;
  tweet_date: string | null;
  display_name: string | null;
  screen_name: string | null;
  content: string | null;
  favorite_count: number;
  retweet_count: number;
  reply_count: number;
  media_count: number;
  created_at: string;
  media: TaskResultMedia[];
};

export type TaskItemsResponse = {
  total: number;
  offset: number;
  limit: number;
  items: TaskResultItem[];
};

export type LoginQueueItem = {
  id: number;
  label: string;
  status: string;
  message: string;
  token: string;
  screen_name: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  expires_in: number;
};

export type LoginQueueResponse = {
  items: LoginQueueItem[];
  active: LoginQueueItem | null;
  callback_url: string;
};

export type LocalBrowserLoginHelperStatus = {
  ok: boolean;
  status: 'ready' | 'starting' | 'failed' | 'unsupported' | string;
  message: string;
  backend_os?: string;
  backend_platform?: string;
  auto_start_supported?: boolean;
  helper_url?: string;
  helper_healthy?: boolean;
  failure_reason?: string;
  retry_after_ms?: number;
};

export type LoginQueueParseItem = {
  label: string;
};

export type LoginQueueParseSkipped = {
  reason: string;
};

export type LoginQueueParseResponse = {
  items: LoginQueueParseItem[];
  duplicates: LoginQueueParseItem[];
  skipped: LoginQueueParseSkipped[];
  sensitive_fields_removed: number;
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
  heatmap?: DashboardHeatmap;
  recent_tasks: DashboardTask[];
  templates: Array<{
    name: string;
    description: string;
    payload: Record<string, unknown>;
  }>;
  compliance_notes: string[];
};

export type DashboardHeatmapCell = {
  date: string;
  hour: number;
  count: number;
  media_count: number;
  task_count: number;
};

export type DashboardHeatmap = {
  metric: string;
  granularity: string;
  days: number;
  source: 'local' | 'external';
  dates: string[];
  hours: number[];
  max_count: number;
  total: number;
  cells: DashboardHeatmapCell[];
};

export type DashboardHeatmapItem = {
  source: 'local' | 'external';
  task_id: number;
  task_title?: string | null;
  task_type?: string | null;
  activity_at: string;
  tweet_url: string;
  display_name: string;
  screen_name: string;
  content: string;
  favorite_count: number;
  retweet_count: number;
  reply_count: number;
  media_count: number;
};

export type DashboardHeatmapItems = {
  source: 'local' | 'external';
  date: string;
  hour: number;
  total: number;
  items: DashboardHeatmapItem[];
};

export type ResultDbConfig = {
  id: number;
  label: string;
  db_type: 'postgresql' | 'mysql';
  host: string;
  port: number;
  database_name: string;
  username: string;
  ssl_enabled: boolean;
  enabled: boolean;
  status: string;
  last_tested_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  has_password: boolean;
};

export type ResultDbFormValues = {
  id?: number;
  label: string;
  db_type: 'postgresql' | 'mysql';
  host: string;
  port: number;
  database_name: string;
  username: string;
  password: string;
  ssl_enabled: boolean;
  enabled: boolean;
};

export type HealthStatus = {
  running: boolean;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_error: string | null;
  interval_seconds: number;
  accounts: Record<string, number>;
  proxies: Record<string, number>;
  resource_policy?: Record<string, number>;
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
  target_limits: TargetLimitMap;
};
