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
  created_at: string;
};

export type Task = {
  id: number;
  user_id: number;
  username: string | null;
  account_id: number | null;
  task_type: string;
  title: string;
  status: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  process_id: number | null;
  retry_count: number;
  max_retries: number;
  last_retry_at: string | null;
  last_error_type: string | null;
  config?: Record<string, unknown>;
  log?: string;
  files?: Array<{ name: string; size: number }>;
  summary?: TaskSummary;
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
  recent_tasks: Array<{
    id: number;
    title: string;
    task_type: string;
    status: string;
    created_at: string;
    target: string;
    summary: TaskSummary;
  }>;
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
