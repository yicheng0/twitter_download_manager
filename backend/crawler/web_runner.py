import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from urllib.parse import urlparse

from backend.crawler.runtime.crawler_runtime import CrawlerError, classify_exception
from backend.shared.proxy_utils import proxy_for_httpx


DEFAULT_MAX_CONCURRENT_REQUESTS = max(1, int(os.environ.get('TW_DEFAULT_MAX_CONCURRENT_REQUESTS', '2') or 2))
MAX_CONCURRENT_REQUESTS_CAP = max(DEFAULT_MAX_CONCURRENT_REQUESTS, int(os.environ.get('TW_MAX_CONCURRENT_REQUESTS_CAP', '16') or 16))


def safe_max_concurrent_requests(value):
    try:
        parsed = int(value or DEFAULT_MAX_CONCURRENT_REQUESTS)
    except (TypeError, ValueError):
        parsed = DEFAULT_MAX_CONCURRENT_REQUESTS
    return max(1, min(parsed, MAX_CONCURRENT_REQUESTS_CAP))


def parse_screen_name(value):
    text = str(value or '').strip()
    if not text:
        return ''
    text = text.splitlines()[0].strip()
    if text.startswith('@'):
        text = text[1:]
    if text.lower().startswith(('x.com/', 'twitter.com/', 'www.x.com/', 'www.twitter.com/')):
        text = 'https://' + text
    if '://' in text:
        parsed = urlparse(text)
        parts = [part for part in parsed.path.split('/') if part]
        if not parts or len(parts) > 1:
            return ''
        text = parts[0]
    else:
        text = text.split('?', 1)[0].strip('/')
        if '/' in text:
            return ''
    if text.startswith('@'):
        text = text[1:]
    if not re.match(r'^[A-Za-z0-9_]{1,15}$', text):
        return ''
    return text


def clean_list(value):
    if isinstance(value, list):
        items = value
    else:
        items = str(value or '').replace(',', '\n').splitlines()
    return [parsed for item in items if (parsed := parse_screen_name(item))]


def ensure_task_dir(path):
    os.makedirs(path, exist_ok=True)
    return os.path.abspath(path)


def default_time_range(days=365):
    end = datetime.now()
    start = end - timedelta(days=days - 1)
    return f'{start.strftime("%Y-%m-%d")}:{end.strftime("%Y-%m-%d")}'


def cookie_from_account(account):
    cookie = account.get('cookie') or ''
    if cookie:
        return cookie
    auth_token = account.get('auth_token') or ''
    ct0 = account.get('ct0') or ''
    if not auth_token or not ct0:
        raise RuntimeError('X account session is missing auth_token or ct0.')
    return f'auth_token={auth_token}; ct0={ct0};'


def run_user_media(config, cookie, output_dir):
    from backend.crawler import main as media_main
    from backend.crawler.runtime.user_info import User_info

    proxy = proxy_for_httpx(config.get('proxy'))
    users = clean_list(config.get('targets'))
    if not users:
        raise RuntimeError('At least one user name is required.')

    time_range = config.get('time_range') or default_time_range()
    start_time, end_time = time_range.split(':')

    media_main.settings['save_path'] = output_dir + os.sep
    media_main.settings['user_lst'] = ','.join(users)
    media_main.settings['cookie'] = cookie
    media_main.settings['has_retweet'] = bool(config.get('has_retweet'))
    media_main.settings['high_lights'] = bool(config.get('high_lights'))
    media_main.settings['likes'] = bool(config.get('likes'))
    media_main.settings['time_range'] = time_range
    media_main.settings['down_log'] = bool(config.get('down_log'))
    media_main.settings['autoSync'] = bool(config.get('auto_sync'))
    media_main.settings['image_format'] = config.get('image_format') or 'orig'
    media_main.settings['has_video'] = bool(config.get('has_video', True))
    media_main.settings['log_output'] = True
    media_main.settings['max_concurrent_requests'] = safe_max_concurrent_requests(config.get('max_concurrent_requests'))
    media_main.settings['proxy'] = proxy or ''
    media_main.settings['md_output'] = bool(config.get('md_output'))
    media_main.settings['media_count_limit'] = int(config.get('media_count_limit') or 350)

    media_main._headers['cookie'] = cookie
    media_main.has_retweet = False
    media_main.has_highlights = bool(config.get('high_lights'))
    media_main.has_likes = False
    if media_main.has_likes:
        media_main.has_retweet = True
        media_main.has_highlights = False
    if media_main.has_highlights:
        media_main.has_retweet = False
    media_main.has_video = bool(config.get('has_video', True))
    media_main.log_output = True
    media_main.down_log = bool(config.get('down_log'))
    media_main.autoSync = bool(config.get('auto_sync'))
    media_main.max_concurrent_requests = safe_max_concurrent_requests(config.get('max_concurrent_requests'))
    media_main.proxies = proxy
    media_main.md_output = bool(config.get('md_output'))
    media_main.media_count_limit = int(config.get('media_count_limit') or 350)
    media_main.orig_format = (config.get('image_format') or 'orig') == 'orig'
    media_main.img_format = 'jpg' if media_main.orig_format else config.get('image_format')
    media_main.start_time_stamp = media_main.time2stamp(start_time)
    media_main.end_time_stamp = media_main.time2stamp(end_time)
    media_main.backup_stamp = media_main.start_time_stamp
    media_main.request_count = 0
    media_main.down_count = 0
    media_main.request_budget = None
    if int(config.get('api_budget') or 0):
        from backend.crawler.runtime.crawler_runtime import RequestBudget

        media_main.request_budget = RequestBudget(int(config.get('api_budget') or 0))
        print(f'预计 API 调用预算: {media_main.request_budget.max_calls} 次', flush=True)

    started = time.time()
    for user in users:
        print(f'开始处理用户: {user}', flush=True)
        media_main.start_label = True
        media_main.First_Page = True
        media_main.main(User_info(user))
    print(f'任务完成, 耗时 {time.time() - started:.2f} 秒, API 调用 {media_main.request_count} 次, 下载 {media_main.down_count} 份文件', flush=True)


def run_search(config, cookie, output_dir):
    from backend.crawler import tag_down

    tag_down.proxy = proxy_for_httpx(config.get('proxy'))
    tag_down.cookie = cookie
    tag_down.tag = config.get('tag') or ''
    tag_down._filter = ' ' + (config.get('advanced_filter') or '')
    tag_down.down_count = int(config.get('down_count') or 50)
    tag_down.media_latest = bool(config.get('media_latest'))
    tag_down.text_down = bool(config.get('text_down'))
    tag_down.max_concurrent_requests = safe_max_concurrent_requests(config.get('max_concurrent_requests'))

    if tag_down.text_down:
        tag_down.entries_count = 20
        tag_down.product = 'Latest'
        tag_down.mode = 'text'
    else:
        tag_down.entries_count = 50
        tag_down.product = 'Media'
        tag_down.mode = 'media'
        if tag_down.media_latest:
            tag_down.entries_count = 20
            tag_down.product = 'Latest'
            tag_down.mode = 'media_latest'

    os.chdir(output_dir)
    print(f'开始搜索下载: {tag_down.tag}{tag_down._filter}', flush=True)
    tag_down.tag_down()
    print('搜索下载完成', flush=True)


def run_text(config, cookie, output_dir):
    from backend.crawler import text_down

    text_down.proxy = proxy_for_httpx(config.get('proxy'))
    users = clean_list(config.get('targets'))
    if not users:
        raise RuntimeError('At least one user name is required.')

    text_down.cookie = cookie
    text_down.user_lst = users
    text_down.time_range = config.get('time_range') or default_time_range()
    text_down.has_retweet = bool(config.get('has_retweet'))
    start_time, end_time = text_down.time_range.split(':')
    text_down.start_time_stamp = text_down.time2stamp(start_time)
    text_down.end_time_stamp = text_down.time2stamp(end_time)

    os.chdir(output_dir)
    for user in users:
        print(f'开始获取文本: {user}', flush=True)
        text_down.text_down(user)
    print('文本任务完成', flush=True)


def run_replies(config, cookie, output_dir):
    from backend.crawler import reply_down

    reply_down.proxy = proxy_for_httpx(config.get('proxy'))
    targets = config.get('targets')
    if isinstance(targets, str):
        targets = [item.strip() for item in targets.splitlines() if item.strip()]
    targets = targets or []
    if not targets:
        raise RuntimeError('At least one target user or tweet URL is required.')

    reply_down.cookie = cookie
    reply_down.target_user = targets
    reply_down.time_range = config.get('time_range') or ''
    reply_down.media_down = bool(config.get('media_down', True))
    reply_down.max_concurrent_requests = safe_max_concurrent_requests(config.get('max_concurrent_requests'))
    reply_down.min_replies = int(config.get('min_replies') or 1)
    reply_down.min_faves = int(config.get('min_faves') or 0)
    reply_down.min_retweets = int(config.get('min_retweets') or 0)
    reply_down.search_advanced = config.get('search_advanced') or ''

    os.chdir(output_dir)
    for target in targets:
        print(f'开始处理评论: {target}', flush=True)
        reply_down.Reply_down(target)
        print(f'评论处理完成: {target}', flush=True)


def run_profile(config, cookie, output_dir):
    import re
    import profile_down

    profile_down.proxy = proxy_for_httpx(config.get('proxy'))
    users = clean_list(config.get('targets'))
    if not users:
        raise RuntimeError('At least one user name is required.')

    profile_down.cookie = cookie
    profile_down._headers['cookie'] = cookie
    profile_down._headers['x-csrf-token'] = re.findall(r'ct0=(.*?);', cookie)[0]
    profile_down._path = output_dir
    os.makedirs(output_dir, exist_ok=True)
    failed = []
    for user in users:
        print(f'开始获取主页资料: {user}', flush=True)
        profile_down._headers['referer'] = 'https://twitter.com/' + user
        if not profile_down.profile_down(user, output_dir):
            failed.append(user)
    if failed and len(failed) == len(users):
        raise RuntimeError('主页资料采集失败: ' + ', '.join(failed))
    if failed:
        print('部分主页资料采集失败: ' + ', '.join(failed), flush=True)
    print('主页资料任务完成', flush=True)


def run_benchmark_account(config, cookie, output_dir):
    from backend.crawler import benchmark_down

    benchmark_down.run_benchmark_account(config, cookie, output_dir)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--account', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()

    with open(args.config, 'r', encoding='utf-8') as f:
        config = json.load(f)
    with open(args.account, 'r', encoding='utf-8') as f:
        account = json.load(f)

    # 将账号绑定的 UA 注入环境变量，供反检测请求头使用
    if account.get('user_agent'):
        os.environ['TW_ACCOUNT_UA'] = account['user_agent']
    if account.get('accept_language'):
        os.environ['TW_ACCOUNT_ACCEPT_LANGUAGE'] = account['accept_language']

    output_dir = ensure_task_dir(args.output)
    cookie = cookie_from_account(account)
    task_type = config.get('task_type')
    print(f'任务类型: {task_type}', flush=True)
    print(f'输出目录: {output_dir}', flush=True)
    print(f'开始时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}', flush=True)

    try:
        if task_type == 'user_media':
            run_user_media(config, cookie, output_dir)
        elif task_type == 'benchmark_account':
            run_benchmark_account(config, cookie, output_dir)
        elif task_type == 'search':
            run_search(config, cookie, output_dir)
        elif task_type == 'text':
            run_text(config, cookie, output_dir)
        elif task_type == 'replies':
            run_replies(config, cookie, output_dir)
        elif task_type == 'profile':
            run_profile(config, cookie, output_dir)
        else:
            raise RuntimeError(f'Unsupported task type: {task_type}')
    except CrawlerError as exc:
        print(f'CRAWLER_ERROR_TYPE={exc.error_type}', flush=True)
        print(str(exc), flush=True)
        raise
    except Exception as exc:
        print(f'CRAWLER_ERROR_TYPE={classify_exception(exc)}', flush=True)
        raise


if __name__ == '__main__':
    main()
