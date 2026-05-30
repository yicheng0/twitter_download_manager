import type { Dashboard, RunConfig, TaskFormValues, TaskType } from './types';
import { defaultRunTimeRange, defaultTaskTimeRange, rangeFromPreset } from './timeRange';

export type TaskTemplate = {
  id: string;
  name: string;
  description: string;
  task_type: TaskType;
  payload: Partial<TaskFormValues>;
  runPayload: Partial<RunConfig>;
  targetPath: '/run' | '/tasks/new';
};

const baseForm = {
  task_type: 'user_media' as TaskType,
  account_id: 0,
  targets: '',
  time_range: defaultTaskTimeRange(),
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
  text_down: false,
  media_down: true,
  min_replies: 1,
  min_faves: 0,
  min_retweets: 0,
  search_advanced: '',
};

export function createTaskTemplatePayload(overrides: Partial<TaskFormValues>): Partial<TaskFormValues> {
  return { ...baseForm, ...overrides };
}

export const taskTemplates: TaskTemplate[] = [
  {
    id: 'benchmark-account',
    name: '账号近况采集',
    description: '粘贴账号主页链接，抓取最近推文文本、互动数据和媒体。',
    task_type: 'benchmark_account',
    targetPath: '/tasks/new',
    payload: createTaskTemplatePayload({
      task_type: 'benchmark_account',
      targets: 'https://x.com/elonmusk',
      tweet_limit: 10,
      has_video: true,
      has_retweet: false,
      time_range: defaultTaskTimeRange(),
    }),
    runPayload: {
      user_lst: '',
      time_range: defaultRunTimeRange(),
      has_retweet: false,
      down_log: false,
      autoSync: false,
      image_format: 'orig',
      has_video: true,
      max_concurrent_requests: 2,
      md_output: false,
      media_count_limit: 350,
    },
  },
  {
    id: 'focus-account',
    name: '重点账号采集',
    description: '按用户名采集推文媒体与互动指标，适合重点账号归档。',
    task_type: 'user_media',
    targetPath: '/tasks/new',
    payload: createTaskTemplatePayload({
      task_type: 'user_media',
      targets: 'elonmusk',
      has_video: true,
      md_output: true,
      down_log: true,
      max_concurrent_requests: 2,
      time_range: defaultTaskTimeRange(),
    }),
    runPayload: {
      user_lst: 'elonmusk',
      time_range: defaultRunTimeRange(),
      has_retweet: false,
      down_log: true,
      autoSync: false,
      image_format: 'orig',
      has_video: true,
      max_concurrent_requests: 2,
      md_output: true,
      media_count_limit: 350,
    },
  },
  {
    id: 'keyword-watch',
    name: '关键词舆情',
    description: '按关键词或高级搜索语法采集最新内容，适合热点跟踪。',
    task_type: 'search',
    targetPath: '/tasks/new',
    payload: createTaskTemplatePayload({
      task_type: 'search',
      tag: 'AI',
      advanced_filter: 'lang:zh min_faves:5',
      media_latest: true,
      down_count: 50,
      max_concurrent_requests: 2,
    }),
    runPayload: {
      user_lst: '',
      time_range: rangeFromPreset('30d'),
      has_retweet: false,
      down_log: false,
      autoSync: false,
      image_format: 'orig',
      has_video: true,
      max_concurrent_requests: 2,
      md_output: false,
      media_count_limit: 350,
    },
  },
  {
    id: 'reply-insight',
    name: '评论区洞察',
    description: '围绕指定推文或用户抓取评论，适合观察争议点和反馈。',
    task_type: 'replies',
    targetPath: '/tasks/new',
    payload: createTaskTemplatePayload({
      task_type: 'replies',
      targets: 'https://x.com/user/status/1234567890',
      media_down: true,
      min_replies: 1,
      min_faves: 0,
      min_retweets: 0,
    }),
    runPayload: {
      user_lst: '',
      time_range: defaultTaskTimeRange(),
      has_retweet: false,
      down_log: false,
      autoSync: false,
      image_format: 'orig',
      has_video: true,
      max_concurrent_requests: 2,
      md_output: false,
      media_count_limit: 350,
    },
  },
  {
    id: 'profile-archive',
    name: '主页资料归档',
    description: '采集头像、banner 和简介，适合建立账号基础资料库。',
    task_type: 'profile',
    targetPath: '/tasks/new',
    payload: createTaskTemplatePayload({
      task_type: 'profile',
      targets: 'x',
      max_concurrent_requests: 2,
    }),
    runPayload: {
      user_lst: 'x',
      time_range: defaultRunTimeRange(),
      has_retweet: false,
      down_log: false,
      autoSync: false,
      image_format: 'orig',
      has_video: true,
      max_concurrent_requests: 2,
      md_output: false,
      media_count_limit: 350,
    },
  },
];

export function normalizeTaskTemplateName(value: string | null) {
  return (value || '').trim();
}

export function getTaskTemplateById(id: string | null) {
  if (!id) return null;
  return taskTemplates.find((template) => template.id === id) || null;
}

export function taskTemplatesForDashboard(): Dashboard['templates'] {
  return taskTemplates.map((template) => ({
    name: template.name,
    description: template.description,
    payload: template.payload as Record<string, unknown>,
  }));
}
