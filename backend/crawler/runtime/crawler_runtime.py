import asyncio
import contextlib
import hashlib
import json
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import httpx

from backend.shared.proxy_utils import proxy_for_httpx
from backend.shared.url_utils import quote_url


AUTHORIZATION = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
DEFAULT_TIMEOUT = (3.05, 16)


class CrawlerError(RuntimeError):
    def __init__(self, error_type, message, status_code=None, rate_limit_reset=None, rate_limit_remaining=None):
        super().__init__(message)
        self.error_type = error_type
        self.status_code = status_code
        self.rate_limit_reset = rate_limit_reset
        self.rate_limit_remaining = rate_limit_remaining


def classify_response(status_code, text=''):
    lower = str(text or '').lower()
    if status_code in {401, 403}:
        return 'auth_expired'
    if status_code == 429 or 'rate limit exceeded' in lower or 'api次数已超限' in text:
        return 'rate_limited'
    if status_code == 404:
        return 'target_unavailable'
    if status_code in {408, 409, 425, 500, 502, 503, 504}:
        return 'network_failed'
    return 'failed'


def classify_exception(exc):
    if isinstance(exc, CrawlerError):
        return exc.error_type
    text = str(exc).lower()
    if 'budget' in text or '预算' in str(exc):
        return 'budget_exhausted'
    if any(term in text for term in ['401', '403', 'auth', 'cookie', 'ct0']):
        return 'auth_expired'
    if '429' in text or 'rate limit' in text or 'api次数已超限' in str(exc):
        return 'rate_limited'
    if any(term in text for term in ['timeout', 'timed out', 'connect', 'network', 'proxy', 'readerror']):
        return 'network_failed'
    if '404' in text or 'not found' in text:
        return 'target_unavailable'
    return 'failed'


def parse_rate_limit_headers(headers):
    headers = headers or {}
    remaining = None
    reset = None
    try:
        remaining_value = headers.get('x-rate-limit-remaining') or headers.get('X-Rate-Limit-Remaining')
        if remaining_value is not None:
            remaining = int(remaining_value)
    except (TypeError, ValueError):
        remaining = None
    try:
        reset_value = headers.get('x-rate-limit-reset') or headers.get('X-Rate-Limit-Reset')
        if reset_value is not None:
            reset = int(float(reset_value))
    except (TypeError, ValueError):
        reset = None
    return {'remaining': remaining, 'reset': reset}


def format_reset_marker(reset_epoch):
    try:
        return datetime.fromtimestamp(int(reset_epoch)).strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        return ''


def emit_rate_limit_marker(info):
    if os.environ.get('TW_CRAWLER_EMIT_LIMIT_MARKERS', '1').lower() in {'0', 'false', 'no', 'off'}:
        return
    reset = info.get('reset')
    remaining = info.get('remaining')
    if reset:
        marker = format_reset_marker(reset)
        if marker:
            print(f'CRAWLER_RATE_LIMIT_REMAINING={remaining if remaining is not None else ""} CRAWLER_RATE_LIMIT_RESET={marker}', flush=True)


def raise_for_crawler_response(response):
    rate_limit = parse_rate_limit_headers(response.headers)
    if response.status_code < 400:
        text = response.text
        if 'Rate limit exceeded' in text or 'API次数已超限' in text:
            emit_rate_limit_marker(rate_limit)
            raise CrawlerError('rate_limited', 'Rate limit exceeded', response.status_code, rate_limit.get('reset'), rate_limit.get('remaining'))
        return
    error_type = classify_response(response.status_code, response.text[:500])
    if error_type == 'rate_limited':
        emit_rate_limit_marker(rate_limit)
    raise CrawlerError(error_type, f'HTTP {response.status_code}: {response.text[:200]}', response.status_code, rate_limit.get('reset'), rate_limit.get('remaining'))


def ct0_from_cookie(cookie):
    match = re.search(r'ct0=([^;]+)', str(cookie or ''))
    if not match:
        raise CrawlerError('auth_expired', 'Cookie missing ct0')
    return match.group(1)


def standard_headers(cookie, account_row=None, referer='https://twitter.com/'):
    """
    生成标准请求头，支持反检测

    Args:
        cookie: Cookie 字符串
        account_row: 账号数据库记录（可选，用于反检测）
        referer: Referer URL

    Returns:
        dict: 请求头
    """
    # 如果没有显式传入账号信息，尝试从环境变量构造（由 web_runner 注入）
    if not account_row:
        env_ua = os.environ.get('TW_ACCOUNT_UA', '').strip()
        if env_ua:
            account_row = {
                'user_agent': env_ua,
                'accept_language': os.environ.get('TW_ACCOUNT_ACCEPT_LANGUAGE', '').strip() or None,
            }

    if account_row:
        # 使用反检测请求头
        try:
            from anti_detection import generate_request_headers
            return generate_request_headers(account_row, cookie, referer)
        except Exception:
            pass  # 如果反检测模块不可用，回退到默认实现

    # 默认实现（兼容旧代码）
    return {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'authorization': AUTHORIZATION,
        'cookie': cookie,
        'x-csrf-token': ct0_from_cookie(cookie),
        'referer': referer,
    }



def resource_key(value):
    text = str(value or 'none')
    return quote(text, safe='')[:180] or 'none'


@dataclass
class RuntimeLimits:
    account_api_interval: float = 8.0
    account_api_variance: float = 5.0  # 新增：账号间隔抖动范围
    proxy_api_interval: float = 0.5
    proxy_api_variance: float = 1.0  # 新增：代理间隔抖动范围
    media_download_interval: float = 0.0
    page_delay_base: float = 5.0  # 新增：翻页延迟基础值
    page_delay_variance: float = 3.0  # 新增：翻页延迟抖动范围
    break_after_requests: int = 25  # 新增：多少次请求后休息
    break_duration_min: int = 30  # 新增：休息最短时长（秒）
    break_duration_max: int = 90  # 新增：休息最长时长（秒）
    max_retries: int = 1
    backoff_base: float = 2.0

    @classmethod
    def from_env(cls):
        return cls(
            account_api_interval=float(os.environ.get('TW_ACCOUNT_API_INTERVAL_SECONDS', '8') or 8),
            account_api_variance=float(os.environ.get('TW_ACCOUNT_API_VARIANCE_SECONDS', '5') or 5),
            proxy_api_interval=float(os.environ.get('TW_PROXY_API_INTERVAL_SECONDS', '0.5') or 0.5),
            proxy_api_variance=float(os.environ.get('TW_PROXY_API_VARIANCE_SECONDS', '1') or 1),
            media_download_interval=float(os.environ.get('TW_MEDIA_DOWNLOAD_INTERVAL_SECONDS', '0') or 0),
            page_delay_base=float(os.environ.get('TW_PAGE_DELAY_BASE_SECONDS', '5') or 5),
            page_delay_variance=float(os.environ.get('TW_PAGE_DELAY_VARIANCE_SECONDS', '3') or 3),
            break_after_requests=int(os.environ.get('TW_BREAK_AFTER_REQUESTS', '25') or 25),
            break_duration_min=int(os.environ.get('TW_BREAK_DURATION_MIN_SECONDS', '30') or 30),
            break_duration_max=int(os.environ.get('TW_BREAK_DURATION_MAX_SECONDS', '90') or 90),
            max_retries=max(1, int(os.environ.get('TW_CRAWLER_REQUEST_RETRIES', '1') or 1)),
            backoff_base=max(0.1, float(os.environ.get('TW_CRAWLER_BACKOFF_BASE_SECONDS', '2') or 2)),
        )


def page_delay():
    """翻页延迟（支持随机抖动）"""
    try:
        from anti_detection import random_interval
        limits = RuntimeLimits.from_env()
        delay = random_interval(limits.page_delay_base, limits.page_delay_variance)
    except Exception:
        # 回退到固定延迟
        delay = max(0.0, float(os.environ.get('TW_CRAWLER_PAGE_DELAY_SECONDS', '6') or 0))
    if delay:
        time.sleep(delay)


async def async_page_delay():
    """异步翻页延迟（支持随机抖动）"""
    try:
        from anti_detection import random_interval
        limits = RuntimeLimits.from_env()
        delay = random_interval(limits.page_delay_base, limits.page_delay_variance)
    except Exception:
        # 回退到固定延迟
        delay = max(0.0, float(os.environ.get('TW_CRAWLER_PAGE_DELAY_SECONDS', '6') or 0))
    if delay:
        await asyncio.sleep(delay)


def media_download_retries():
    return max(1, int(os.environ.get('TW_MEDIA_DOWNLOAD_RETRIES', '5') or 5))


class RequestBudget:
    def __init__(self, max_calls=0):
        self.max_calls = max(0, int(max_calls or 0))
        self.used = 0
        self._lock = threading.Lock()

    def reserve(self):
        with self._lock:
            if self.max_calls and self.used >= self.max_calls:
                raise CrawlerError('budget_exhausted', f'API request budget exhausted ({self.used}/{self.max_calls})')
            self.used += 1
            return self.used

    @property
    def remaining(self):
        if not self.max_calls:
            return None
        return max(0, self.max_calls - self.used)


class ResponseCache:
    def __init__(self, base_dir=None):
        self.base_dir = Path(base_dir or os.environ.get('TW_CRAWLER_CACHE_DIR') or Path.cwd() / 'web_data' / 'response_cache')

    def _path(self, namespace, key):
        safe_namespace = re.sub(r'[^A-Za-z0-9_.-]+', '_', str(namespace or 'default'))[:80] or 'default'
        digest = hashlib.sha256(str(key or '').encode('utf-8')).hexdigest()
        return self.base_dir / safe_namespace / f'{digest}.json'

    def get(self, namespace, key, ttl_seconds):
        if not ttl_seconds:
            return None
        path = self._path(namespace, key)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                payload = json.load(f)
            created_at = float(payload.get('created_at') or 0)
            if time.time() - created_at > ttl_seconds:
                return None
            return payload.get('text')
        except Exception:
            return None

    def set(self, namespace, key, text):
        path = self._path(namespace, key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f:
                json.dump({'created_at': time.time(), 'text': text}, f, ensure_ascii=False)
        except Exception:
            pass


class FileThrottle:
    def __init__(self, base_dir=None, limits=None):
        self.base_dir = Path(base_dir or os.environ.get('TW_THROTTLE_DIR') or Path.cwd() / 'web_data' / 'throttle')
        self.limits = limits or RuntimeLimits.from_env()
        self._local_lock = threading.Lock()

    def wait(self, account_key='', proxy_key='', media_key=''):
        waits = []
        if account_key and self.limits.account_api_interval > 0:
            waits.append(self._reserve('account', account_key, self.limits.account_api_interval))
        if proxy_key and self.limits.proxy_api_interval > 0:
            waits.append(self._reserve('proxy', proxy_key, self.limits.proxy_api_interval))
        if media_key and self.limits.media_download_interval > 0:
            waits.append(self._reserve('media', media_key, self.limits.media_download_interval))
        delay = max(waits or [0])
        if delay > 0:
            time.sleep(delay)

    async def async_wait(self, account_key='', proxy_key='', media_key=''):
        waits = []
        if account_key and self.limits.account_api_interval > 0:
            waits.append(self._reserve('account', account_key, self.limits.account_api_interval))
        if proxy_key and self.limits.proxy_api_interval > 0:
            waits.append(self._reserve('proxy', proxy_key, self.limits.proxy_api_interval))
        if media_key and self.limits.media_download_interval > 0:
            waits.append(self._reserve('media', media_key, self.limits.media_download_interval))
        delay = max(waits or [0])
        if delay > 0:
            await asyncio.sleep(delay)

    def _reserve(self, scope, key, interval):
        """预留资源使用时间槽（支持随机抖动）"""
        # 根据 scope 应用不同的抖动
        try:
            from anti_detection import random_interval
            if scope == 'account':
                actual_interval = random_interval(interval, self.limits.account_api_variance)
            elif scope == 'proxy':
                actual_interval = random_interval(interval, self.limits.proxy_api_variance)
            else:
                actual_interval = interval
        except Exception:
            actual_interval = interval

        self.base_dir.mkdir(parents=True, exist_ok=True)
        path = self.base_dir / f'{scope}-{resource_key(key)}.txt'
        lock_path = self.base_dir / f'{scope}-{resource_key(key)}.lock'
        with self._local_lock, cross_process_lock(lock_path):
            now_ts = time.monotonic()
            previous = 0.0
            if path.exists():
                try:
                    previous = float(path.read_text(encoding='utf-8') or '0')
                except ValueError:
                    previous = 0.0
            available_at = max(now_ts, previous + actual_interval)
            path.write_text(str(available_at), encoding='utf-8')
        return max(0.0, available_at - now_ts)


@contextlib.contextmanager
def cross_process_lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(path, 'a+', encoding='utf-8')
    try:
        if os.name == 'nt':
            import msvcrt

            while True:
                try:
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    time.sleep(0.01)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


class CrawlerClient:
    def __init__(self, cookie='', proxy='', account_key='', throttle=None, headers=None, budget=None, cache=None, account_row=None):
        self.cookie = cookie
        self.proxy = proxy_for_httpx(proxy)
        self.account_key = account_key or cookie
        self.proxy_key = proxy or ''
        self.throttle = throttle or FileThrottle()
        self.headers = dict(headers or standard_headers(cookie, account_row))
        self.limits = RuntimeLimits.from_env()
        self.budget = budget
        self.cache = cache or ResponseCache()
        self.account_row = account_row  # 新增：存储账号信息
        self.request_count = 0  # 新增：请求计数（用于休息机制）

    def _check_and_take_break(self):
        """检查是否需要休息（反检测机制）"""
        try:
            from anti_detection import should_take_break, calculate_break_duration
            if should_take_break(self.request_count, self.limits.break_after_requests):
                duration = calculate_break_duration(self.limits.break_duration_min, self.limits.break_duration_max)
                print(f'[反检测] 已请求 {self.request_count} 次，休息 {duration} 秒...', flush=True)
                time.sleep(duration)
                self.request_count = 0
        except Exception:
            pass  # 如果反检测模块不可用，跳过

    def get_text(self, url, headers=None, timeout=DEFAULT_TIMEOUT, quote=True, cache_namespace='', cache_key='', cache_ttl=0):
        # 检查是否需要休息
        self._check_and_take_break()

        if cache_ttl:
            cached = self.cache.get(cache_namespace or 'http_text', cache_key or url, cache_ttl)
            if cached is not None:
                print(f'CRAWLER_CACHE_HIT={cache_namespace or "http_text"}', flush=True)
                return cached
        request_headers = dict(self.headers)
        if headers:
            request_headers.update(headers)
        response = self._request_with_retries(url, request_headers, timeout, quote)
        text = response.text
        if cache_ttl:
            self.cache.set(cache_namespace or 'http_text', cache_key or url, text)
        return text

    def get_bytes(self, url, headers=None, timeout=DEFAULT_TIMEOUT, quote=True):
        request_headers = dict(self.headers)
        if headers:
            request_headers.update(headers)
        return self._request_with_retries(url, request_headers, timeout, quote).content

    def get_media_bytes(self, url, headers=None, timeout=DEFAULT_TIMEOUT, quote=True):
        request_headers = dict(self.headers)
        if headers:
            request_headers.update(headers)
        return self._request_with_retries(url, request_headers, timeout, quote, media=True).content

    def _request_with_retries(self, url, headers, timeout, should_quote, media=False):
        last_error = None
        for attempt in range(1, self.limits.max_retries + 1):
            try:
                self.throttle.wait(self.account_key if not media else '', self.proxy_key if not media else '', self.proxy_key or self.account_key if media else '')
                if self.budget and not media:
                    self.budget.reserve()
                response = httpx.get(quote_url(url) if should_quote else url, headers=headers, proxy=self.proxy, timeout=timeout)
                self._maybe_emit_low_remaining(response)
                raise_for_crawler_response(response)
                # 请求成功，增加计数
                if not media:
                    self.request_count += 1
                return response
            except Exception as exc:
                last_error = exc
                error_type = classify_exception(exc)
                if error_type in {'auth_expired', 'target_unavailable'} or attempt >= self.limits.max_retries:
                    if isinstance(exc, CrawlerError):
                        raise
                    raise CrawlerError(error_type, str(exc)) from exc
                time.sleep(self.limits.backoff_base * attempt)
        raise CrawlerError(classify_exception(last_error), str(last_error))

    def _maybe_emit_low_remaining(self, response):
        info = parse_rate_limit_headers(response.headers)
        remaining = info.get('remaining')
        reset = info.get('reset')
        try:
            threshold = int(os.environ.get('TW_RATE_LIMIT_LOW_REMAINING', '1') or 1)
        except ValueError:
            threshold = 1
        if reset and remaining is not None and remaining <= threshold:
            emit_rate_limit_marker(info)


class AsyncCrawlerClient:
    def __init__(self, cookie='', proxy='', account_key='', throttle=None, headers=None, max_connections=8):
        self.cookie = cookie
        self.proxy = proxy_for_httpx(proxy)
        self.account_key = account_key or cookie
        self.proxy_key = proxy or ''
        self.throttle = throttle or FileThrottle()
        self.headers = dict(headers or standard_headers(cookie))
        self.limits = RuntimeLimits.from_env()
        limits = httpx.Limits(max_connections=max_connections, max_keepalive_connections=max_connections)
        self.client = httpx.AsyncClient(proxy=self.proxy, limits=limits)

    async def aclose(self):
        await self.client.aclose()

    async def get(self, url, headers=None, timeout=DEFAULT_TIMEOUT, quote=True, media=False):
        request_headers = dict(self.headers)
        if headers:
            request_headers.update(headers)
        last_error = None
        for attempt in range(1, self.limits.max_retries + 1):
            try:
                await self.throttle.async_wait(self.account_key if not media else '', self.proxy_key if not media else '', self.proxy_key or self.account_key if media else '')
                response = await self.client.get(quote_url(url) if quote else url, headers=request_headers, timeout=timeout)
                self._maybe_emit_low_remaining(response)
                raise_for_crawler_response(response)
                return response
            except Exception as exc:
                last_error = exc
                error_type = classify_exception(exc)
                if error_type in {'auth_expired', 'target_unavailable'} or attempt >= self.limits.max_retries:
                    if isinstance(exc, CrawlerError):
                        raise
                    raise CrawlerError(error_type, str(exc)) from exc
                await asyncio.sleep(self.limits.backoff_base * attempt)
        raise CrawlerError(classify_exception(last_error), str(last_error))

    def _maybe_emit_low_remaining(self, response):
        info = parse_rate_limit_headers(response.headers)
        remaining = info.get('remaining')
        reset = info.get('reset')
        try:
            threshold = int(os.environ.get('TW_RATE_LIMIT_LOW_REMAINING', '1') or 1)
        except ValueError:
            threshold = 1
        if reset and remaining is not None and remaining <= threshold:
            emit_rate_limit_marker(info)
