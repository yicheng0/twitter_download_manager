import os
import tempfile
import time
import unittest
from unittest.mock import patch

os.environ['TW_WEB_DATA_DIR'] = tempfile.mkdtemp(prefix='twitter-runtime-web-')
os.environ['TW_THROTTLE_DIR'] = tempfile.mkdtemp(prefix='twitter-runtime-throttle-')
os.environ['TW_ACCOUNT_API_INTERVAL_SECONDS'] = '0.05'
os.environ['TW_PROXY_API_INTERVAL_SECONDS'] = '0'
os.environ['TW_MEDIA_DOWNLOAD_INTERVAL_SECONDS'] = '0.05'
os.environ['TW_CRAWLER_REQUEST_RETRIES'] = '1'
os.environ['TW_WEB_PUBLIC'] = '0'

import crawler_runtime  # noqa: E402
import web_app  # noqa: E402


class CrawlerRuntimeTest(unittest.TestCase):
    def test_classify_http_statuses(self):
        self.assertEqual(crawler_runtime.classify_response(401), 'auth_expired')
        self.assertEqual(crawler_runtime.classify_response(403), 'auth_expired')
        self.assertEqual(crawler_runtime.classify_response(429), 'rate_limited')
        self.assertEqual(crawler_runtime.classify_response(404), 'target_unavailable')
        self.assertEqual(crawler_runtime.classify_response(503), 'network_failed')

    def test_classify_exception_text(self):
        self.assertEqual(crawler_runtime.classify_exception(RuntimeError('proxy timeout')), 'network_failed')
        self.assertEqual(crawler_runtime.classify_exception(RuntimeError('Rate limit exceeded')), 'rate_limited')
        self.assertEqual(crawler_runtime.classify_exception(RuntimeError('HTTP 403')), 'auth_expired')

    def test_file_throttle_reserves_account_interval(self):
        limits = crawler_runtime.RuntimeLimits(account_api_interval=0.05, proxy_api_interval=0, media_download_interval=0, max_retries=1, backoff_base=0.1)
        throttle = crawler_runtime.FileThrottle(base_dir=os.environ['TW_THROTTLE_DIR'], limits=limits)
        start = time.monotonic()
        throttle.wait('account-a')
        throttle.wait('account-a')
        elapsed = time.monotonic() - start
        self.assertGreaterEqual(elapsed, 0.04)

    def test_media_throttle_is_independent_from_account_interval(self):
        limits = crawler_runtime.RuntimeLimits(account_api_interval=10, proxy_api_interval=0, media_download_interval=0.05, max_retries=1, backoff_base=0.1)
        throttle = crawler_runtime.FileThrottle(base_dir=os.environ['TW_THROTTLE_DIR'], limits=limits)
        start = time.monotonic()
        throttle.wait(media_key='proxy-a')
        throttle.wait(media_key='proxy-a')
        elapsed = time.monotonic() - start
        self.assertLess(elapsed, 1)
        self.assertGreaterEqual(elapsed, 0.04)

    def test_web_failure_classification_uses_structured_marker(self):
        error_type, message = web_app.classify_failure('CRAWLER_ERROR_TYPE=rate_limited\nanything', 1)
        self.assertEqual(error_type, 'rate_limited')
        self.assertIn('超限', message)

    def test_rate_limit_headers_are_attached_to_crawler_error(self):
        response = crawler_runtime.httpx.Response(
            429,
            text='Rate limit exceeded',
            headers={'x-rate-limit-remaining': '0', 'x-rate-limit-reset': '1893456000'},
        )
        with self.assertRaises(crawler_runtime.CrawlerError) as caught:
            crawler_runtime.raise_for_crawler_response(response)
        self.assertEqual(caught.exception.error_type, 'rate_limited')
        self.assertEqual(caught.exception.rate_limit_remaining, 0)
        self.assertEqual(caught.exception.rate_limit_reset, 1893456000)

    def test_request_budget_blocks_after_limit(self):
        budget = crawler_runtime.RequestBudget(1)
        budget.reserve()
        with self.assertRaises(crawler_runtime.CrawlerError) as caught:
            budget.reserve()
        self.assertEqual(caught.exception.error_type, 'budget_exhausted')

    def test_response_cache_hit_avoids_http_request_and_budget_increment(self):
        cache_dir = tempfile.mkdtemp(prefix='twitter-response-cache-')
        cache = crawler_runtime.ResponseCache(cache_dir)
        budget = crawler_runtime.RequestBudget(1)
        client = crawler_runtime.CrawlerClient(cookie='auth_token=a; ct0=c;', budget=budget, cache=cache)
        response = crawler_runtime.httpx.Response(200, text='{"ok": true}')
        with patch('crawler_runtime.httpx.get', return_value=response) as mocked_get:
            first = client.get_text('https://example.test/UserByScreenName', cache_namespace='user_by_screen_name', cache_key='acct', cache_ttl=86400)
            second = client.get_text('https://example.test/UserByScreenName', cache_namespace='user_by_screen_name', cache_key='acct', cache_ttl=86400)
        self.assertEqual(first, second)
        self.assertEqual(budget.used, 1)
        self.assertEqual(mocked_get.call_count, 1)

    def test_auth_expired_does_not_retry_even_when_retry_limit_is_higher(self):
        limits = crawler_runtime.RuntimeLimits(account_api_interval=0, proxy_api_interval=0, media_download_interval=0, max_retries=3, backoff_base=0.1)
        throttle = crawler_runtime.FileThrottle(base_dir=os.environ['TW_THROTTLE_DIR'], limits=limits)
        client = crawler_runtime.CrawlerClient(cookie='auth_token=a; ct0=c;', throttle=throttle)
        client.limits = limits
        with patch('crawler_runtime.httpx.get', return_value=crawler_runtime.httpx.Response(403, text='forbidden')) as mocked_get:
            with self.assertRaises(crawler_runtime.CrawlerError) as caught:
                client.get_text('https://example.test/auth')
        self.assertEqual(caught.exception.error_type, 'auth_expired')
        self.assertEqual(mocked_get.call_count, 1)


if __name__ == '__main__':
    unittest.main()
