import asyncio
import csv
import hashlib
import json
import os
import re
import signal
import secrets
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from threading import Thread

import httpx
from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from proxy_utils import normalize_proxy_url, redact_proxy_url as redact_proxy_value


BASE_DIR = Path(__file__).resolve().parent


def configured_data_dir():
    value = os.environ.get('TW_WEB_DATA_DIR', '').strip()
    if not value:
        return BASE_DIR / 'web_data'
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = BASE_DIR / path
    return path.resolve()


PUBLIC_MODE = os.environ.get('TW_WEB_PUBLIC', '').lower() in {'1', 'true', 'yes', 'on'}
SESSION_SECRET = os.environ.get('TW_WEB_SESSION_SECRET', 'dev-session-secret-change-me')
DATA_DIR = configured_data_dir()
TASKS_DIR = DATA_DIR / 'tasks'
DB_PATH = DATA_DIR / 'web.sqlite3'
DEFAULT_ADMIN_USER = os.environ.get('TW_WEB_ADMIN_USER', 'admin')
DEFAULT_ADMIN_PASSWORD = os.environ.get('TW_WEB_ADMIN_PASSWORD', 'admin123')
BROWSER_LOGIN_DISABLED = os.environ.get('TW_WEB_ENABLE_BROWSER_LOGIN', '').lower() in {'0', 'false', 'no', 'off'}
INTERNAL_USER = {'id': 1, 'username': DEFAULT_ADMIN_USER, 'role': 'admin'}

app = FastAPI(title='Twitter Download Web')
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    session_cookie='tw_web_session',
    same_site='lax',
    https_only=PUBLIC_MODE,
    max_age=60 * 60 * 24 * 7,
)
app.mount('/static', StaticFiles(directory=str(BASE_DIR / 'static')), name='static')
if (BASE_DIR / 'frontend' / 'dist' / 'assets').exists():
    app.mount('/assets', StaticFiles(directory=str(BASE_DIR / 'frontend' / 'dist' / 'assets')), name='frontend-assets')
templates = Jinja2Templates(directory=str(BASE_DIR / 'templates'))

worker_lock = threading.Lock()
worker_thread = None
worker_threads = []
stop_worker = False

health_lock = threading.Lock()
health_thread = None
stop_health_worker = False
schedule_lock = threading.Lock()
schedule_thread = None
stop_schedule_worker = False
BROWSER_LOGIN_TIMEOUT_SECONDS = 300
browser_login_lock = asyncio.Lock()
browser_login_session = None
LOCAL_BROWSER_LOGIN_TIMEOUT_SECONDS = 300
local_browser_login_sessions = {}
local_browser_login_lock = threading.Lock()
ACCOUNT_NEW_TASK_LIMIT_24H = 3
ACCOUNT_STABLE_TASK_LIMIT_24H = 20
ACCOUNT_MIN_INTERVAL_SECONDS = 10 * 60
ACCOUNT_NEW_MIN_INTERVAL_SECONDS = 30 * 60
ACCOUNT_RATE_LIMIT_COOLDOWN_SECONDS = 6 * 60 * 60
ACCOUNT_TRANSIENT_COOLDOWN_SECONDS = 30 * 60
PROXY_MIN_INTERVAL_SECONDS = 3 * 60
PROXY_FAILURE_COOLDOWN_SECONDS = 30 * 60
PROXY_RATE_LIMIT_COOLDOWN_SECONDS = 2 * 60 * 60


def browser_login_available():
    return not BROWSER_LOGIN_DISABLED


def browser_login_preferred_mode():
    mode = os.environ.get('TW_WEB_BROWSER_LOGIN_MODE', 'auto').strip().lower()
    if mode in {'local', 'remote'}:
        return mode
    if os.name == 'nt' and not PUBLIC_MODE:
        return 'local'
    return 'remote'


def local_chrome_executable():
    explicit = os.environ.get('TW_WEB_CHROME_PATH', '').strip()
    candidates = [explicit] if explicit else []
    if os.name == 'nt':
        candidates.extend(
            [
                os.path.join(os.environ.get('PROGRAMFILES', ''), 'Google', 'Chrome', 'Application', 'chrome.exe'),
                os.path.join(os.environ.get('PROGRAMFILES(X86)', ''), 'Google', 'Chrome', 'Application', 'chrome.exe'),
                os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Google', 'Chrome', 'Application', 'chrome.exe'),
                os.path.join(os.environ.get('PROGRAMFILES', ''), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                os.path.join(os.environ.get('PROGRAMFILES(X86)', ''), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            ]
        )
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def public_base_url(request: Request):
    proto = request.headers.get('x-forwarded-proto') or request.url.scheme
    host = request.headers.get('x-forwarded-host') or request.headers.get('host') or request.url.netloc
    return f'{proto}://{host}'.rstrip('/')


def cleanup_local_browser_login_sessions():
    now_ts = time.time()
    for token, session in list(local_browser_login_sessions.items()):
        if now_ts > session['expires_at'] and session['status'] in {'pending', 'running'}:
            session['status'] = 'expired'
            session['message'] = '本地 Chrome 授权登录已超时，请重新开始。'
        if now_ts - session['expires_at'] > 600:
            local_browser_login_sessions.pop(token, None)


def local_browser_login_payload(token):
    cleanup_local_browser_login_sessions()
    session = local_browser_login_sessions.get(token)
    if not session:
        raise HTTPException(status_code=404, detail='本地授权登录已不存在或已过期')
    return {
        'status': session['status'],
        'message': session['message'],
        'token': token,
        'expires_in': max(0, int(session['expires_at'] - time.time())),
        'screen_name': session.get('screen_name') or '',
    }
HEALTH_CHECK_INTERVAL = int(os.environ.get('TW_WEB_HEALTH_INTERVAL', '900') or 900)
TASK_RETRY_DELAY_SECONDS = int(os.environ.get('TW_WEB_RETRY_DELAY_SECONDS', '30') or 30)
WORKER_CONCURRENCY = max(1, int(os.environ.get('TW_WORKER_CONCURRENCY', '2') or 2))
SQLITE_BUSY_TIMEOUT_MS = max(1000, int(os.environ.get('TW_SQLITE_BUSY_TIMEOUT_MS', '5000') or 5000))
TASK_LEASE_TIMEOUT_SECONDS = max(60, int(os.environ.get('TW_TASK_LEASE_TIMEOUT_SECONDS', '300') or 300))
TASK_HEARTBEAT_SECONDS = max(5, int(os.environ.get('TW_TASK_HEARTBEAT_SECONDS', '15') or 15))
health_state = {
    'running': False,
    'last_started_at': None,
    'last_finished_at': None,
    'last_error': None,
    'interval_seconds': HEALTH_CHECK_INTERVAL,
}
ACCOUNT_USABLE_STATUSES = ('active', 'unknown', 'check_failed')
ACCOUNT_EXPIRED_STATUS = 'expired'
ACCOUNT_UNKNOWN_STATUS = 'unknown'
ACCOUNT_CHECK_FAILED_STATUS = 'check_failed'
AUTH_FAILURE_STATUS_CODES = {401, 403}
TRANSIENT_CHECK_STATUS_CODES = {404, 408, 409, 429, 500, 502, 503, 504}

run_lock = threading.Lock()
run_process = None
run_state = {
    'status': 'idle',
    'started_at': None,
    'ended_at': None,
    'return_code': None,
    'logs': [],
    'log_version': 0,
    'summary': {'elapsed': None, 'api_calls': 0, 'downloads': 0},
    'output_path': '',
    'message': '等待启动',
}


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(f'pragma busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}')
    return conn


def now():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def seconds_from_now(seconds):
    return (datetime.now() + timedelta(seconds=seconds)).strftime('%Y-%m-%d %H:%M:%S')


def default_time_range(days=365):
    end = datetime.now()
    start = end - timedelta(days=days - 1)
    return f'{start.strftime("%Y-%m-%d")}:{end.strftime("%Y-%m-%d")}'


def task_default_time_range():
    return default_time_range(90)


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 200000).hex()
    return f'{salt}${digest}'


def verify_password(password, stored):
    try:
        salt, expected = stored.split('$', 1)
    except ValueError:
        return False
    return password_hash(password, salt).split('$', 1)[1] == expected


def enforce_public_startup_safety():
    if not PUBLIC_MODE:
        return
    if DEFAULT_ADMIN_PASSWORD == 'admin123':
        raise RuntimeError('TW_WEB_PUBLIC=1 requires changing TW_WEB_ADMIN_PASSWORD from the default value.')
    if SESSION_SECRET == 'dev-session-secret-change-me' or len(SESSION_SECRET) < 32:
        raise RuntimeError('TW_WEB_PUBLIC=1 requires TW_WEB_SESSION_SECRET to be a random string of at least 32 characters.')


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TASKS_DIR.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        try:
            conn.execute('pragma journal_mode = wal')
            conn.execute('pragma synchronous = normal')
        except sqlite3.DatabaseError:
            pass
        conn.executescript(
            '''
            create table if not exists users (
                id integer primary key autoincrement,
                username text unique not null,
                password_hash text not null,
                role text not null default 'user',
                created_at text not null
            );
            create table if not exists accounts (
                id integer primary key autoincrement,
                label text not null,
                auth_token text not null,
                ct0 text not null,
                cookie text not null,
                screen_name text,
                status text not null default 'active',
                last_checked_at text,
                created_at text not null
            );
            create table if not exists proxies (
                id integer primary key autoincrement,
                label text not null,
                proxy text not null,
                enabled integer not null default 1,
                status text not null default 'active',
                last_checked_at text,
                last_error text,
                created_at text not null
            );
            create table if not exists tasks (
                id integer primary key autoincrement,
                user_id integer not null,
                account_id integer,
                task_type text not null,
                title text not null,
                config_json text not null,
                status text not null,
                output_dir text not null,
                log_path text not null,
                error text,
                created_at text not null,
                started_at text,
                finished_at text,
                process_id integer
            );
            create table if not exists scheduled_tasks (
                id integer primary key autoincrement,
                user_id integer not null,
                account_id integer not null,
                name text not null,
                enabled integer not null default 1,
                schedule_type text not null,
                run_time text not null,
                weekdays text,
                config_json text not null,
                next_run_at text,
                last_run_at text,
                last_task_id integer,
                created_at text not null,
                updated_at text not null
            );
            create table if not exists operation_logs (
                id integer primary key autoincrement,
                created_at text not null,
                level text not null,
                event_type text not null,
                task_id integer,
                schedule_id integer,
                error_type text,
                message text not null,
                details_json text
            );
            create table if not exists task_items (
                id integer primary key autoincrement,
                task_id integer not null,
                source_file text,
                tweet_url text,
                tweet_date text,
                display_name text,
                screen_name text,
                content text,
                favorite_count integer not null default 0,
                retweet_count integer not null default 0,
                reply_count integer not null default 0,
                media_count integer not null default 0,
                created_at text not null,
                unique(task_id, tweet_url, content)
            );
            create table if not exists media_assets (
                id integer primary key autoincrement,
                task_id integer not null,
                task_item_id integer,
                source_file text,
                tweet_url text,
                media_type text,
                media_url text,
                file_path text,
                file_name text,
                status text not null default 'indexed',
                error text,
                byte_size integer not null default 0,
                created_at text not null,
                unique(task_id, media_url, file_path)
            );
            '''
        )
        existing = conn.execute('select id from users where username = ?', (DEFAULT_ADMIN_USER,)).fetchone()
        if not existing:
            conn.execute(
                'insert into users (username, password_hash, role, created_at) values (?, ?, ?, ?)',
                (DEFAULT_ADMIN_USER, password_hash(DEFAULT_ADMIN_PASSWORD), 'admin', now()),
            )
        ensure_column(conn, 'accounts', 'last_error', 'text')
        ensure_column(conn, 'proxies', 'detected_ip', 'text')
        ensure_column(conn, 'proxies', 'failure_count', 'integer not null default 0')
        ensure_column(conn, 'accounts', 'success_count', 'integer not null default 0')
        ensure_column(conn, 'accounts', 'failure_count', 'integer not null default 0')
        ensure_column(conn, 'accounts', 'task_count', 'integer not null default 0')
        ensure_column(conn, 'accounts', 'last_used_at', 'text')
        ensure_column(conn, 'accounts', 'cooldown_until', 'text')
        ensure_column(conn, 'accounts', 'tier', "text not null default 'new'")
        ensure_column(conn, 'proxies', 'success_count', 'integer not null default 0')
        ensure_column(conn, 'proxies', 'last_used_at', 'text')
        ensure_column(conn, 'proxies', 'cooldown_until', 'text')
        ensure_column(conn, 'tasks', 'retry_count', 'integer not null default 0')
        ensure_column(conn, 'tasks', 'max_retries', 'integer not null default 2')
        ensure_column(conn, 'tasks', 'last_retry_at', 'text')
        ensure_column(conn, 'tasks', 'last_error_type', 'text')
        ensure_column(conn, 'tasks', 'proxy_id', 'integer')
        ensure_column(conn, 'tasks', 'resource_mode', "text not null default 'manual'")
        ensure_column(conn, 'tasks', 'schedule_id', 'integer')
        ensure_column(conn, 'tasks', 'locked_by', 'text')
        ensure_column(conn, 'tasks', 'locked_at', 'text')
        ensure_column(conn, 'tasks', 'heartbeat_at', 'text')
        ensure_column(conn, 'tasks', 'progress_total', 'integer not null default 0')
        ensure_column(conn, 'tasks', 'progress_done', 'integer not null default 0')
        ensure_column(conn, 'tasks', 'api_calls', 'integer not null default 0')
        ensure_column(conn, 'tasks', 'download_count', 'integer not null default 0')
        ensure_column(conn, 'scheduled_tasks', 'proxy_id', 'integer')
        conn.execute('create index if not exists idx_tasks_queue on tasks(status, last_retry_at, id)')
        conn.execute('create index if not exists idx_tasks_lease on tasks(status, heartbeat_at)')
        conn.execute('create index if not exists idx_task_items_task on task_items(task_id)')
        conn.execute('create index if not exists idx_media_assets_task on media_assets(task_id)')
        conn.execute('create index if not exists idx_media_assets_url on media_assets(media_url)')


def ensure_column(conn, table, column, definition):
    existing = {row['name'] for row in conn.execute(f'pragma table_info({table})').fetchall()}
    if column not in existing:
        conn.execute(f'alter table {table} add column {column} {definition}')


def find_user(username):
    with db() as conn:
        return conn.execute('select * from users where username = ?', (username,)).fetchone()


def user_by_id(user_id):
    with db() as conn:
        return conn.execute('select * from users where id = ?', (user_id,)).fetchone()


def current_user(request: Request):
    user_id = request.session.get('user_id')
    if not user_id:
        return None
    return user_by_id(user_id)


def require_user(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail='请先登录')
    return user


def require_admin(request: Request):
    user = require_user(request)
    if user['role'] != 'admin':
        raise HTTPException(status_code=403, detail='需要管理员权限')
    return user


def require_api_user(request: Request):
    return require_user(request)


def require_api_admin(request: Request):
    return require_admin(request)


def row_to_dict(row):
    return dict(row) if row else None


def user_payload(user):
    return {'id': user['id'], 'username': user['username'], 'role': user['role']}


def account_payload(account):
    return {
        'id': account['id'],
        'label': account['label'],
        'screen_name': account['screen_name'],
        'status': account['status'],
        'last_checked_at': account['last_checked_at'],
        'last_error': account['last_error'] if 'last_error' in account.keys() else None,
        'success_count': account['success_count'] if 'success_count' in account.keys() else 0,
        'failure_count': account['failure_count'] if 'failure_count' in account.keys() else 0,
        'task_count': account['task_count'] if 'task_count' in account.keys() else 0,
        'last_used_at': account['last_used_at'] if 'last_used_at' in account.keys() else None,
        'cooldown_until': account['cooldown_until'] if 'cooldown_until' in account.keys() else None,
        'tier': account['tier'] if 'tier' in account.keys() else 'new',
        'created_at': account['created_at'],
    }


def proxy_payload(proxy):
    return {
        'id': proxy['id'],
        'label': proxy['label'],
        'proxy': redact_proxy_url(proxy['proxy']),
        'enabled': bool(proxy['enabled']),
        'status': proxy['status'],
        'last_checked_at': proxy['last_checked_at'],
        'last_error': proxy['last_error'],
        'detected_ip': proxy['detected_ip'] if 'detected_ip' in proxy.keys() else None,
        'failure_count': proxy['failure_count'] if 'failure_count' in proxy.keys() else 0,
        'success_count': proxy['success_count'] if 'success_count' in proxy.keys() else 0,
        'last_used_at': proxy['last_used_at'] if 'last_used_at' in proxy.keys() else None,
        'cooldown_until': proxy['cooldown_until'] if 'cooldown_until' in proxy.keys() else None,
        'created_at': proxy['created_at'],
    }


def task_payload(task, include_config=False, include_log=False, include_files=False, include_preview=False):
    summary = task_summary(task)
    indexed_counts = task_index_counts(task['id'])
    payload = {
        'id': task['id'],
        'user_id': task['user_id'],
        'username': task['username'] if 'username' in task.keys() else None,
        'account_id': task['account_id'],
        'proxy_id': task['proxy_id'] if 'proxy_id' in task.keys() else None,
        'schedule_id': task['schedule_id'] if 'schedule_id' in task.keys() else None,
        'resource_mode': task['resource_mode'] if 'resource_mode' in task.keys() else 'manual',
        'task_type': task['task_type'],
        'title': task['title'],
        'status': task['status'],
        'error': task['error'],
        'created_at': task['created_at'],
        'started_at': task['started_at'],
        'finished_at': task['finished_at'],
        'process_id': task['process_id'],
        'locked_by': task['locked_by'] if 'locked_by' in task.keys() else None,
        'locked_at': task['locked_at'] if 'locked_at' in task.keys() else None,
        'heartbeat_at': task['heartbeat_at'] if 'heartbeat_at' in task.keys() else None,
        'progress_total': task['progress_total'] if 'progress_total' in task.keys() else 0,
        'progress_done': task['progress_done'] if 'progress_done' in task.keys() else 0,
        'api_calls': task['api_calls'] if 'api_calls' in task.keys() else 0,
        'download_count': task['download_count'] if 'download_count' in task.keys() else 0,
        'progress': {
            'total': task['progress_total'] if 'progress_total' in task.keys() else 0,
            'done': task['progress_done'] if 'progress_done' in task.keys() else 0,
        },
        'worker_id': task['locked_by'] if 'locked_by' in task.keys() else None,
        'indexed_counts': indexed_counts,
        'retry_count': task['retry_count'] if 'retry_count' in task.keys() else 0,
        'max_retries': task['max_retries'] if 'max_retries' in task.keys() else 2,
        'last_retry_at': task['last_retry_at'] if 'last_retry_at' in task.keys() else None,
        'last_error_type': task['last_error_type'] if 'last_error_type' in task.keys() else None,
        'summary': summary,
    }
    if include_config:
        try:
            payload['config'] = public_config(json.loads(task['config_json']))
        except Exception:
            payload['config'] = {}
    if include_log:
        payload['log'] = read_log(task['log_path'])
    if include_files:
        payload['files'] = task_files(task)
    if include_preview:
        payload['preview'] = task_preview(task)
    return payload


def redact_sensitive(value):
    if not value:
        return ''
    text = str(value)
    text = re.sub(r'(auth_token=)[^;\s]+', r'\1[已隐藏]', text)
    text = re.sub(r'(ct0=)[^;\s]+', r'\1[已隐藏]', text)
    text = re.sub(r'("auth_token"\s*:\s*")[^"]+', r'\1[已隐藏]', text)
    text = re.sub(r'("ct0"\s*:\s*")[^"]+', r'\1[已隐藏]', text)
    text = re.sub(r'("cookie"\s*:\s*")[^"]+', r'\1[已隐藏]', text)
    return redact_proxy_value(text)


def redact_proxy_url(proxy_url):
    if not proxy_url:
        return ''
    return redact_proxy_value(proxy_url)


def public_config(config):
    clean = dict(config or {})
    for key in ['cookie', 'auth_token', 'ct0']:
        if key in clean and clean[key]:
            clean[key] = '[已隐藏]'
    if clean.get('proxy'):
        clean['proxy'] = redact_proxy_url(clean['proxy'])
    return clean


def safe_details(details):
    if not details:
        return {}
    try:
        text = redact_sensitive(json.dumps(details, ensure_ascii=False, default=str))
        return json.loads(text)
    except Exception:
        return {'value': redact_sensitive(str(details))}


def append_operation_log(level, event_type, message, task_id=None, schedule_id=None, error_type=None, details=None):
    with db() as conn:
        conn.execute(
            '''
            insert into operation_logs (created_at, level, event_type, task_id, schedule_id, error_type, message, details_json)
            values (?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                now(),
                level,
                event_type,
                task_id,
                schedule_id,
                error_type,
                redact_sensitive(message),
                json.dumps(safe_details(details), ensure_ascii=False),
            ),
        )


def operation_log_payload(row):
    try:
        details = json.loads(row['details_json'] or '{}')
    except Exception:
        details = {}
    return {
        'id': row['id'],
        'created_at': row['created_at'],
        'level': row['level'],
        'event_type': row['event_type'],
        'task_id': row['task_id'],
        'schedule_id': row['schedule_id'],
        'error_type': row['error_type'],
        'message': row['message'],
        'details': details,
    }


def task_target_label(config):
    target = config.get('targets') or config.get('tag') or config.get('advanced_filter') or config.get('search_advanced') or ''
    if isinstance(target, list):
        target = ', '.join(str(item) for item in target)
    return str(target).replace('\r', ' ').replace('\n', ' ').strip() or '未填写'


def task_files(task):
    output_dir = Path(task['output_dir'])
    files = []
    if output_dir.exists():
        for path in sorted(output_dir.rglob('*')):
            if path.is_file() and path.name not in {'account_session.json', 'task_config.json'} and not path.name.startswith('task-'):
                files.append({'name': str(path.relative_to(output_dir)), 'size': path.stat().st_size})
    return files


def locate_csv_header(rows):
    known = {'Tweet URL', 'Reply URL', 'Media URL', 'Favorite Count', 'Reply Favorite Count', 'Tweet Content', 'Reply Content'}
    for index, row in enumerate(rows):
        if known.intersection(set(row)):
            return index, row
    return None, []


def number_from_row(row, headers, names):
    for name in names:
        if name in headers:
            try:
                return int(float(row[headers.index(name)] or 0))
            except Exception:
                return 0
    return 0


def csv_summary(output_dir):
    rows_count = 0
    media_rows = 0
    favorites = 0
    retweets = 0
    replies = 0
    urls = {}
    csv_files = []
    for path in sorted(Path(output_dir).rglob('*.csv')):
        csv_files.append(path)
        try:
            with open(path, 'r', encoding='utf-8-sig', errors='replace', newline='') as f:
                rows = list(csv.reader(f))
        except Exception:
            continue
        header_index, headers = locate_csv_header(rows)
        if header_index is None:
            continue
        for row in rows[header_index + 1:]:
            if not row or len(row) < len(headers):
                continue
            rows_count += 1
            if 'Media URL' in headers and row[headers.index('Media URL')]:
                media_rows += 1
            favorites += number_from_row(row, headers, ['Favorite Count', 'Reply Favorite Count'])
            retweets += number_from_row(row, headers, ['Retweet Count', 'Reply Retweet Count'])
            replies += number_from_row(row, headers, ['Reply Count', 'Reply Reply Count'])
            url = ''
            for field in ['Tweet URL', 'Reply URL', 'Parent Tweet URL']:
                if field in headers:
                    url = row[headers.index(field)]
                    break
            score = number_from_row(row, headers, ['Favorite Count', 'Reply Favorite Count']) + number_from_row(row, headers, ['Retweet Count', 'Reply Retweet Count']) + number_from_row(row, headers, ['Reply Count', 'Reply Reply Count'])
            if url:
                urls[url] = max(urls.get(url, 0), score)
    top_urls = [url for url, _ in sorted(urls.items(), key=lambda item: item[1], reverse=True)[:5]]
    return {
        'csv_files': len(csv_files),
        'records': rows_count,
        'media_records': media_rows,
        'favorites': favorites,
        'retweets': retweets,
        'replies': replies,
        'top_urls': top_urls,
    }


def task_preview(task, limit=100):
    output_dir = Path(task['output_dir'])
    preview = {
        'headers': [],
        'rows': [],
        'total': 0,
        'csv_files': 0,
    }
    if not output_dir.exists():
        return preview

    headers_seen = []
    rows_preview = []
    for path in sorted(output_dir.rglob('*.csv')):
        preview['csv_files'] += 1
        try:
            with open(path, 'r', encoding='utf-8-sig', errors='replace', newline='') as f:
                rows = list(csv.reader(f))
        except Exception:
            continue

        header_index, headers = locate_csv_header(rows)
        if header_index is None:
            continue

        for header in headers:
            if header and header not in headers_seen:
                headers_seen.append(header)

        for row in rows[header_index + 1:]:
            if not row or not any(str(cell).strip() for cell in row):
                continue
            preview['total'] += 1
            item = {}
            for index, header in enumerate(headers):
                if not header:
                    continue
                item[header] = row[index] if index < len(row) else ''
            rows_preview.append(item)
            if len(rows_preview) > limit:
                rows_preview = rows_preview[-limit:]

    preview['headers'] = headers_seen
    preview['rows'] = rows_preview
    return preview


def task_summary(task):
    output_dir = Path(task['output_dir'])
    files = task_files(task)
    csv_data = csv_summary(output_dir) if output_dir.exists() else {
        'csv_files': 0,
        'records': 0,
        'media_records': 0,
        'favorites': 0,
        'retweets': 0,
        'replies': 0,
        'top_urls': [],
    }
    media_exts = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov'}
    media_files = [item for item in files if Path(item['name']).suffix.lower() in media_exts]
    return {
        **csv_data,
        'files': len(files),
        'media_files': len(media_files),
        'total_bytes': sum(item['size'] for item in files),
    }


def task_index_counts(task_id):
    try:
        with db() as conn:
            items = conn.execute('select count(*) as count from task_items where task_id = ?', (task_id,)).fetchone()
            media = conn.execute('select count(*) as count from media_assets where task_id = ?', (task_id,)).fetchone()
        return {
            'items': int(items['count'] if items else 0),
            'media_assets': int(media['count'] if media else 0),
        }
    except Exception:
        return {'items': 0, 'media_assets': 0}


def int_from_cell(value):
    try:
        return int(str(value or '').replace(',', '').strip() or 0)
    except ValueError:
        return 0


def first_existing(row, *names):
    for name in names:
        if name in row and row[name]:
            return row[name]
    return ''


def index_task_outputs(task):
    output_dir = Path(task['output_dir'])
    if not output_dir.exists():
        return {'items': 0, 'media_assets': 0}
    csv_paths = sorted(output_dir.rglob('*.csv'))
    with db() as conn:
        conn.execute('delete from media_assets where task_id = ?', (task['id'],))
        conn.execute('delete from task_items where task_id = ?', (task['id'],))
        item_count = 0
        media_count = 0
        for path in csv_paths:
            try:
                with open(path, newline='', encoding='utf-8-sig', errors='replace') as f:
                    reader = csv.reader(f)
                    headers = None
                    for raw_row in reader:
                        if not raw_row:
                            continue
                        if headers is None:
                            if 'Tweet URL' in raw_row or 'Tweet Content' in raw_row:
                                headers = raw_row
                            continue
                        row = {headers[index]: raw_row[index] if index < len(raw_row) else '' for index in range(len(headers))}
                        tweet_url = first_existing(row, 'Tweet URL')
                        content = first_existing(row, 'Tweet Content')
                        if not tweet_url and not content:
                            continue
                        cursor = conn.execute(
                            '''
                            insert or ignore into task_items
                              (task_id, source_file, tweet_url, tweet_date, display_name, screen_name, content,
                               favorite_count, retweet_count, reply_count, media_count, created_at)
                            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                            ''',
                            (
                                task['id'],
                                str(path.relative_to(output_dir)),
                                tweet_url,
                                first_existing(row, 'Tweet Date'),
                                first_existing(row, 'Display Name'),
                                first_existing(row, 'User Name'),
                                content,
                                int_from_cell(first_existing(row, 'Favorite Count')),
                                int_from_cell(first_existing(row, 'Retweet Count')),
                                int_from_cell(first_existing(row, 'Reply Count')),
                                now(),
                            ),
                        )
                        if cursor.rowcount:
                            item_id = cursor.lastrowid
                            item_count += 1
                        else:
                            existing = conn.execute(
                                'select id from task_items where task_id = ? and tweet_url = ? and content = ?',
                                (task['id'], tweet_url, content),
                            ).fetchone()
                            item_id = existing['id'] if existing else None
                        media_url = first_existing(row, 'Media URL')
                        saved_path = first_existing(row, 'Saved Path', 'Saved Filename')
                        media_type = first_existing(row, 'Media Type')
                        if media_url or saved_path:
                            file_path = Path(saved_path) if saved_path else None
                            if file_path and not file_path.is_absolute():
                                file_path = output_dir / saved_path
                            byte_size = file_path.stat().st_size if file_path and file_path.exists() and file_path.is_file() else 0
                            media_cursor = conn.execute(
                                '''
                                insert or ignore into media_assets
                                  (task_id, task_item_id, source_file, tweet_url, media_type, media_url, file_path, file_name, status, byte_size, created_at)
                                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                ''',
                                (
                                    task['id'],
                                    item_id,
                                    str(path.relative_to(output_dir)),
                                    tweet_url,
                                    media_type,
                                    media_url,
                                    str(file_path) if file_path else saved_path,
                                    Path(saved_path).name if saved_path else '',
                                    'downloaded' if byte_size else 'indexed',
                                    byte_size,
                                    now(),
                                ),
                            )
                            if media_cursor.rowcount:
                                media_count += 1
            except Exception as exc:
                append_operation_log(
                    'warning',
                    'task_index_warning',
                    f'结果索引跳过文件 {path.name}: {redact_sensitive(str(exc))}',
                    task_id=task['id'],
                    schedule_id=task['schedule_id'] if 'schedule_id' in task.keys() else None,
                    error_type='index_warning',
                )
        conn.execute(
            '''
            update task_items
            set media_count = (
                select count(*) from media_assets
                where media_assets.task_item_id = task_items.id
            )
            where task_id = ?
            ''',
            (task['id'],),
        )
    return {'items': item_count, 'media_assets': media_count}


def parse_datetime(value):
    if not value:
        return None
    try:
        return datetime.strptime(str(value), '%Y-%m-%d %H:%M:%S')
    except ValueError:
        return None


def validate_schedule_time(value):
    text = str(value or '').strip()
    if not re.match(r'^\d{2}:\d{2}$', text):
        raise HTTPException(status_code=400, detail='执行时间格式应为 HH:MM')
    hour, minute = [int(part) for part in text.split(':', 1)]
    if hour > 23 or minute > 59:
        raise HTTPException(status_code=400, detail='执行时间需要在 00:00 到 23:59 之间')
    return f'{hour:02d}:{minute:02d}'


def normalize_weekdays(value):
    if value in (None, ''):
        return []
    if isinstance(value, str):
        parts = re.split(r'[\s,]+', value)
    else:
        parts = value
    days = []
    for item in parts:
        if item in (None, ''):
            continue
        try:
            day = int(item)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail='周几需要是 1 到 7 的数字')
        if day < 1 or day > 7:
            raise HTTPException(status_code=400, detail='周几需要是 1 到 7 的数字')
        if day not in days:
            days.append(day)
    return sorted(days)


def next_schedule_run(schedule_type, run_time, weekdays=None, after=None):
    base = after or datetime.now()
    run_time = validate_schedule_time(run_time)
    hour, minute = [int(part) for part in run_time.split(':', 1)]
    if schedule_type == 'daily':
        candidate = base.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= base:
            candidate += timedelta(days=1)
        return candidate.strftime('%Y-%m-%d %H:%M:%S')
    if schedule_type == 'weekly':
        days = normalize_weekdays(weekdays)
        if not days:
            raise HTTPException(status_code=400, detail='每周执行需要至少选择一个星期')
        for offset in range(8):
            candidate_date = base.date() + timedelta(days=offset)
            candidate = datetime.combine(candidate_date, datetime.min.time()).replace(hour=hour, minute=minute)
            if candidate <= base:
                continue
            if candidate.isoweekday() in days:
                return candidate.strftime('%Y-%m-%d %H:%M:%S')
    raise HTTPException(status_code=400, detail='定时类型只能是 daily 或 weekly')


def schedule_payload(row):
    try:
        config = public_config(json.loads(row['config_json'] or '{}'))
    except Exception:
        config = {}
    return {
        'id': row['id'],
        'user_id': row['user_id'],
        'username': row['username'] if 'username' in row.keys() else None,
        'account_id': row['account_id'],
        'proxy_id': row['proxy_id'] if 'proxy_id' in row.keys() else config.get('proxy_id'),
        'name': row['name'],
        'enabled': bool(row['enabled']),
        'schedule_type': row['schedule_type'],
        'run_time': row['run_time'],
        'weekdays': normalize_weekdays(row['weekdays']),
        'config': config,
        'next_run_at': row['next_run_at'],
        'last_run_at': row['last_run_at'],
        'last_task_id': row['last_task_id'],
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
    }


def write_summary_report(task):
    output_dir = Path(task['output_dir'])
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        config = json.loads(task['config_json'])
    except Exception:
        config = {}
    summary = task_summary(task)
    report_path = output_dir / 'summary_report.md'
    lines = [
        '# X/Twitter 舆情采集摘要',
        '',
        f'- 任务: {task["title"]}',
        f'- 类型: {task["task_type"]}',
        f'- 目标: {task_target_label(config)}',
        f'- 时间范围: {config.get("time_range") or "-"}',
        f'- 状态: {task["status"]}',
        f'- 记录数: {summary["records"]}',
        f'- 媒体记录数: {summary["media_records"]}',
        f'- 媒体文件数: {summary["media_files"]}',
        f'- CSV 文件数: {summary["csv_files"]}',
        f'- 点赞/转推/评论合计: {summary["favorites"]}/{summary["retweets"]}/{summary["replies"]}',
        '',
        '## Top 链接',
        '',
    ]
    if summary['top_urls']:
        lines.extend(f'- {url}' for url in summary['top_urls'])
    else:
        lines.append('- 暂无可统计链接')
    lines.extend([
        '',
        '## 合规边界',
        '',
        '本报告用于内部研究和授权账号下的数据整理；平台限流、内容版权、隐私和官方 API 政策需要在生产化前单独确认。',
    ])
    report_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def task_status_class(status):
    return {
        'queued': 'muted',
        'running': 'active',
        'completed': 'success',
        'failed': 'danger',
        'cancelled': 'danger',
        'partial_failed': 'warning',
        'rate_limited': 'warning',
        'auth_expired': 'warning',
        'network_failed': 'warning',
        'target_unavailable': 'warning',
        'api_changed': 'danger',
    }.get(status, 'muted')


templates.env.globals['status_class'] = task_status_class


def frontend_index():
    index_path = BASE_DIR / 'frontend' / 'dist' / 'index.html'
    if index_path.exists():
        return FileResponse(index_path)
    return None


def frontend_public_file(filename):
    for path in [BASE_DIR / 'frontend' / 'dist' / filename, BASE_DIR / 'frontend' / 'public' / filename]:
        if path.exists():
            return FileResponse(path, media_type='image/svg+xml')
    raise HTTPException(status_code=404, detail='Frontend asset not found')


def read_log(path, max_chars=12000):
    if not path or not os.path.exists(path):
        return ''
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        data = f.read()
    return redact_sensitive(data[-max_chars:])


def parse_run_summary(line):
    elapsed = re.search(r'共耗时:([0-9.]+)秒', line)
    api_calls = re.search(r'共调用(\d+)次API', line)
    downloads = re.search(r'共下载(\d+)份图片/视频', line)
    if elapsed:
        run_state['summary']['elapsed'] = round(float(elapsed.group(1)), 2)
    if api_calls:
        run_state['summary']['api_calls'] = int(api_calls.group(1))
    if downloads:
        run_state['summary']['downloads'] = int(downloads.group(1))


def append_run_log(line):
    line = redact_sensitive(line.rstrip())
    if not line:
        return
    run_state['logs'].append(line)
    if len(run_state['logs']) > 250:
        run_state['logs'] = run_state['logs'][-250:]
    run_state['log_version'] += 1
    parse_run_summary(line)


def run_snapshot():
    started_at = run_state['started_at']
    ended_at = run_state['ended_at'] or time.time()
    running_for = round(ended_at - started_at, 2) if started_at else None
    return {
        'status': run_state['status'],
        'started_at': run_state['started_at'],
        'ended_at': run_state['ended_at'],
        'running_for': running_for,
        'return_code': run_state['return_code'],
        'summary': run_state['summary'],
        'output_path': run_state['output_path'],
        'message': run_state['message'],
        'log_version': run_state['log_version'],
        'logs': list(run_state['logs']),
    }


def active_accounts():
    with db() as conn:
        placeholders = ','.join('?' for _ in ACCOUNT_USABLE_STATUSES)
        return conn.execute(f"select * from accounts where status in ({placeholders}) order by id desc", tuple(ACCOUNT_USABLE_STATUSES)).fetchall()


def active_proxies():
    with db() as conn:
        return conn.execute("select * from proxies where enabled = 1 and status = 'active' order by id desc").fetchall()


def account_tier(account):
    tier = account['tier'] if 'tier' in account.keys() else None
    if tier:
        return tier
    return 'stable' if int(account['success_count'] if 'success_count' in account.keys() else 0) >= 5 else 'new'


def row_datetime(value):
    if not value:
        return None
    try:
        return datetime.strptime(str(value), '%Y-%m-%d %H:%M:%S')
    except ValueError:
        return None


def in_cooldown(row):
    cooldown_until = row_datetime(row['cooldown_until'] if 'cooldown_until' in row.keys() else None)
    return bool(cooldown_until and cooldown_until > datetime.now())


def account_min_interval_seconds(account):
    return ACCOUNT_NEW_MIN_INTERVAL_SECONDS if account_tier(account) == 'new' else ACCOUNT_MIN_INTERVAL_SECONDS


def account_daily_limit(account):
    return ACCOUNT_NEW_TASK_LIMIT_24H if account_tier(account) == 'new' else ACCOUNT_STABLE_TASK_LIMIT_24H


def account_tasks_last_24h(conn, account_id):
    row = conn.execute(
        "select count(*) as count from tasks where account_id = ? and datetime(created_at) >= datetime('now', 'localtime', '-1 day')",
        (account_id,),
    ).fetchone()
    return int(row['count'] if row else 0)


def seconds_since(value):
    dt = row_datetime(value)
    if not dt:
        return 10**9
    return max(0, int((datetime.now() - dt).total_seconds()))


def account_available_for_task(conn, account):
    if in_cooldown(account):
        return False
    if seconds_since(account['last_used_at'] if 'last_used_at' in account.keys() else None) < account_min_interval_seconds(account):
        return False
    if account_tasks_last_24h(conn, account['id']) >= account_daily_limit(account):
        return False
    return True


def proxy_available_for_task(proxy):
    if in_cooldown(proxy):
        return False
    if seconds_since(proxy['last_used_at'] if 'last_used_at' in proxy.keys() else None) < PROXY_MIN_INTERVAL_SECONDS:
        return False
    return True


def account_selection_score(conn, account):
    recent_tasks = account_tasks_last_24h(conn, account['id'])
    failures = int(account['failure_count'] if 'failure_count' in account.keys() else 0)
    successes = int(account['success_count'] if 'success_count' in account.keys() else 0)
    age_bonus = 0 if account_tier(account) == 'new' else -5
    return recent_tasks * 10 + failures * 4 - successes + age_bonus


def proxy_selection_score(proxy):
    failures = int(proxy['failure_count'] if 'failure_count' in proxy.keys() else 0)
    successes = int(proxy['success_count'] if 'success_count' in proxy.keys() else 0)
    return failures * 5 - successes


def select_account_for_task(preferred_account_id=0):
    with db() as conn:
        placeholders = ','.join('?' for _ in ACCOUNT_USABLE_STATUSES)
        if preferred_account_id:
            account = conn.execute(
                f"select * from accounts where id = ? and status in ({placeholders})",
                (preferred_account_id, *ACCOUNT_USABLE_STATUSES),
            ).fetchone()
            if not account:
                raise HTTPException(status_code=400, detail='X 账号会话失效，请重新登录或更新 Cookie。')
            if not account_available_for_task(conn, account):
                raise HTTPException(status_code=400, detail='所选 X 账号正在冷却或已达到配额，请稍后再试或使用自动分配。')
            return account
        rows = conn.execute(f"select * from accounts where status in ({placeholders})", tuple(ACCOUNT_USABLE_STATUSES)).fetchall()
        candidates = [row for row in rows if account_available_for_task(conn, row)]
        if not candidates:
            raise HTTPException(status_code=400, detail='没有可分配的 X 账号：可用账号可能正在冷却、过于频繁使用或已达到今日配额。')
        return sorted(candidates, key=lambda row: account_selection_score(conn, row))[0]


def select_proxy_for_task(preferred_proxy_id=0, manual_proxy=''):
    if manual_proxy:
        return None
    with db() as conn:
        if preferred_proxy_id:
            proxy = conn.execute("select * from proxies where id = ? and enabled = 1 and status = 'active'", (preferred_proxy_id,)).fetchone()
            if not proxy:
                raise HTTPException(status_code=400, detail='所选代理不可用，请先到代理页检测或换一个代理。')
            if not proxy_available_for_task(proxy):
                raise HTTPException(status_code=400, detail='所选代理正在冷却，请稍后再试或使用自动分配。')
            return proxy
        rows = conn.execute("select * from proxies where enabled = 1 and status = 'active'").fetchall()
        candidates = [row for row in rows if proxy_available_for_task(row)]
        if not candidates:
            return None
        return sorted(candidates, key=proxy_selection_score)[0]


def reserve_resources_for_task(account_id, proxy_id=None):
    with db() as conn:
        conn.execute(
            '''
            update accounts
            set last_used_at = ?, task_count = coalesce(task_count, 0) + 1
            where id = ?
            ''',
            (now(), account_id),
        )
        if proxy_id:
            conn.execute('update proxies set last_used_at = ? where id = ?', (now(), proxy_id))


def validate_proxy(proxy_url):
    try:
        proxy_url = normalize_proxy_url(proxy_url)
        r = httpx.get('https://api.ipify.org?format=json', proxy=proxy_url, timeout=15)
        if r.status_code == 200:
            data = r.json()
            return True, data.get('ip') or '', ''
        return False, '', f'HTTP {r.status_code}: {r.text[:200]}'
    except Exception as exc:
        return False, '', str(exc)


def account_health_status(ok, error=''):
    if ok:
        return 'active'
    normalized = str(error or '').lower()
    if '缺少 ct0' in normalized or '缺少 auth_token' in normalized:
        return ACCOUNT_EXPIRED_STATUS
    if any(f'http {code}' in normalized for code in AUTH_FAILURE_STATUS_CODES):
        return 'auth_expired'
    if any(f'http {code}' in normalized for code in TRANSIENT_CHECK_STATUS_CODES):
        return ACCOUNT_UNKNOWN_STATUS
    if any(term in normalized for term in ['timeout', 'timed out', 'connection', 'network', 'temporarily', 'rate limit']):
        return ACCOUNT_CHECK_FAILED_STATUS
    return ACCOUNT_CHECK_FAILED_STATUS


def update_account_health(account_id, ok, screen_name=None, error=''):
    status = account_health_status(ok, error)
    with db() as conn:
        if ok:
            conn.execute(
                '''
                update accounts
                set status = ?, screen_name = coalesce(?, screen_name), last_checked_at = ?, last_error = null,
                    cooldown_until = null, success_count = coalesce(success_count, 0) + 1,
                    tier = case when coalesce(success_count, 0) + 1 >= 5 then 'stable' else tier end
                where id = ?
                ''',
                (status, screen_name, now(), account_id),
            )
        else:
            conn.execute(
                '''
                update accounts
                set status = ?, screen_name = coalesce(?, screen_name), last_checked_at = ?, last_error = ?,
                    failure_count = coalesce(failure_count, 0) + 1
                where id = ?
                ''',
                (status, screen_name, now(), redact_sensitive(error), account_id),
            )
        return conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()


def update_proxy_health(proxy_id, ok, ip='', error=''):
    with db() as conn:
        if ok:
            conn.execute(
                '''
                update proxies
                set status = 'active', enabled = 1, detected_ip = ?, failure_count = 0,
                    success_count = coalesce(success_count, 0) + 1, cooldown_until = null,
                    last_checked_at = ?, last_error = null
                where id = ?
                ''',
                (ip or None, now(), proxy_id),
            )
        else:
            conn.execute(
                "update proxies set status = 'expired', enabled = 0, detected_ip = null, failure_count = coalesce(failure_count, 0) + 1, last_checked_at = ?, last_error = ? where id = ?",
                (now(), redact_sensitive(error), proxy_id),
            )
        return conn.execute('select * from proxies where id = ?', (proxy_id,)).fetchone()


def check_account_row(account):
    ok, screen_name, error = validate_account_cookie(account['cookie'])
    refreshed = update_account_health(account['id'], ok, screen_name, error)
    return refreshed, ok, error


def check_proxy_row(proxy):
    ok, ip, error = validate_proxy(proxy['proxy'])
    refreshed = update_proxy_health(proxy['id'], ok, ip, error)
    return refreshed, ok, ip, error


def get_active_account_or_error(account_id):
    with db() as conn:
        placeholders = ','.join('?' for _ in ACCOUNT_USABLE_STATUSES)
        account = conn.execute(
            f"select * from accounts where id = ? and status in ({placeholders})",
            (account_id, *ACCOUNT_USABLE_STATUSES),
        ).fetchone()
    if not account:
        raise HTTPException(status_code=400, detail='X 账号会话失效，请重新登录或更新 Cookie。')
    return account


def get_active_proxy_or_error(proxy_id):
    with db() as conn:
        proxy = conn.execute("select * from proxies where id = ? and enabled = 1 and status = 'active'", (proxy_id,)).fetchone()
    if not proxy:
        raise HTTPException(status_code=400, detail='所选代理不可用，请先到代理页检测或换一个代理。')
    return proxy


def resource_cooldown_for_error(error_type, resource_type):
    if error_type == 'rate_limited':
        return ACCOUNT_RATE_LIMIT_COOLDOWN_SECONDS if resource_type == 'account' else PROXY_RATE_LIMIT_COOLDOWN_SECONDS
    if error_type in {'network_failed', 'partial_failed'}:
        return ACCOUNT_TRANSIENT_COOLDOWN_SECONDS if resource_type == 'account' else PROXY_FAILURE_COOLDOWN_SECONDS
    return 0


def record_task_resource_result(task, status, error_type):
    account_id = task.get('account_id')
    proxy_id = task.get('proxy_id') or None
    error_label = error_type or status
    with db() as conn:
        if status == 'completed':
            if account_id:
                conn.execute(
                    '''
                    update accounts
                    set success_count = coalesce(success_count, 0) + 1, cooldown_until = null, last_error = null,
                        tier = case when coalesce(success_count, 0) + 1 >= 5 then 'stable' else tier end
                    where id = ?
                    ''',
                    (account_id,),
                )
            if proxy_id:
                conn.execute(
                    'update proxies set success_count = coalesce(success_count, 0) + 1, failure_count = 0, cooldown_until = null, last_error = null where id = ?',
                    (proxy_id,),
                )
            return
        if account_id and error_type:
            account_cooldown = resource_cooldown_for_error(error_type, 'account')
            account_status = 'auth_expired' if error_type == 'auth_expired' else None
            if account_status:
                conn.execute(
                    '''
                    update accounts
                    set status = ?, failure_count = coalesce(failure_count, 0) + 1, last_error = ?, cooldown_until = null
                    where id = ?
                    ''',
                    (account_status, error_label, account_id),
                )
            elif account_cooldown:
                conn.execute(
                    '''
                    update accounts
                    set failure_count = coalesce(failure_count, 0) + 1, last_error = ?, cooldown_until = ?
                    where id = ?
                    ''',
                    (error_label, seconds_from_now(account_cooldown), account_id),
                )
        if proxy_id and error_type in {'network_failed', 'rate_limited'}:
            proxy_cooldown = resource_cooldown_for_error(error_type, 'proxy')
            conn.execute(
                '''
                update proxies
                set failure_count = coalesce(failure_count, 0) + 1, last_error = ?, cooldown_until = ?
                where id = ?
                ''',
                (error_label, seconds_from_now(proxy_cooldown), proxy_id),
            )


def build_runtime_settings(config: dict):
    base = {}
    settings_path = BASE_DIR / 'settings.json'
    if settings_path.exists():
        with open(settings_path, 'r', encoding='utf-8') as f:
            base = json.load(f)
    data = dict(base)
    incoming = dict(config)
    if 'user_lst' in incoming and isinstance(incoming['user_lst'], str):
        incoming['user_lst'] = ','.join(user.strip().lstrip('@') for user in incoming['user_lst'].split(',') if user.strip())
    data.update(incoming)
    if data.get('proxy'):
        try:
            data['proxy'] = normalize_proxy_url(data.get('proxy'))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    data['log_output'] = True
    return data


def start_main_process(config: dict):
    global run_process
    with run_lock:
        if run_process and run_process.poll() is None:
            raise HTTPException(status_code=409, detail='已有任务正在运行，请先停止或等待完成。')

        output_path = (config.get('save_path') or '').strip() or str(BASE_DIR)
        run_state['status'] = 'starting'
        run_state['started_at'] = time.time()
        run_state['ended_at'] = None
        run_state['return_code'] = None
        run_state['logs'] = []
        run_state['log_version'] = 0
        run_state['summary'] = {'elapsed': None, 'api_calls': 0, 'downloads': 0}
        run_state['output_path'] = output_path
        run_state['message'] = '正在启动下载任务'

    runtime_dir = BASE_DIR / '.panel' / 'runtime'
    runtime_dir.mkdir(parents=True, exist_ok=True)
    active_settings = runtime_dir / 'settings.active.json'
    runtime_settings = build_runtime_settings(config)
    with open(active_settings, 'w', encoding='utf-8') as f:
        json.dump(runtime_settings, f, ensure_ascii=False, indent=4)

    python_exe = BASE_DIR / '.venv' / 'Scripts' / 'python.exe'
    if not python_exe.exists():
        python_exe = Path(sys.executable)

    env = os.environ.copy()
    env['TWITTER_DOWNLOAD_SETTINGS'] = str(active_settings)
    env['PYTHONIOENCODING'] = 'utf-8'

    process = subprocess.Popen(
        [str(python_exe), 'main.py'],
        cwd=str(BASE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding='utf-8',
        errors='replace',
        env=env,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0,
    )

    def monitor():
        assert process.stdout is not None
        for line in process.stdout:
            append_run_log(line)
        return_code = process.wait()
        with run_lock:
            run_state['return_code'] = return_code
            run_state['ended_at'] = time.time()
            if run_state['status'] == 'stopping':
                run_state['status'] = 'stopped'
                run_state['message'] = '任务已停止'
            elif return_code == 0:
                run_state['status'] = 'finished'
                run_state['message'] = '任务已完成'
            else:
                run_state['status'] = 'failed'
                run_state['message'] = f'任务异常退出，退出码 {return_code}'

    with run_lock:
        run_process = process
        run_state['status'] = 'running'
        run_state['message'] = '任务运行中'

    Thread(target=monitor, daemon=True).start()
    return run_snapshot()


def stop_main_process():
    with run_lock:
        process = run_process
        if not process or process.poll() is not None:
            run_state['status'] = 'idle'
            run_state['message'] = '当前没有运行中的任务'
            return run_snapshot()
        run_state['status'] = 'stopping'
        run_state['message'] = '正在停止任务'

    try:
        if os.name == 'nt':
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            process.terminate()
    except Exception:
        process.terminate()

    def force_stop_later():
        time.sleep(5)
        if process.poll() is None:
            process.terminate()

    Thread(target=force_stop_later, daemon=True).start()
    return run_snapshot()


def extract_ct0(cookie):
    for part in cookie.split(';'):
        part = part.strip()
        if part.startswith('ct0='):
            return part.split('=', 1)[1]
    return ''


def validate_account_cookie(cookie):
    ct0 = extract_ct0(cookie)
    if 'auth_token=' not in str(cookie or ''):
        return False, None, '缺少 auth_token'
    if not ct0:
        return False, None, '缺少 ct0'
    headers = {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'cookie': cookie,
        'x-csrf-token': ct0,
    }
    try:
        r = httpx.get('https://x.com/i/api/1.1/account/settings.json', headers=headers, timeout=15)
        if r.status_code == 200:
            data = r.json()
            return True, data.get('screen_name'), ''
        return False, None, f'HTTP {r.status_code}: {r.text[:200]}'
    except Exception as exc:
        return False, None, str(exc)


def save_account(label, auth_token, ct0, screen_name=None):
    cookie = f'auth_token={auth_token}; ct0={ct0};'
    with db() as conn:
        existing = conn.execute('select id from accounts where auth_token = ? and ct0 = ?', (auth_token, ct0)).fetchone()
        if existing:
            conn.execute(
                'update accounts set label = ?, cookie = ?, screen_name = coalesce(?, screen_name), status = ?, last_checked_at = ? where id = ?',
                (label or screen_name or 'X Account', cookie, screen_name, 'active', now(), existing['id']),
            )
            return
        conn.execute(
            '''
            insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at)
            values (?, ?, ?, ?, ?, 'active', ?, ?)
            ''',
            (label or screen_name or 'X Account', auth_token, ct0, cookie, screen_name, now(), now()),
        )


def normalize_bitbrowser_base_url(value):
    base_url = str(value or '').strip().rstrip('/')
    if not base_url:
        base_url = 'http://127.0.0.1:54345'
    if not re.match(r'^https?://(127\.0\.0\.1|localhost)(:\d+)?$', base_url):
        raise HTTPException(status_code=400, detail='比特浏览器 API 地址只允许本机 localhost/127.0.0.1')
    return base_url


def normalize_browser_ids(value):
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = re.split(r'[\r\n,]+', str(value or ''))
    browser_ids = []
    seen = set()
    for item in raw_items:
        browser_id = str(item or '').strip()
        if not browser_id or browser_id in seen:
            continue
        browser_ids.append(browser_id)
        seen.add(browser_id)
    if not browser_ids:
        raise HTTPException(status_code=400, detail='请至少填写一个比特浏览器窗口/Profile ID')
    if len(browser_ids) > 10:
        raise HTTPException(status_code=400, detail='一次最多导入 10 个比特浏览器窗口/Profile ID')
    return browser_ids


def bitbrowser_post(base_url, path, payload):
    try:
        response = httpx.post(f'{base_url}{path}', json=payload, timeout=20)
    except Exception as exc:
        raise RuntimeError(f'连接比特浏览器本地 API 失败：{exc}')
    try:
        data = response.json()
    except Exception:
        data = {'raw': response.text}
    if response.status_code >= 400:
        raise RuntimeError(f'HTTP {response.status_code}: {redact_sensitive(str(data))[:240]}')
    code = data.get('code') if isinstance(data, dict) else None
    success = data.get('success') if isinstance(data, dict) else None
    if code not in {None, 0, 200} and success is not True:
        message = data.get('msg') or data.get('message') or data.get('error') or data
        raise RuntimeError(redact_sensitive(str(message))[:240])
    return data


def cookie_items_from_payload(payload):
    candidates = []
    if isinstance(payload, list):
        candidates.append(payload)
    if isinstance(payload, dict):
        for key in ['data', 'cookies', 'cookie']:
            if key in payload:
                candidates.append(payload[key])
        data = payload.get('data')
        if isinstance(data, dict):
            for key in ['cookies', 'cookie', 'list']:
                if key in data:
                    candidates.append(data[key])
    for candidate in candidates:
        if isinstance(candidate, list):
            return candidate
        if isinstance(candidate, str):
            try:
                decoded = json.loads(candidate)
                if isinstance(decoded, list):
                    return decoded
            except Exception:
                continue
    return []


def extract_x_session_from_cookies(cookies):
    auth_token = ''
    ct0 = ''
    for cookie in cookies:
        if not isinstance(cookie, dict):
            continue
        name = str(cookie.get('name') or '').strip()
        value = str(cookie.get('value') or '').strip()
        domain = str(cookie.get('domain') or '').lower()
        if domain and not any(host in domain for host in ['x.com', 'twitter.com']):
            continue
        if name == 'auth_token':
            auth_token = value
        elif name == 'ct0':
            ct0 = value
    return auth_token, ct0


def import_bitbrowser_account(base_url, browser_id):
    result = {'browser_id': browser_id, 'status': 'failed', 'message': ''}
    try:
        bitbrowser_post(base_url, '/browser/open', {'id': browser_id})
        payload = bitbrowser_post(base_url, '/browser/cookies/get', {'browserId': browser_id})
        cookies = cookie_items_from_payload(payload)
        auth_token, ct0 = extract_x_session_from_cookies(cookies)
        if not auth_token or not ct0:
            result['message'] = '未找到 x.com/twitter.com 的 auth_token 和 ct0，请确认该环境已登录 X'
            return result
        cookie = f'auth_token={auth_token}; ct0={ct0};'
        ok, screen_name, error = validate_account_cookie(cookie)
        if not ok:
            result['message'] = f'账号 Cookie 校验失败：{redact_sensitive(error)}'
            return result
        save_account(screen_name or f'BitBrowser {browser_id}', auth_token, ct0, screen_name)
        result.update({'status': 'imported', 'message': '导入成功', 'screen_name': screen_name or ''})
        return result
    except Exception as exc:
        result['message'] = redact_sensitive(str(exc))
        return result


async def close_browser_login_session():
    global browser_login_session
    session = browser_login_session
    browser_login_session = None
    if not session:
        return
    try:
        await session.get('context').close()
    except Exception:
        pass
    try:
        await session.get('playwright').stop()
    except Exception:
        pass


async def browser_login_payload(session):
    if not session:
        return {'status': 'idle', 'message': '还没有启动浏览器登录', 'mode': None}

    if time.time() > session['expires_at']:
        mode = session.get('mode')
        await close_browser_login_session()
        return {'status': 'expired', 'message': '浏览器登录已超时，请重新开始', 'mode': mode}

    if session.get('error'):
        message = session['error']
        mode = session.get('mode')
        await close_browser_login_session()
        return {'status': 'failed', 'message': message, 'mode': mode}

    context = session['context']
    mode = session.get('mode') or 'remote'
    try:
        cookies = await context.cookies('https://x.com')
        data = {c['name']: c['value'] for c in cookies}
        auth_token = data.get('auth_token', '')
        ct0 = data.get('ct0', '')
        if auth_token and ct0:
            cookie = f'auth_token={auth_token}; ct0={ct0};'
            ok, screen_name, error = validate_account_cookie(cookie)
            if ok:
                save_account(screen_name or 'Browser Login', auth_token, ct0, screen_name)
                await close_browser_login_session()
                return {'status': 'completed', 'message': '登录成功，账号已保存', 'screen_name': screen_name, 'mode': mode}
            session['message'] = f'检测到 Cookie，但账号校验失败：{redact_sensitive(error)}'
    except Exception as exc:
        session['message'] = f'检查登录状态失败：{redact_sensitive(str(exc))}'

    return {
        'status': 'running',
        'message': session.get('message') or ('请在弹出的本机浏览器中完成 X 登录' if mode == 'local' else '请在远程浏览器中完成 X 登录'),
        'expires_in': max(0, int(session['expires_at'] - time.time())),
        'mode': mode,
    }


async def ensure_browser_login_session():
    global browser_login_session
    async with browser_login_lock:
        if browser_login_session:
            payload = await browser_login_payload(browser_login_session)
            if payload['status'] == 'running':
                return payload
        try:
            from playwright.async_api import async_playwright
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f'Playwright 未安装: {exc}')

        playwright = None
        try:
            playwright = await async_playwright().start()
            mode = browser_login_preferred_mode()
            if mode == 'local':
                try:
                    profile_dir = DATA_DIR / 'playwright-x-local-profile'
                    profile_dir.mkdir(parents=True, exist_ok=True)
                    chrome_path = local_chrome_executable()
                    launch_options = {
                        'headless': False,
                        'viewport': {'width': 1280, 'height': 820},
                        'args': ['--new-window'],
                    }
                    if chrome_path:
                        launch_options['executable_path'] = chrome_path
                    context = await playwright.chromium.launch_persistent_context(str(profile_dir), **launch_options)
                    mode_message = '已打开本机浏览器，请在弹出的窗口完成 X 登录'
                except Exception as exc:
                    if os.environ.get('TW_WEB_BROWSER_LOGIN_MODE', '').strip().lower() == 'local':
                        raise
                    try:
                        await playwright.stop()
                    except Exception:
                        pass
                    playwright = await async_playwright().start()
                    mode = 'remote'
                    session_error = redact_sensitive(str(exc))
            if mode == 'remote':
                profile_dir = DATA_DIR / 'playwright-x-profile'
                profile_dir.mkdir(parents=True, exist_ok=True)
                context = await playwright.chromium.launch_persistent_context(
                    str(profile_dir),
                    headless=True,
                    viewport={'width': 1280, 'height': 820},
                )
                if 'session_error' in locals():
                    mode_message = f'本机浏览器启动失败，已切换到远程登录：{session_error}'
                else:
                    mode_message = '请在远程浏览器中完成 X 登录'
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto('https://x.com/i/flow/login', wait_until='domcontentloaded')
            browser_login_session = {
                'playwright': playwright,
                'context': context,
                'page': page,
                'mode': mode,
                'started_at': time.time(),
                'expires_at': time.time() + BROWSER_LOGIN_TIMEOUT_SECONDS,
                'message': mode_message,
            }
            return await browser_login_payload(browser_login_session)
        except HTTPException:
            raise
        except Exception as exc:
            if playwright:
                try:
                    await playwright.stop()
                except Exception:
                    pass
            raise HTTPException(status_code=500, detail=f'启动浏览器失败: {redact_sensitive(str(exc))}')


def start_background_worker():
    global worker_thread, worker_threads, stop_worker
    with worker_lock:
        alive = [thread for thread in worker_threads if thread.is_alive()]
        if alive:
            worker_threads = alive
            return
        stop_worker = False
        reset_stale_task_leases()
        worker_threads = []
        for index in range(WORKER_CONCURRENCY):
            worker_id = f'worker-{index + 1}'
            thread = threading.Thread(target=worker_loop, args=(worker_id,), daemon=True, name=f'tw-{worker_id}')
            thread.start()
            worker_threads.append(thread)
        worker_thread = worker_threads[0] if worker_threads else None


def start_health_worker():
    global health_thread
    with health_lock:
        if health_thread and health_thread.is_alive():
            return
        health_thread = threading.Thread(target=health_loop, daemon=True)
        health_thread.start()


def start_schedule_worker():
    global schedule_thread
    with schedule_lock:
        if schedule_thread and schedule_thread.is_alive():
            return
        schedule_thread = threading.Thread(target=schedule_loop, daemon=True)
        schedule_thread.start()


def schedule_loop():
    while not stop_schedule_worker:
        try:
            run_due_schedules()
        except Exception as exc:
            append_operation_log('error', 'scheduler_error', f'定时调度检查失败: {exc}', error_type='scheduler_error')
        slept = 0
        while slept < 60 and not stop_schedule_worker:
            time.sleep(1)
            slept += 1


def run_due_schedules():
    current = now()
    with db() as conn:
        rows = conn.execute(
            '''
            select scheduled_tasks.*, users.username
            from scheduled_tasks
            join users on users.id = scheduled_tasks.user_id
            where enabled = 1 and next_run_at is not null and next_run_at <= ?
            order by next_run_at asc
            ''',
            (current,),
        ).fetchall()
    for row in rows:
        trigger_schedule(row_to_dict(row))


def create_queued_task(user_id, account_id, config, resource_mode='manual', schedule_id=None):
    task_dir = TASKS_DIR / datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    task_dir.mkdir(parents=True, exist_ok=True)
    log_path = task_dir / 'task.log'
    proxy_id = int(config.get('proxy_id') or 0) or None
    with db() as conn:
        cursor = conn.execute(
            '''
            insert into tasks
              (user_id, account_id, proxy_id, schedule_id, resource_mode, task_type, title, config_json, status, output_dir, log_path, created_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
            ''',
            (
                user_id,
                account_id,
                proxy_id,
                schedule_id,
                resource_mode,
                config['task_type'],
                title_from_config(config),
                json.dumps(config, ensure_ascii=False),
                str(task_dir),
                str(log_path),
                now(),
            ),
        )
        task_id = cursor.lastrowid
    reserve_resources_for_task(account_id, proxy_id)
    append_operation_log(
        'info',
        'task_created',
        f'任务已创建: {title_from_config(config)}',
        task_id=task_id,
        schedule_id=schedule_id,
        details={'task_type': config.get('task_type'), 'target': task_target_label(config), 'resource_mode': resource_mode},
    )
    start_background_worker()
    return task_id


def trigger_schedule(schedule):
    schedule_id = schedule['id']
    try:
        config = json.loads(schedule['config_json'] or '{}')
        with db() as conn:
            active = conn.execute(
                "select id from tasks where schedule_id = ? and status in ('queued', 'running') limit 1",
                (schedule_id,),
            ).fetchone()
        if active:
            append_operation_log(
                'warning',
                'schedule_skipped',
                f'定时计划跳过，本计划已有未结束任务 #{active["id"]}',
                task_id=active['id'],
                schedule_id=schedule_id,
            )
            next_run = next_schedule_run(schedule['schedule_type'], schedule['run_time'], schedule.get('weekdays'))
            with db() as conn:
                conn.execute('update scheduled_tasks set next_run_at = ?, updated_at = ? where id = ?', (next_run, now(), schedule_id))
            return
        task_id = create_queued_task(schedule['user_id'], schedule['account_id'], config, resource_mode='scheduled', schedule_id=schedule_id)
        next_run = next_schedule_run(schedule['schedule_type'], schedule['run_time'], schedule.get('weekdays'))
        with db() as conn:
            conn.execute(
                'update scheduled_tasks set last_run_at = ?, next_run_at = ?, last_task_id = ?, updated_at = ? where id = ?',
                (now(), next_run, task_id, now(), schedule_id),
            )
        append_operation_log('info', 'schedule_triggered', f'定时计划已生成任务 #{task_id}', task_id=task_id, schedule_id=schedule_id)
    except Exception as exc:
        append_operation_log('error', 'schedule_failed', f'定时计划触发失败: {exc}', schedule_id=schedule_id, error_type='schedule_failed')
        try:
            next_run = next_schedule_run(schedule['schedule_type'], schedule['run_time'], schedule.get('weekdays'))
            with db() as conn:
                conn.execute('update scheduled_tasks set next_run_at = ?, updated_at = ? where id = ?', (next_run, now(), schedule_id))
        except Exception:
            pass


def health_loop():
    while not stop_health_worker:
        run_health_check_once()
        slept = 0
        while slept < HEALTH_CHECK_INTERVAL and not stop_health_worker:
            time.sleep(1)
            slept += 1


def run_health_check_once():
    with health_lock:
        if health_state['running']:
            return
        health_state['running'] = True
        health_state['last_started_at'] = now()
        health_state['last_error'] = None
    try:
        with db() as conn:
            placeholders = ','.join('?' for _ in ACCOUNT_USABLE_STATUSES)
            accounts = conn.execute(f"select * from accounts where status in ({placeholders}) order by id desc", tuple(ACCOUNT_USABLE_STATUSES)).fetchall()
            proxies = conn.execute("select * from proxies where enabled = 1 order by id desc").fetchall()
        for account in accounts:
            check_account_row(account)
        for proxy in proxies:
            check_proxy_row(proxy)
    except Exception as exc:
        with health_lock:
            health_state['last_error'] = redact_sensitive(str(exc))
    finally:
        with health_lock:
            health_state['running'] = False
            health_state['last_finished_at'] = now()


def health_status_payload():
    with db() as conn:
        accounts = conn.execute('select status, count(*) as count from accounts group by status').fetchall()
        proxies = conn.execute(
            "select case when enabled = 0 then 'disabled' else status end as status, count(*) as count from proxies group by case when enabled = 0 then 'disabled' else status end"
        ).fetchall()
    with health_lock:
        state = dict(health_state)
    return {
        **state,
        'accounts': {row['status']: row['count'] for row in accounts},
        'proxies': {row['status']: row['count'] for row in proxies},
    }


def classify_failure(log_text, return_code):
    lower = log_text.lower()
    if 'rate limit exceeded' in lower or 'api次数已超限' in log_text:
        return 'rate_limited', 'X API 次数已超限'
    if 'auth' in lower or 'ct0' in lower or 'cookie' in lower or '401' in lower or '403' in lower or '认证' in log_text:
        return 'auth_expired', 'X 会话可能失效或权限不足'
    if 'timeout' in lower or 'proxy' in lower or 'connection' in lower or 'network' in lower or '连接' in log_text or '代理' in log_text:
        return 'network_failed', '网络或代理异常'
    if 'not found' in lower or '404' in lower or '不可见' in log_text or '不存在' in log_text:
        return 'target_unavailable', '目标不存在、不可访问或内容权限不足'
    if 'keyerror' in lower or 'list index out of range' in lower or 'graphql' in lower or '接口' in log_text:
        return 'api_changed', 'X 接口结构可能已变化'
    return 'failed', f'任务失败, 退出码 {return_code}'


def should_retry_task(error_type):
    return error_type in {'network_failed', 'rate_limited'}


def parse_log_metric(log_text, metric):
    patterns = {
        'api_calls': [r'共调用(\d+)次API', r'API 调用\s*(\d+)\s*次'],
        'downloads': [r'共下载(\d+)份图片/视频', r'下载\s*(\d+)\s*份文件'],
    }
    for pattern in patterns.get(metric, []):
        match = re.search(pattern, log_text)
        if match:
            return int(match.group(1))
    return 0


def reset_stale_task_leases():
    cutoff = seconds_from_now(-TASK_LEASE_TIMEOUT_SECONDS)
    with db() as conn:
        conn.execute(
            '''
            update tasks
            set status = 'queued',
                error = coalesce(error, 'Worker heartbeat timeout, task returned to queue'),
                last_error_type = coalesce(last_error_type, 'worker_timeout'),
                locked_by = null,
                locked_at = null,
                heartbeat_at = null,
                process_id = null
            where status = 'running'
              and heartbeat_at is not null
              and heartbeat_at < ?
            ''',
            (cutoff,),
        )


def acquire_queued_task(worker_id):
    with db() as conn:
        conn.execute('begin immediate')
        try:
            rows = conn.execute(
                '''
                select * from tasks
                where status = 'queued'
                  and (last_retry_at is null or datetime(last_retry_at, '+' || ? || ' seconds') <= datetime('now', 'localtime'))
                order by id asc
                limit 20
                ''',
                (TASK_RETRY_DELAY_SECONDS,),
            ).fetchall()
            for row in rows:
                candidate = row_to_dict(row)
                if task_should_wait_for_resource(candidate, conn):
                    continue
                current = now()
                cursor = conn.execute(
                    '''
                    update tasks
                    set status = 'running',
                        locked_by = ?,
                        locked_at = ?,
                        heartbeat_at = ?,
                        started_at = coalesce(started_at, ?),
                        error = null
                    where id = ? and status = 'queued'
                    ''',
                    (worker_id, current, current, current, candidate['id']),
                )
                if cursor.rowcount:
                    conn.commit()
                    with db() as read_conn:
                        refreshed = read_conn.execute('select * from tasks where id = ?', (candidate['id'],)).fetchone()
                    return row_to_dict(refreshed)
            conn.commit()
            return None
        except Exception:
            conn.rollback()
            raise


def heartbeat_task(task_id, worker_id, process_id=None):
    with db() as conn:
        if process_id:
            conn.execute(
                'update tasks set heartbeat_at = ?, process_id = ? where id = ? and locked_by = ?',
                (now(), process_id, task_id, worker_id),
            )
        else:
            conn.execute('update tasks set heartbeat_at = ? where id = ? and locked_by = ?', (now(), task_id, worker_id))


def release_task_lease(task_id, worker_id):
    with db() as conn:
        conn.execute(
            'update tasks set locked_by = null, locked_at = null, heartbeat_at = null where id = ? and locked_by = ?',
            (task_id, worker_id),
        )


def worker_loop(worker_id='worker-1'):
    while not stop_worker:
        try:
            reset_stale_task_leases()
            task = acquire_queued_task(worker_id)
            if not task:
                time.sleep(1)
                continue
            run_task(task, worker_id)
        except Exception as exc:
            append_operation_log('error', 'worker_error', f'{worker_id} 执行异常: {redact_sensitive(str(exc))}', error_type='worker_error')
            time.sleep(2)


def task_cancelled(task_id):
    with db() as conn:
        row = conn.execute('select status from tasks where id = ?', (task_id,)).fetchone()
    return bool(row and row['status'] == 'cancelled')


def task_should_wait_for_resource(task, conn=None):
    if not task.get('account_id'):
        return False
    def check(active_conn):
        placeholders = ','.join('?' for _ in ACCOUNT_USABLE_STATUSES)
        account = active_conn.execute(
            f"select * from accounts where id = ? and status in ({placeholders})",
            (task['account_id'], *ACCOUNT_USABLE_STATUSES),
        ).fetchone()
        proxy = active_conn.execute("select * from proxies where id = ? and enabled = 1 and status = 'active'", (task['proxy_id'],)).fetchone() if task.get('proxy_id') else None
        return bool((account and in_cooldown(account)) or (task.get('proxy_id') and (not proxy or in_cooldown(proxy))))
    if conn:
        return check(conn)
    with db() as active_conn:
        return check(active_conn)


def run_task(task, worker_id='worker-1'):
    output_dir = Path(task['output_dir'])
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path = Path(task['log_path'])
    config_path = output_dir / 'task_config.json'
    account_path = output_dir / 'account_session.json'

    with db() as conn:
        placeholders = ','.join('?' for _ in ACCOUNT_USABLE_STATUSES)
        account = conn.execute(
            f"select * from accounts where id = ? and status in ({placeholders})",
            (task['account_id'], *ACCOUNT_USABLE_STATUSES),
        ).fetchone()
        proxy = None
        if task.get('proxy_id'):
            proxy = conn.execute("select * from proxies where id = ? and enabled = 1 and status = 'active'", (task['proxy_id'],)).fetchone()
    if not account:
        with db() as conn:
            conn.execute(
                "update tasks set status = 'auth_expired', error = ?, last_error_type = ?, finished_at = ?, process_id = null, locked_by = null, locked_at = null, heartbeat_at = null where id = ?",
                ('未找到可用 X 账号', 'auth_expired', now(), task['id']),
            )
        append_operation_log('error', 'task_failed', '未找到可用 X 账号', task_id=task['id'], schedule_id=task.get('schedule_id'), error_type='auth_expired')
        return
    if task_should_wait_for_resource(task):
        with db() as conn:
            conn.execute(
                "update tasks set status = 'queued', error = ?, last_retry_at = ?, last_error_type = ?, process_id = null, locked_by = null, locked_at = null, heartbeat_at = null where id = ?",
                ('账号或代理正在冷却，稍后自动重试', now(), 'rate_limited', task['id']),
            )
        append_operation_log('warning', 'task_waiting_resource', '账号或代理正在冷却，任务保持排队', task_id=task['id'], schedule_id=task.get('schedule_id'), error_type='rate_limited')
        return

    with open(config_path, 'w', encoding='utf-8') as f:
        f.write(task['config_json'])
    with open(account_path, 'w', encoding='utf-8') as f:
        json.dump(
            {
                'auth_token': account['auth_token'],
                'ct0': account['ct0'],
                'cookie': account['cookie'],
            },
            f,
            ensure_ascii=False,
        )

    cmd = [
        sys.executable,
        str(BASE_DIR / 'web_runner.py'),
        '--config',
        str(config_path),
        '--account',
        str(account_path),
        '--output',
        str(output_dir),
    ]
    with open(log_path, 'a', encoding='utf-8', errors='replace') as log_file:
        log_file.write(f'[{now()}] 启动任务 #{task["id"]}: {task["title"]}\n')
        log_file.flush()
        append_operation_log('info', 'task_started', f'任务开始执行: {task["title"]}', task_id=task['id'], schedule_id=task.get('schedule_id'))
        proc = subprocess.Popen(
            cmd,
            cwd=str(BASE_DIR),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
        )
        with db() as conn:
            conn.execute(
                "update tasks set status = 'running', started_at = coalesce(started_at, ?), process_id = ?, locked_by = ?, heartbeat_at = ? where id = ?",
                (now(), proc.pid, worker_id, now(), task['id']),
            )
        while True:
            return_code = proc.poll()
            heartbeat_task(task['id'], worker_id, proc.pid)
            if return_code is not None:
                break
            if task_cancelled(task['id']):
                try:
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], check=False, capture_output=True)
                    else:
                        proc.terminate()
                except Exception:
                    pass
                return_code = proc.wait()
                break
            time.sleep(TASK_HEARTBEAT_SECONDS)
        log_file.write(f'\n[{now()}] 子进程退出码: {return_code}\n')
        append_operation_log('info' if return_code == 0 else 'error', 'task_process_exit', f'子进程退出码: {return_code}', task_id=task['id'], schedule_id=task.get('schedule_id'), details={'return_code': return_code})
    log_text = read_log(log_path, 50000)
    has_partial_result = False
    if task_cancelled(task['id']):
        release_task_lease(task['id'], worker_id)
        return
    if return_code == 0:
        status, error = 'completed', None
        error_type = None
    else:
        status, error = classify_failure(log_text, return_code)
        error_type = status
        summary = task_summary(task)
        has_partial_result = bool(summary['records'] or summary['files'])
        if has_partial_result:
            status = 'partial_failed'
            error = f'{error}；已保留部分采集结果'
    retry_count = int(task.get('retry_count') or 0)
    max_retries = int(task.get('max_retries') or 2)
    if return_code != 0 and not has_partial_result and should_retry_task(error_type) and retry_count < max_retries:
        next_retry_count = retry_count + 1
        record_task_resource_result(task, status, error_type)
        with open(log_path, 'a', encoding='utf-8', errors='replace') as log_file:
            log_file.write(f'\n[{now()}] {error}，准备第 {next_retry_count}/{max_retries} 次自动重试。\n')
        with db() as conn:
            conn.execute(
                "update tasks set status = 'queued', error = ?, retry_count = ?, last_retry_at = ?, last_error_type = ?, process_id = null, locked_by = null, locked_at = null, heartbeat_at = null where id = ?",
                (error, next_retry_count, now(), error_type, task['id']),
            )
        append_operation_log(
            'warning',
            'task_retry_scheduled',
            f'{error}，准备第 {next_retry_count}/{max_retries} 次自动重试',
            task_id=task['id'],
            schedule_id=task.get('schedule_id'),
            error_type=error_type,
        )
        return
    index_counts = index_task_outputs(task)
    summary = task_summary(task)
    with db() as conn:
        conn.execute(
            '''
            update tasks
            set status = ?,
                error = ?,
                last_error_type = ?,
                finished_at = ?,
                process_id = null,
                locked_by = null,
                locked_at = null,
                heartbeat_at = null,
                progress_total = ?,
                progress_done = ?,
                api_calls = ?,
                download_count = ?
            where id = ?
            ''',
            (
                status,
                error,
                error_type,
                now(),
                max(summary['media_records'], summary['media_files'], index_counts['media_assets']),
                max(summary['media_files'], index_counts['media_assets']),
                parse_log_metric(log_text, 'api_calls'),
                parse_log_metric(log_text, 'downloads'),
                task['id'],
            ),
        )
        refreshed = conn.execute('select tasks.*, users.username from tasks join users on users.id = tasks.user_id where tasks.id = ?', (task['id'],)).fetchone()
    record_task_resource_result(task, status, error_type)
    if refreshed:
        write_summary_report(refreshed)
    append_operation_log(
        'info' if status == 'completed' else 'error',
        'task_finished',
        '任务执行完成' if status == 'completed' else error or '任务执行失败',
        task_id=task['id'],
        schedule_id=task.get('schedule_id'),
        error_type=error_type,
        details={'status': status},
    )


@app.on_event('startup')
def on_startup():
    init_db()
    start_background_worker()
    start_health_worker()
    start_schedule_worker()


@app.on_event('shutdown')
def on_shutdown():
    global stop_worker, stop_health_worker, stop_schedule_worker
    stop_worker = True
    stop_health_worker = True
    stop_schedule_worker = True
    stop_main_process()


@app.get('/', response_class=HTMLResponse)
def home(request: Request):
    index = frontend_index()
    if index:
        return index
    if current_user(request):
        return RedirectResponse('/tasks')
    return RedirectResponse('/login')


@app.get('/logo.svg')
def logo_svg():
    return frontend_public_file('logo.svg')


@app.get('/favicon.svg')
def favicon_svg():
    return frontend_public_file('favicon.svg')


@app.get('/run', response_class=HTMLResponse)
def run_page(request: Request):
    index = frontend_index()
    if index:
        return index
    if current_user(request):
        return RedirectResponse('/tasks')
    return RedirectResponse('/login')


@app.get('/login', response_class=HTMLResponse)
def login_page(request: Request):
    index = frontend_index()
    if index:
        return index
    if current_user(request):
        return RedirectResponse('/run')
    return HTMLResponse(
        '''
        <!doctype html>
        <html lang="zh-CN">
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>登录</title></head>
        <body>
          <form method="post" action="/login">
            <label>用户名 <input name="username" autocomplete="username"></label>
            <label>密码 <input name="password" type="password" autocomplete="current-password"></label>
            <button type="submit">登录</button>
          </form>
        </body>
        </html>
        '''
    )


@app.post('/login')
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    user = find_user(username)
    if not user or not verify_password(password, user['password_hash']):
        return RedirectResponse('/login?error=1', status_code=303)
    request.session.clear()
    request.session['user_id'] = user['id']
    return RedirectResponse('/run', status_code=303)


@app.post('/logout')
def logout(request: Request):
    request.session.clear()
    return RedirectResponse('/login', status_code=303)


@app.get('/tasks', response_class=HTMLResponse)
def tasks(request: Request, user=Depends(require_user)):
    index = frontend_index()
    if index:
        return index
    with db() as conn:
        if user['role'] == 'admin':
            rows = conn.execute('select tasks.*, users.username from tasks join users on users.id = tasks.user_id order by tasks.id desc').fetchall()
        else:
            rows = conn.execute(
                'select tasks.*, users.username from tasks join users on users.id = tasks.user_id where user_id = ? order by tasks.id desc',
                (user['id'],),
            ).fetchall()
    return templates.TemplateResponse('tasks.html', {'request': request, 'user': user, 'tasks': rows})


@app.get('/tasks/new', response_class=HTMLResponse)
def new_task_page(request: Request, user=Depends(require_user)):
    index = frontend_index()
    if index:
        return index
    accounts = active_accounts()
    return templates.TemplateResponse('task_form.html', {'request': request, 'user': user, 'accounts': accounts, 'error': None, 'default_time_range': task_default_time_range()})


def parse_int_field(value, default, label):
    try:
        return int(value or default)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f'{label}需要是整数')


def normalize_user_targets(value, label='目标账号'):
    from benchmark_down import parse_screen_name

    raw_targets = str(value or '').replace(',', '\n').splitlines()
    parsed = []
    invalid = []
    for raw in raw_targets:
        raw = raw.strip()
        if not raw:
            continue
        screen_name = parse_screen_name(raw)
        if screen_name:
            parsed.append(screen_name)
        else:
            invalid.append(raw)
    if invalid:
        raise HTTPException(status_code=400, detail=f'{label}需要填写用户名或账号主页链接，推文链接请改用评论区任务。')
    return ','.join(parsed)


def build_task_config(form):
    task_type = form.get('task_type')
    config = {
        'task_type': task_type,
        'targets': form.get('targets') or '',
        'time_range': form.get('time_range') or task_default_time_range(),
        'max_concurrent_requests': int(form.get('max_concurrent_requests') or 8),
    }
    for name in ['has_retweet', 'high_lights', 'likes', 'has_video', 'down_log', 'auto_sync', 'md_output', 'media_latest', 'text_down', 'media_down']:
        config[name] = form.get(name) == 'on'
    config.update(
        {
            'image_format': form.get('image_format') or 'orig',
            'media_count_limit': int(form.get('media_count_limit') or 350),
            'proxy': form.get('proxy') or '',
            'tag': form.get('tag') or '',
            'advanced_filter': form.get('advanced_filter') or '',
            'down_count': int(form.get('down_count') or 50),
            'tweet_limit': parse_int_field(form.get('tweet_limit'), 10, '拉取条数'),
            'min_replies': int(form.get('min_replies') or 1),
            'min_faves': int(form.get('min_faves') or 0),
            'min_retweets': int(form.get('min_retweets') or 0),
            'search_advanced': form.get('search_advanced') or '',
        }
    )
    return config


def apply_proxy_selection(config, proxy_id):
    selected_proxy_id = int(proxy_id or 0)
    try:
        if not selected_proxy_id:
            if config.get('proxy'):
                config['proxy'] = normalize_proxy_url(config.get('proxy'))
            return config
        proxy = get_active_proxy_or_error(selected_proxy_id)
        config['proxy'] = normalize_proxy_url(proxy['proxy'])
        config['proxy_id'] = selected_proxy_id
        return config
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def validate_task_config(config):
    task_type = config.get('task_type')
    if task_type not in {'user_media', 'benchmark_account', 'search', 'text', 'replies', 'profile'}:
        raise HTTPException(status_code=400, detail='未知任务类型')
    if task_type in {'user_media', 'benchmark_account', 'text', 'profile'} and not str(config.get('targets') or '').strip():
        raise HTTPException(status_code=400, detail='请填写目标用户名')
    if task_type == 'replies' and not str(config.get('targets') or '').strip():
        raise HTTPException(status_code=400, detail='请填写目标用户或推文链接')
    if task_type == 'search' and not str(config.get('tag') or config.get('advanced_filter') or '').strip():
        raise HTTPException(status_code=400, detail='请填写 Tag 或高级搜索条件')
    if task_type in {'user_media', 'benchmark_account', 'text', 'profile'}:
        config['targets'] = normalize_user_targets(config.get('targets'))
        if not config['targets']:
            raise HTTPException(status_code=400, detail='请填写目标用户名')
    if task_type == 'benchmark_account':
        tweet_limit = parse_int_field(config.get('tweet_limit'), 0, '拉取条数')
        if tweet_limit <= 0:
            raise HTTPException(status_code=400, detail='拉取条数需要是大于 0 的整数')
        config['tweet_limit'] = tweet_limit
    if config.get('time_range') and not re.match(r'^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$', str(config.get('time_range'))):
        raise HTTPException(status_code=400, detail='时间范围格式应为 YYYY-MM-DD:YYYY-MM-DD')
    if config.get('time_range'):
        start, end = str(config.get('time_range')).split(':', 1)
        today = datetime.now().strftime('%Y-%m-%d')
        if end < start:
            raise HTTPException(status_code=400, detail='结束日期不能早于开始日期')
        if end > today:
            raise HTTPException(status_code=400, detail='结束日期不能晚于今天')


def title_from_config(config):
    names = {
        'user_media': '用户媒体',
        'benchmark_account': '对标账号',
        'search': '搜索/Tag',
        'text': '用户文本',
        'replies': '评论区',
        'profile': '主页资料',
    }
    target = config.get('targets') or config.get('tag') or config.get('advanced_filter') or '未命名目标'
    target = str(target).replace('\r', ' ').replace('\n', ' ')[:80]
    return f'{names.get(config.get("task_type"), config.get("task_type"))} - {target}'


def build_schedule_config(data):
    task_type = data.get('task_type') or 'benchmark_account'
    if task_type not in {'user_media', 'benchmark_account'}:
        raise HTTPException(status_code=400, detail='定时任务当前只支持博主采集')
    config = {
        'task_type': task_type,
        'targets': data.get('targets') or '',
        'time_range': data.get('time_range') or task_default_time_range(),
        'max_concurrent_requests': int(data.get('max_concurrent_requests') or 8),
        'has_retweet': bool(data.get('has_retweet')),
        'high_lights': bool(data.get('high_lights')),
        'likes': bool(data.get('likes')),
        'has_video': bool(data.get('has_video', True)),
        'down_log': bool(data.get('down_log')),
        'auto_sync': bool(data.get('auto_sync')),
        'md_output': bool(data.get('md_output')),
        'image_format': data.get('image_format') or 'orig',
        'media_count_limit': int(data.get('media_count_limit') or 350),
        'proxy': data.get('proxy') or '',
        'tweet_limit': parse_int_field(data.get('tweet_limit'), 10, '拉取条数'),
    }
    apply_proxy_selection(config, data.get('proxy_id'))
    validate_task_config(config)
    return config


def get_schedule_or_404(schedule_id, user):
    with db() as conn:
        row = conn.execute(
            'select scheduled_tasks.*, users.username from scheduled_tasks join users on users.id = scheduled_tasks.user_id where scheduled_tasks.id = ?',
            (schedule_id,),
        ).fetchone()
    if not row or (user['role'] != 'admin' and row['user_id'] != user['id']):
        raise HTTPException(status_code=404, detail='Schedule not found')
    return row


ATTENTION_TASK_STATUSES = {'failed', 'cancelled', 'partial_failed', 'rate_limited', 'auth_expired', 'network_failed', 'target_unavailable', 'api_changed'}
DEFAULT_STATUS_COUNTS = {
    'queued': 0,
    'running': 0,
    'completed': 0,
    'failed': 0,
    'cancelled': 0,
    'partial_failed': 0,
    'rate_limited': 0,
    'auth_expired': 0,
    'network_failed': 0,
    'target_unavailable': 0,
    'api_changed': 0,
}


def dashboard_task_item(row, summary, config):
    return {
        'id': row['id'],
        'title': row['title'],
        'task_type': row['task_type'],
        'status': row['status'],
        'created_at': row['created_at'],
        'started_at': row['started_at'],
        'finished_at': row['finished_at'],
        'worker_id': row['locked_by'] if 'locked_by' in row.keys() else None,
        'progress': {
            'total': row['progress_total'] if 'progress_total' in row.keys() else 0,
            'done': row['progress_done'] if 'progress_done' in row.keys() else 0,
        },
        'indexed_counts': task_index_counts(row['id']),
        'target': task_target_label(config),
        'summary': summary,
        'error': row['error'],
        'last_error_type': row['last_error_type'] if 'last_error_type' in row.keys() else None,
        'retry_count': row['retry_count'] if 'retry_count' in row.keys() else 0,
        'max_retries': row['max_retries'] if 'max_retries' in row.keys() else 2,
    }


def dashboard_resource_summary(conn, accounts, proxies):
    account_summary = {'total': len(accounts), 'usable': 0, 'cooling': 0, 'expired': 0, 'warning': 0}
    for account in accounts:
        status = account['status']
        if status == ACCOUNT_EXPIRED_STATUS:
            account_summary['expired'] += 1
        elif in_cooldown(account):
            account_summary['cooling'] += 1
        elif status in ACCOUNT_USABLE_STATUSES and account_available_for_task(conn, account):
            account_summary['usable'] += 1
        else:
            account_summary['warning'] += 1

    proxy_summary = {'total': len(proxies), 'usable': 0, 'cooling': 0, 'disabled': 0, 'warning': 0}
    for proxy in proxies:
        if not proxy['enabled']:
            proxy_summary['disabled'] += 1
        elif in_cooldown(proxy):
            proxy_summary['cooling'] += 1
        elif proxy['status'] == 'active' and proxy_available_for_task(proxy):
            proxy_summary['usable'] += 1
        else:
            proxy_summary['warning'] += 1
    return {'accounts': account_summary, 'proxies': proxy_summary}


def dashboard_payload(user):
    with db() as conn:
        if user['role'] == 'admin':
            rows = conn.execute('select tasks.*, users.username from tasks join users on users.id = tasks.user_id order by tasks.id desc').fetchall()
        else:
            rows = conn.execute(
                'select tasks.*, users.username from tasks join users on users.id = tasks.user_id where user_id = ? order by tasks.id desc',
                (user['id'],),
            ).fetchall()
        accounts = conn.execute('select status, count(*) as count from accounts group by status').fetchall()
        account_rows = conn.execute('select * from accounts order by id desc').fetchall()
        proxy_rows = conn.execute('select * from proxies order by id desc').fetchall()
        resources = dashboard_resource_summary(conn, account_rows, proxy_rows)
    tasks_payload = []
    active_tasks = []
    attention_tasks = []
    recent_outputs = []
    status_counts = dict(DEFAULT_STATUS_COUNTS)
    totals = {
        'tasks': len(rows),
        'running': 0,
        'completed': 0,
        'failed': 0,
        'files': 0,
        'media_files': 0,
        'records': 0,
        'api_calls': run_state['summary'].get('api_calls') or 0,
        'downloads': run_state['summary'].get('downloads') or 0,
    }
    for row in rows:
        summary = task_summary(row)
        status_counts[row['status']] = status_counts.get(row['status'], 0) + 1
        if row['status'] in {'running', 'queued'}:
            totals['running'] += 1
        if row['status'] == 'completed':
            totals['completed'] += 1
        if row['status'] in ATTENTION_TASK_STATUSES:
            totals['failed'] += 1
        totals['files'] += summary['files']
        totals['media_files'] += summary['media_files']
        totals['records'] += summary['records']
        try:
            config = json.loads(row['config_json'])
        except Exception:
            config = {}
        item = dashboard_task_item(row, summary, config)
        tasks_payload.append(item)
        if row['status'] in {'running', 'queued'} and len(active_tasks) < 5:
            active_tasks.append(item)
        if row['status'] in ATTENTION_TASK_STATUSES and len(attention_tasks) < 5:
            attention_tasks.append(item)
        if row['status'] == 'completed' and len(recent_outputs) < 6:
            recent_outputs.append(item)
    return {
        'totals': totals,
        'accounts': {row['status']: row['count'] for row in accounts},
        'status_counts': status_counts,
        'resources': resources,
        'active_tasks': active_tasks,
        'attention_tasks': attention_tasks,
        'recent_outputs': recent_outputs,
        'recent_tasks': tasks_payload[:8],
        'templates': demo_templates(),
        'compliance_notes': [
            '当前版本适合内部研究和授权账号下的数据整理。',
            'X/Twitter 存在接口限流和平台规则约束，生产化建议迁移到官方 API。',
            '日志和页面会隐藏 auth_token、ct0 与完整 Cookie，避免截图泄露。',
        ],
    }


def demo_templates():
    recent_90 = f'{(datetime.now() - timedelta(days=89)).strftime("%Y-%m-%d")}:{datetime.now().strftime("%Y-%m-%d")}'
    recent_30 = f'{(datetime.now() - timedelta(days=29)).strftime("%Y-%m-%d")}:{datetime.now().strftime("%Y-%m-%d")}'
    return [
        {
            'name': '账号近况采集',
            'description': '粘贴账号主页链接，抓取最近推文文本、互动数据和媒体，适合快速采样。',
            'payload': {'task_type': 'benchmark_account', 'targets': 'https://x.com/arsenal', 'time_range': recent_30, 'tweet_limit': 10, 'has_video': True},
        },
        {
            'name': '重点账号动态采集',
            'description': '按用户名采集推文、媒体和互动指标，适合竞品账号与重点人物动态归档。',
            'payload': {'task_type': 'user_media', 'targets': 'elonmusk', 'time_range': recent_90, 'has_video': True, 'md_output': True},
        },
        {
            'name': '关键词内容监测',
            'description': '按关键词或高级搜索语法采集最新内容，适合热点和品牌词趋势跟踪。',
            'payload': {'task_type': 'search', 'tag': 'AI', 'advanced_filter': 'lang:zh min_faves:5', 'time_range': recent_30, 'down_count': 50, 'media_latest': True},
        },
        {
            'name': '评论互动分析',
            'description': '围绕指定推文或用户抓取评论，适合观察争议点和高互动反馈。',
            'payload': {'task_type': 'replies', 'targets': 'https://x.com/user/status/1234567890', 'time_range': recent_90, 'media_down': True, 'min_replies': 1},
        },
        {
            'name': '主页资料采集',
            'description': '采集头像、banner 和简介，适合建立账号基础资料库。',
            'payload': {'task_type': 'profile', 'targets': 'x', 'time_range': default_time_range()},
        },
    ]


@app.post('/tasks')
async def create_task(request: Request, user=Depends(require_user)):
    form = await request.form()
    accounts = active_accounts()
    requested_account_id = int(form.get('account_id') or 0)
    try:
        config = build_task_config(form)
        account = select_account_for_task(requested_account_id)
        account_id = account['id']
        proxy = select_proxy_for_task(int(form.get('proxy_id') or 0), config.get('proxy') or '')
        if proxy:
            config['proxy'] = normalize_proxy_url(proxy['proxy'])
            config['proxy_id'] = proxy['id']
        else:
            apply_proxy_selection(config, form.get('proxy_id'))
        validate_task_config(config)
    except HTTPException as exc:
        config = locals().get('config') or {'time_range': form.get('time_range') or task_default_time_range()}
        return templates.TemplateResponse('task_form.html', {'request': request, 'user': user, 'accounts': accounts, 'error': exc.detail, 'default_time_range': config.get('time_range') or task_default_time_range()}, status_code=400)
    create_queued_task(user['id'], account_id, config, resource_mode='manual' if requested_account_id else 'auto')
    return RedirectResponse('/tasks', status_code=303)


def get_task_or_404(task_id, user):
    with db() as conn:
        task = conn.execute('select tasks.*, users.username from tasks join users on users.id = tasks.user_id where tasks.id = ?', (task_id,)).fetchone()
    if not task or (user['role'] != 'admin' and task['user_id'] != user['id']):
        raise HTTPException(status_code=404, detail='Task not found')
    return task


def remove_task_files(task):
    output_dir = Path(task['output_dir'])
    if output_dir.exists():
        shutil.rmtree(output_dir, ignore_errors=True)


def delete_task_row(task_id, user):
    task = get_task_or_404(task_id, user)
    if task['status'] in {'queued', 'running'}:
        if task['status'] == 'queued':
            with db() as conn:
                conn.execute("update tasks set status = 'cancelled', finished_at = ?, error = ?, last_error_type = ?, locked_by = null, locked_at = null, heartbeat_at = null where id = ?", (now(), '用户删除任务', 'cancelled', task_id))
            append_operation_log('warning', 'task_cancelled', '用户删除排队任务', task_id=task_id, schedule_id=task['schedule_id'] if 'schedule_id' in task.keys() else None, error_type='cancelled')
        elif task['process_id']:
            try:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(task['process_id']), '/T', '/F'], check=False, capture_output=True)
                else:
                    os.kill(int(task['process_id']), signal.SIGTERM)
            except Exception:
                pass
            with db() as conn:
                conn.execute("update tasks set status = 'cancelled', finished_at = ?, process_id = null, error = ?, last_error_type = ?, locked_by = null, locked_at = null, heartbeat_at = null where id = ?", (now(), '用户删除任务', 'cancelled', task_id))
            append_operation_log('warning', 'task_cancelled', '用户删除运行中任务', task_id=task_id, schedule_id=task['schedule_id'] if 'schedule_id' in task.keys() else None, error_type='cancelled')
    remove_task_files(task)
    with db() as conn:
        conn.execute('delete from tasks where id = ?', (task_id,))
    append_operation_log('warning', 'task_deleted', f'任务已删除: #{task_id}', task_id=task_id, schedule_id=task['schedule_id'] if 'schedule_id' in task.keys() else None)
    return {'ok': True}


@app.get('/tasks/{task_id}', response_class=HTMLResponse)
def task_detail(task_id: int, request: Request, user=Depends(require_user)):
    index = frontend_index()
    if index:
        return index
    task = get_task_or_404(task_id, user)
    output_dir = Path(task['output_dir'])
    files = []
    if output_dir.exists():
        for path in sorted(output_dir.rglob('*')):
            if path.is_file() and path.name not in {'account_session.json'}:
                files.append({'name': str(path.relative_to(output_dir)), 'size': path.stat().st_size})
    return templates.TemplateResponse(
        'task_detail.html',
        {'request': request, 'user': user, 'task': task, 'log': read_log(task['log_path']), 'files': files},
    )


@app.post('/tasks/{task_id}/cancel')
def cancel_task(task_id: int, user=Depends(require_user)):
    task = get_task_or_404(task_id, user)
    if task['status'] == 'queued':
        with db() as conn:
            conn.execute("update tasks set status = 'cancelled', finished_at = ?, error = ?, last_error_type = ?, locked_by = null, locked_at = null, heartbeat_at = null where id = ?", (now(), '用户取消', 'cancelled', task_id))
        append_operation_log('warning', 'task_cancelled', '用户取消排队任务', task_id=task_id, schedule_id=task['schedule_id'] if 'schedule_id' in task.keys() else None, error_type='cancelled')
    elif task['status'] == 'running' and task['process_id']:
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(task['process_id']), '/T', '/F'], check=False, capture_output=True)
            else:
                os.kill(int(task['process_id']), signal.SIGTERM)
        except Exception:
            pass
        with db() as conn:
            conn.execute("update tasks set status = 'cancelled', finished_at = ?, process_id = null, error = ?, last_error_type = ?, locked_by = null, locked_at = null, heartbeat_at = null where id = ?", (now(), '用户取消', 'cancelled', task_id))
        append_operation_log('warning', 'task_cancelled', '用户取消运行中任务', task_id=task_id, schedule_id=task['schedule_id'] if 'schedule_id' in task.keys() else None, error_type='cancelled')
    return RedirectResponse(f'/tasks/{task_id}', status_code=303)


@app.post('/tasks/{task_id}/delete')
def delete_task(task_id: int, user=Depends(require_user)):
    delete_task_row(task_id, user)
    return RedirectResponse('/tasks', status_code=303)


@app.get('/tasks/{task_id}/download')
def download_task(task_id: int, user=Depends(require_user)):
    task = get_task_or_404(task_id, user)
    output_dir = Path(task['output_dir'])
    if not output_dir.exists():
        raise HTTPException(status_code=404, detail='Output not found')
    zip_path = output_dir / f'task-{task_id}.zip'
    excluded = {'account_session.json', 'task_config.json'}
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for path in output_dir.rglob('*'):
            if path.is_file() and path.name != zip_path.name and path.name not in excluded:
                zf.write(path, path.relative_to(output_dir))
    return FileResponse(zip_path, filename=zip_path.name)


@app.get('/accounts', response_class=HTMLResponse)
def accounts_page(request: Request, user=Depends(require_admin)):
    index = frontend_index()
    if index:
        return index
    with db() as conn:
        rows = conn.execute('select * from accounts order by id desc').fetchall()
    return templates.TemplateResponse('accounts.html', {'request': request, 'user': user, 'accounts': rows, 'message': None, 'error': None})


@app.post('/accounts/manual')
async def add_account_manual(request: Request, user=Depends(require_admin)):
    form = await request.form()
    label = form.get('label') or 'X Account'
    auth_token = (form.get('auth_token') or '').strip()
    ct0 = (form.get('ct0') or '').strip()
    if not auth_token or not ct0:
        return RedirectResponse('/accounts?error=missing', status_code=303)
    save_account(label, auth_token, ct0)
    return RedirectResponse('/accounts', status_code=303)


@app.post('/accounts/{account_id}/check')
def check_account(account_id: int, user=Depends(require_admin)):
    with db() as conn:
        account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail='Account not found')
    check_account_row(account)
    return RedirectResponse('/accounts', status_code=303)


@app.post('/accounts/{account_id}/delete')
def delete_account(account_id: int, user=Depends(require_admin)):
    with db() as conn:
        conn.execute('delete from accounts where id = ?', (account_id,))
    return RedirectResponse('/accounts', status_code=303)


@app.post('/accounts/browser-login')
async def browser_login(user=Depends(require_admin)):
    if not browser_login_available():
        raise HTTPException(status_code=403, detail='浏览器登录已被 TW_WEB_ENABLE_BROWSER_LOGIN=0 禁用。')
    await ensure_browser_login_session()
    return RedirectResponse('/accounts', status_code=303)


@app.get('/health')
def health():
    return {'ok': True, 'time': now()}


@app.get('/api/health/status')
def api_health_status(user=Depends(require_api_admin)):
    return health_status_payload()


@app.get('/api/dashboard')
def api_dashboard(user=Depends(require_api_user)):
    return dashboard_payload(user)


@app.get('/api/run/config')
def api_run_config(user=Depends(require_api_user)):
    settings_path = BASE_DIR / 'settings.json'
    settings = {}
    if settings_path.exists():
        with open(settings_path, 'r', encoding='utf-8') as f:
            settings = json.load(f)
    proxies = [proxy_payload(row) for row in active_proxies()]
    proxy_id = settings.get('proxy_id')
    if proxy_id:
        with db() as conn:
            selected_proxy = conn.execute("select * from proxies where id = ? and enabled = 1 and status = 'active'", (proxy_id,)).fetchone()
        if selected_proxy:
            settings['proxy'] = selected_proxy['proxy']
    return {
        'save_path': settings.get('save_path', ''),
        'user_lst': settings.get('user_lst', ''),
        'cookie': '',
        'time_range': settings.get('time_range') or default_time_range(),
        'has_retweet': bool(settings.get('has_retweet', False)),
        'high_lights': bool(settings.get('high_lights', False)),
        'likes': bool(settings.get('likes', False)),
        'down_log': bool(settings.get('down_log', False)),
        'autoSync': bool(settings.get('autoSync', False)),
        'image_format': settings.get('image_format', 'orig'),
        'has_video': bool(settings.get('has_video', True)),
        'log_output': True,
        'max_concurrent_requests': int(settings.get('max_concurrent_requests', 8) or 8),
        'proxy': redact_proxy_url(settings.get('proxy', '')),
        'proxies': proxies,
        'proxy_id': settings.get('proxy_id'),
        'md_output': bool(settings.get('md_output', False)),
        'media_count_limit': int(settings.get('media_count_limit', 350) or 0),
        'project_path': str(BASE_DIR),
    }


@app.get('/api/run/status')
def api_run_status(user=Depends(require_api_user)):
    return run_snapshot()


@app.post('/api/run/start')
async def api_run_start(request: Request, user=Depends(require_api_user)):
    data = await request.json()
    if 'cookie' not in data or 'auth_token=' not in str(data.get('cookie')) or 'ct0=' not in str(data.get('cookie')):
        raise HTTPException(status_code=400, detail='cookie 必须包含 auth_token 和 ct0。')
    if data.get('image_format') not in {'orig', 'jpg', 'png'}:
        raise HTTPException(status_code=400, detail='image_format 只能是 orig、jpg 或 png。')
    if not re.match(r'^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$', data.get('time_range', '')):
        raise HTTPException(status_code=400, detail='时间范围格式应为 YYYY-MM-DD:YYYY-MM-DD。')
    users = [user.strip().lstrip('@') for user in str(data.get('user_lst', '')).split(',') if user.strip()]
    if not users:
        raise HTTPException(status_code=400, detail='至少填写一个用户名。')
    proxy_id = int(data.get('proxy_id') or 0)
    if proxy_id:
        proxy = get_active_proxy_or_error(proxy_id)
        data['proxy'] = normalize_proxy_url(proxy['proxy'])
    elif data.get('proxy'):
        try:
            data['proxy'] = normalize_proxy_url(data.get('proxy'))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    return start_main_process(data)


@app.post('/api/run/stop')
def api_run_stop(user=Depends(require_api_user)):
    return stop_main_process()


@app.get('/api/run/logs/stream')
async def api_run_logs_stream(user=Depends(require_api_user)):
    async def event_generator():
        last_version = -1
        while True:
            snapshot = run_snapshot()
            if snapshot['log_version'] != last_version:
                last_version = snapshot['log_version']
                yield f"data: {json.dumps(snapshot, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.8)

    return StreamingResponse(event_generator(), media_type='text/event-stream')


@app.post('/api/login')
async def api_login(request: Request):
    data = await request.json()
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    user = find_user(username)
    if not user or not verify_password(password, user['password_hash']):
        raise HTTPException(status_code=401, detail='用户名或密码错误')
    request.session.clear()
    request.session['user_id'] = user['id']
    return {'user': user_payload(user)}


@app.post('/api/logout')
def api_logout(request: Request):
    request.session.clear()
    return {'ok': True}


@app.get('/api/me')
def api_me(user=Depends(require_api_user)):
    return {'user': user_payload(user)}


@app.get('/api/tasks')
def api_tasks(user=Depends(require_api_user)):
    with db() as conn:
        if user['role'] == 'admin':
            rows = conn.execute('select tasks.*, users.username from tasks join users on users.id = tasks.user_id order by tasks.id desc').fetchall()
        else:
            rows = conn.execute(
                'select tasks.*, users.username from tasks join users on users.id = tasks.user_id where user_id = ? order by tasks.id desc',
                (user['id'],),
            ).fetchall()
    return {'tasks': [task_payload(row) for row in rows]}


@app.get('/api/schedules')
def api_schedules(user=Depends(require_api_user)):
    with db() as conn:
        if user['role'] == 'admin':
            rows = conn.execute('select scheduled_tasks.*, users.username from scheduled_tasks join users on users.id = scheduled_tasks.user_id order by scheduled_tasks.id desc').fetchall()
        else:
            rows = conn.execute(
                'select scheduled_tasks.*, users.username from scheduled_tasks join users on users.id = scheduled_tasks.user_id where user_id = ? order by scheduled_tasks.id desc',
                (user['id'],),
            ).fetchall()
    return {'schedules': [schedule_payload(row) for row in rows]}


@app.post('/api/schedules')
async def api_create_schedule(request: Request, user=Depends(require_api_user)):
    data = await request.json()
    account_id = int(data.get('account_id') or 0)
    if not account_id:
        raise HTTPException(status_code=400, detail='请先选择 X 账号')
    get_active_account_or_error(account_id)
    config = build_schedule_config(data)
    schedule_type = str(data.get('schedule_type') or 'daily').strip()
    if schedule_type not in {'daily', 'weekly'}:
        raise HTTPException(status_code=400, detail='定时类型只能是 daily 或 weekly')
    run_time = validate_schedule_time(data.get('run_time') or '09:00')
    weekdays = normalize_weekdays(data.get('weekdays') or [])
    if schedule_type == 'weekly' and not weekdays:
        raise HTTPException(status_code=400, detail='每周任务至少选择一个星期')
    next_run = next_schedule_run(schedule_type, run_time, weekdays)
    with db() as conn:
        cursor = conn.execute(
            '''
            insert into scheduled_tasks
              (user_id, account_id, proxy_id, name, enabled, schedule_type, run_time, weekdays, config_json, next_run_at, last_run_at, last_task_id, created_at, updated_at)
            values (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, null, null, ?, ?)
            ''',
            (
                user['id'],
                account_id,
                config.get('proxy_id'),
                (data.get('name') or '定时采集').strip(),
                schedule_type,
                run_time,
                ','.join(str(day) for day in weekdays),
                json.dumps(config, ensure_ascii=False),
                next_run,
                now(),
                now(),
            ),
        )
        schedule_id = cursor.lastrowid
        row = conn.execute('select scheduled_tasks.*, users.username from scheduled_tasks join users on users.id = scheduled_tasks.user_id where scheduled_tasks.id = ?', (schedule_id,)).fetchone()
    append_operation_log('info', 'schedule_created', f'创建定时任务: {row["name"]}', schedule_id=schedule_id, details={'schedule_type': schedule_type, 'run_time': run_time})
    return {'schedule': schedule_payload(row)}


@app.patch('/api/schedules/{schedule_id}')
async def api_update_schedule(schedule_id: int, request: Request, user=Depends(require_api_user)):
    schedule = get_schedule_or_404(schedule_id, user)
    data = await request.json()
    account_id = int(data.get('account_id') or schedule['account_id'])
    get_active_account_or_error(account_id)
    config = build_schedule_config({**json.loads(schedule['config_json'] or '{}'), **data, 'account_id': account_id})
    schedule_type = str(data.get('schedule_type') or schedule['schedule_type']).strip()
    if schedule_type not in {'daily', 'weekly'}:
        raise HTTPException(status_code=400, detail='定时类型只能是 daily 或 weekly')
    run_time = validate_schedule_time(data.get('run_time') or schedule['run_time'])
    weekdays = normalize_weekdays(data.get('weekdays') if 'weekdays' in data else schedule['weekdays'])
    if schedule_type == 'weekly' and not weekdays:
        raise HTTPException(status_code=400, detail='每周任务至少选择一个星期')
    next_run = next_schedule_run(schedule_type, run_time, weekdays)
    with db() as conn:
        conn.execute(
            '''
            update scheduled_tasks
            set account_id = ?, proxy_id = ?, name = ?, enabled = ?, schedule_type = ?, run_time = ?, weekdays = ?, config_json = ?, next_run_at = ?, updated_at = ?
            where id = ?
            ''',
            (
                account_id,
                config.get('proxy_id'),
                (data.get('name') or schedule['name']).strip(),
                1 if data.get('enabled', schedule['enabled']) else 0,
                schedule_type,
                run_time,
                ','.join(str(day) for day in weekdays),
                json.dumps(config, ensure_ascii=False),
                next_run,
                now(),
                schedule_id,
            ),
        )
        row = conn.execute('select scheduled_tasks.*, users.username from scheduled_tasks join users on users.id = scheduled_tasks.user_id where scheduled_tasks.id = ?', (schedule_id,)).fetchone()
    append_operation_log('info', 'schedule_updated', f'更新定时任务: {row["name"]}', schedule_id=schedule_id, details={'schedule_type': schedule_type, 'run_time': run_time})
    return {'schedule': schedule_payload(row)}


@app.post('/api/schedules/{schedule_id}/toggle')
def api_toggle_schedule(schedule_id: int, user=Depends(require_api_user)):
    schedule = get_schedule_or_404(schedule_id, user)
    enabled = 0 if schedule['enabled'] else 1
    with db() as conn:
        conn.execute('update scheduled_tasks set enabled = ?, updated_at = ? where id = ?', (enabled, now(), schedule_id))
        row = conn.execute('select scheduled_tasks.*, users.username from scheduled_tasks join users on users.id = scheduled_tasks.user_id where scheduled_tasks.id = ?', (schedule_id,)).fetchone()
    append_operation_log('info', 'schedule_toggled', f'定时任务已{"启用" if enabled else "停用"}: {row["name"]}', schedule_id=schedule_id, details={'enabled': bool(enabled)})
    return {'schedule': schedule_payload(row)}


@app.delete('/api/schedules/{schedule_id}')
def api_delete_schedule(schedule_id: int, user=Depends(require_api_user)):
    schedule = get_schedule_or_404(schedule_id, user)
    with db() as conn:
        conn.execute('delete from scheduled_tasks where id = ?', (schedule_id,))
    append_operation_log('warning', 'schedule_deleted', f'删除定时任务: {schedule["name"]}', schedule_id=schedule_id)
    return {'ok': True}


@app.get('/api/operation-logs')
def api_operation_logs(user=Depends(require_api_user), task_id: int | None = None, schedule_id: int | None = None, level: str | None = None, limit: int = 200):
    limit = max(1, min(int(limit or 200), 500))
    clauses = []
    params = []
    if task_id:
        clauses.append('task_id = ?')
        params.append(task_id)
    if schedule_id:
        clauses.append('schedule_id = ?')
        params.append(schedule_id)
    if level:
        clauses.append('level = ?')
        params.append(level)
    if user['role'] != 'admin':
        clauses.append(
            '''
            (
              task_id in (select id from tasks where user_id = ?)
              or schedule_id in (select id from scheduled_tasks where user_id = ?)
            )
            '''
        )
        params.extend([user['id'], user['id']])
    where = f"where {' and '.join(clauses)}" if clauses else ''
    with db() as conn:
        rows = conn.execute(f'select * from operation_logs {where} order by id desc limit ?', (*params, limit)).fetchall()
    return {'logs': [operation_log_payload(row) for row in rows]}


@app.post('/api/tasks')
async def api_create_task(request: Request, user=Depends(require_api_user)):
    data = await request.json()
    requested_account_id = int(data.get('account_id') or 0)
    account = select_account_for_task(requested_account_id)
    account_id = account['id']
    config = {
        'task_type': data.get('task_type'),
        'targets': data.get('targets') or '',
        'time_range': data.get('time_range') or '',
        'max_concurrent_requests': int(data.get('max_concurrent_requests') or 8),
    }
    for name in ['has_retweet', 'high_lights', 'likes', 'has_video', 'down_log', 'auto_sync', 'md_output', 'media_latest', 'text_down', 'media_down']:
        config[name] = bool(data.get(name))
    config.update(
        {
            'image_format': data.get('image_format') or 'orig',
            'media_count_limit': int(data.get('media_count_limit') or 350),
            'proxy': data.get('proxy') or '',
            'tag': data.get('tag') or '',
            'advanced_filter': data.get('advanced_filter') or '',
            'down_count': int(data.get('down_count') or 50),
            'tweet_limit': parse_int_field(data.get('tweet_limit'), 10, '拉取条数'),
            'min_replies': int(data.get('min_replies') or 1),
            'min_faves': int(data.get('min_faves') or 0),
            'min_retweets': int(data.get('min_retweets') or 0),
            'search_advanced': data.get('search_advanced') or '',
        }
    )
    proxy = select_proxy_for_task(int(data.get('proxy_id') or 0), config.get('proxy') or '')
    if proxy:
        config['proxy'] = normalize_proxy_url(proxy['proxy'])
        config['proxy_id'] = proxy['id']
    else:
        apply_proxy_selection(config, data.get('proxy_id'))
    validate_task_config(config)
    task_id = create_queued_task(user['id'], account_id, config, resource_mode='manual' if requested_account_id else 'auto')
    with db() as conn:
        task = conn.execute('select tasks.*, users.username from tasks join users on users.id = tasks.user_id where tasks.id = ?', (task_id,)).fetchone()
    return {'task': task_payload(task, include_config=True)}


@app.get('/api/tasks/{task_id}')
def api_task_detail(task_id: int, user=Depends(require_api_user)):
    task = get_task_or_404(task_id, user)
    return {'task': task_payload(task, include_config=True, include_log=True, include_files=True, include_preview=True)}


@app.get('/api/tasks/{task_id}/files')
def api_task_files(task_id: int, user=Depends(require_api_user)):
    task = get_task_or_404(task_id, user)
    return {'files': task_files(task)}


@app.post('/api/tasks/{task_id}/cancel')
def api_cancel_task(task_id: int, user=Depends(require_api_user)):
    task = get_task_or_404(task_id, user)
    if task['status'] == 'queued':
        with db() as conn:
            conn.execute("update tasks set status = 'cancelled', finished_at = ?, error = ?, last_error_type = ?, locked_by = null, locked_at = null, heartbeat_at = null where id = ?", (now(), '用户取消', 'cancelled', task_id))
    elif task['status'] == 'running' and task['process_id']:
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(task['process_id']), '/T', '/F'], check=False, capture_output=True)
            else:
                os.kill(int(task['process_id']), signal.SIGTERM)
        except Exception:
            pass
        with db() as conn:
            conn.execute("update tasks set status = 'cancelled', finished_at = ?, process_id = null, error = ?, last_error_type = ?, locked_by = null, locked_at = null, heartbeat_at = null where id = ?", (now(), '用户取消', 'cancelled', task_id))
    with db() as conn:
        refreshed = conn.execute('select tasks.*, users.username from tasks join users on users.id = tasks.user_id where tasks.id = ?', (task_id,)).fetchone()
    return {'task': task_payload(refreshed, include_config=True, include_log=True, include_files=True, include_preview=True)}


@app.delete('/api/tasks/{task_id}')
def api_delete_task(task_id: int, user=Depends(require_api_user)):
    return delete_task_row(task_id, user)


@app.get('/api/accounts')
def api_accounts(user=Depends(require_api_admin)):
    with db() as conn:
        rows = conn.execute('select * from accounts order by id desc').fetchall()
    return {'accounts': [account_payload(row) for row in rows]}


@app.get('/api/proxies')
def api_proxies(user=Depends(require_api_admin)):
    with db() as conn:
        rows = conn.execute('select * from proxies order by id desc').fetchall()
    return {'proxies': [proxy_payload(row) for row in rows]}


@app.post('/api/proxies')
async def api_add_proxy(request: Request, user=Depends(require_api_admin)):
    data = await request.json()
    label = (data.get('label') or '').strip() or 'Proxy'
    proxy = (data.get('proxy') or '').strip()
    if not proxy:
        raise HTTPException(status_code=400, detail='proxy 不能为空')
    try:
        proxy = normalize_proxy_url(proxy)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    with db() as conn:
        conn.execute(
            '''
            insert into proxies (label, proxy, enabled, status, last_checked_at, last_error, created_at)
            values (?, ?, 1, 'active', null, null, ?)
            ''',
            (label, proxy, now()),
        )
    return {'ok': True}


@app.post('/api/proxies/{proxy_id}/check')
def api_check_proxy(proxy_id: int, user=Depends(require_api_admin)):
    with db() as conn:
        proxy = conn.execute('select * from proxies where id = ?', (proxy_id,)).fetchone()
    if not proxy:
        raise HTTPException(status_code=404, detail='Proxy not found')
    refreshed, ok, ip, error = check_proxy_row(proxy)
    payload = proxy_payload(refreshed)
    payload['detected_ip'] = ip
    return {'proxy': payload, 'ok': ok, 'error': error, 'ip': ip}


@app.post('/api/proxies/{proxy_id}/toggle')
def api_toggle_proxy(proxy_id: int, user=Depends(require_api_admin)):
    with db() as conn:
        proxy = conn.execute('select * from proxies where id = ?', (proxy_id,)).fetchone()
        if not proxy:
            raise HTTPException(status_code=404, detail='Proxy not found')
        enabled = 0 if proxy['enabled'] else 1
        conn.execute('update proxies set enabled = ? where id = ?', (enabled, proxy_id))
        refreshed = conn.execute('select * from proxies where id = ?', (proxy_id,)).fetchone()
    return {'proxy': proxy_payload(refreshed)}


@app.delete('/api/proxies/{proxy_id}')
def api_delete_proxy(proxy_id: int, user=Depends(require_api_admin)):
    with db() as conn:
        conn.execute('delete from proxies where id = ?', (proxy_id,))
    return {'ok': True}


@app.post('/api/accounts/manual')
async def api_add_account_manual(request: Request, user=Depends(require_api_admin)):
    data = await request.json()
    label = data.get('label') or 'X Account'
    auth_token = (data.get('auth_token') or '').strip()
    ct0 = (data.get('ct0') or '').strip()
    if not auth_token or not ct0:
        raise HTTPException(status_code=400, detail='auth_token 和 ct0 都必填')
    save_account(label, auth_token, ct0)
    return {'ok': True}


@app.post('/api/accounts/local-browser-login/start')
async def api_local_browser_login_start(request: Request, user=Depends(require_api_admin)):
    if not browser_login_available():
        raise HTTPException(status_code=403, detail='浏览器登录已被 TW_WEB_ENABLE_BROWSER_LOGIN=0 禁用。')
    token = secrets.token_urlsafe(32)
    expires_at = time.time() + LOCAL_BROWSER_LOGIN_TIMEOUT_SECONDS
    with local_browser_login_lock:
        cleanup_local_browser_login_sessions()
        local_browser_login_sessions[token] = {
            'status': 'pending',
            'message': '等待本地登录助手打开 Chrome。',
            'created_at': time.time(),
            'expires_at': expires_at,
            'user_id': user['id'],
        }
    base_url = public_base_url(request)
    return {
        'status': 'pending',
        'message': '请确认本地登录助手已启动。',
        'token': token,
        'expires_in': LOCAL_BROWSER_LOGIN_TIMEOUT_SECONDS,
        'callback_url': f'{base_url}/api/accounts/local-browser-login/complete',
    }


@app.get('/api/accounts/local-browser-login/status')
def api_local_browser_login_status(token: str, user=Depends(require_api_admin)):
    with local_browser_login_lock:
        payload = local_browser_login_payload(token)
    return payload


@app.post('/api/accounts/local-browser-login/cancel')
async def api_local_browser_login_cancel(request: Request, user=Depends(require_api_admin)):
    data = await request.json()
    token = str(data.get('token') or '').strip()
    if not token:
        raise HTTPException(status_code=400, detail='token 不能为空')
    with local_browser_login_lock:
        session = local_browser_login_sessions.get(token)
        if session:
            session['status'] = 'cancelled'
            session['message'] = '已取消本地 Chrome 授权登录。'
    return {'ok': True}


@app.post('/api/accounts/local-browser-login/complete')
async def api_local_browser_login_complete(request: Request):
    data = await request.json()
    token = str(data.get('token') or '').strip()
    auth_token = str(data.get('auth_token') or '').strip()
    ct0 = str(data.get('ct0') or '').strip()
    screen_name = str(data.get('screen_name') or '').strip()
    error = str(data.get('error') or '').strip()
    if not token:
        raise HTTPException(status_code=400, detail='token 不能为空')
    with local_browser_login_lock:
        cleanup_local_browser_login_sessions()
        session = local_browser_login_sessions.get(token)
        if not session:
            raise HTTPException(status_code=404, detail='本地授权登录已不存在或已过期')
        if session.get('status') == 'cancelled':
            raise HTTPException(status_code=409, detail='本地 Chrome 授权登录已取消')
        if time.time() > session['expires_at']:
            session['status'] = 'expired'
            session['message'] = '本地 Chrome 授权登录已超时，请重新开始。'
            raise HTTPException(status_code=410, detail=session['message'])
        if error:
            session['status'] = 'failed'
            session['message'] = redact_sensitive(error)
            return local_browser_login_payload(token)
        if not auth_token or not ct0:
            session['status'] = 'running'
            session['message'] = '本地 Chrome 已打开，请完成 X 登录。'
            return local_browser_login_payload(token)
    cookie = f'auth_token={auth_token}; ct0={ct0};'
    ok, checked_screen_name, validation_error = validate_account_cookie(cookie)
    with local_browser_login_lock:
        session = local_browser_login_sessions.get(token)
        if not session:
            raise HTTPException(status_code=404, detail='本地授权登录已不存在或已过期')
        final_screen_name = checked_screen_name or screen_name
        save_account(final_screen_name or 'Local Chrome Login', auth_token, ct0, final_screen_name)
        session['status'] = 'completed'
        if ok:
            session['message'] = '登录成功，账号已保存。'
        else:
            session['message'] = f'已获取登录 Cookie 并保存账号；账号名称暂未识别，后续可在账号检测中更新状态。校验提示：{redact_sensitive(validation_error)}'
        session['screen_name'] = final_screen_name or ''
        return local_browser_login_payload(token)


@app.post('/api/accounts/browser-login')
async def api_browser_login(user=Depends(require_api_admin)):
    if not browser_login_available():
        raise HTTPException(status_code=403, detail='浏览器登录已被 TW_WEB_ENABLE_BROWSER_LOGIN=0 禁用。')
    return await ensure_browser_login_session()


@app.post('/api/accounts/browser-login/start')
async def api_browser_login_start(user=Depends(require_api_admin)):
    if not browser_login_available():
        raise HTTPException(status_code=403, detail='浏览器登录已被 TW_WEB_ENABLE_BROWSER_LOGIN=0 禁用。')
    return await ensure_browser_login_session()


@app.get('/api/accounts/browser-login/status')
async def api_browser_login_status(user=Depends(require_api_admin)):
    async with browser_login_lock:
        return await browser_login_payload(browser_login_session)


@app.get('/api/accounts/browser-login/screenshot')
async def api_browser_login_screenshot(user=Depends(require_api_admin)):
    async with browser_login_lock:
        payload = await browser_login_payload(browser_login_session)
        if payload['status'] != 'running':
            raise HTTPException(status_code=409, detail=payload['message'])
        try:
            data = await browser_login_session['page'].screenshot(type='jpeg', quality=72)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f'获取远程浏览器画面失败: {redact_sensitive(str(exc))}')
    return Response(content=data, media_type='image/jpeg', headers={'Cache-Control': 'no-store'})


@app.post('/api/accounts/browser-login/input')
async def api_browser_login_input(request: Request, user=Depends(require_api_admin)):
    data = await request.json()
    async with browser_login_lock:
        payload = await browser_login_payload(browser_login_session)
        if payload['status'] != 'running':
            raise HTTPException(status_code=409, detail=payload['message'])
        page = browser_login_session['page']
        action = data.get('action')
        try:
            if action == 'click':
                await page.mouse.click(float(data.get('x') or 0), float(data.get('y') or 0))
            elif action == 'type':
                await page.keyboard.type(str(data.get('text') or ''), delay=25)
            elif action == 'press':
                key = str(data.get('key') or '')
                if key not in {'Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'}:
                    raise HTTPException(status_code=400, detail='不支持的按键')
                await page.keyboard.press(key)
            elif action == 'reload':
                await page.reload(wait_until='domcontentloaded')
            else:
                raise HTTPException(status_code=400, detail='不支持的浏览器操作')
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f'远程浏览器操作失败: {redact_sensitive(str(exc))}')
    return {'ok': True}


@app.post('/api/accounts/browser-login/cancel')
async def api_browser_login_cancel(user=Depends(require_api_admin)):
    async with browser_login_lock:
        await close_browser_login_session()
    return {'ok': True}


@app.post('/api/accounts/import/bitbrowser')
async def api_import_bitbrowser_accounts(request: Request, user=Depends(require_api_admin)):
    data = await request.json()
    base_url = normalize_bitbrowser_base_url(data.get('base_url'))
    browser_ids = normalize_browser_ids(data.get('browser_ids'))
    results = [import_bitbrowser_account(base_url, browser_id) for browser_id in browser_ids]
    imported = sum(1 for item in results if item.get('status') == 'imported')
    return {
        'imported': imported,
        'failed': len(results) - imported,
        'results': results,
    }


@app.post('/api/accounts/{account_id}/check')
def api_check_account(account_id: int, user=Depends(require_api_admin)):
    with db() as conn:
        account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail='Account not found')
    refreshed, ok, error = check_account_row(account)
    return {'account': account_payload(refreshed), 'ok': ok, 'error': error}


@app.delete('/api/accounts/{account_id}')
def api_delete_account(account_id: int, user=Depends(require_api_admin)):
    with db() as conn:
        conn.execute('delete from accounts where id = ?', (account_id,))
    return {'ok': True}


@app.get('/{full_path:path}', response_class=HTMLResponse)
def spa_fallback(full_path: str, request: Request):
    if full_path.startswith('api/'):
        raise HTTPException(status_code=404, detail='Not found')
    index = frontend_index()
    if index:
        return index
    if current_user(request):
        return RedirectResponse('/tasks')
    return RedirectResponse('/login')


enforce_public_startup_safety()
init_db()


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(app, host='127.0.0.1', port=8000, log_level='info')
