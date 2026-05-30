import os
import tempfile
import unittest

os.environ['TW_WEB_DATA_DIR'] = tempfile.mkdtemp(prefix='twitter-resource-governance-')
os.environ['TW_WEB_PUBLIC'] = '0'

import web_app  # noqa: E402


class ResourceGovernanceTest(unittest.TestCase):
    def setUp(self):
        web_app.init_db()
        with web_app.db() as conn:
            conn.execute('delete from operation_logs')
            conn.execute('delete from scheduled_tasks')
            conn.execute('delete from tasks')
            conn.execute('delete from proxies')
            conn.execute('delete from tracked_bloggers')
            conn.execute('delete from accounts')

    def test_auto_account_skips_cooldown_account(self):
        with web_app.db() as conn:
            conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, cooldown_until)
                values (?, ?, ?, ?, ?, 'active', ?, ?, ?)
                ''',
                ('cooldown', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'cooldown', web_app.now(), web_app.now(), web_app.seconds_from_now(3600)),
            )
            conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at)
                values (?, ?, ?, ?, ?, 'active', ?, ?)
                ''',
                ('ready', 'a2', 'c2', 'auth_token=a2; ct0=c2;', 'ready', web_app.now(), web_app.now()),
            )

        selected = web_app.select_account_for_task()
        self.assertEqual(selected['label'], 'ready')

    def test_account_capacity_payload_reports_remaining_budget(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier, daily_quota)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 'stable', 20)
                ''',
                ('capacity', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'capacity', web_app.now(), web_app.now()),
            ).lastrowid
            conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at, api_calls)
                values (1, ?, 'benchmark_account', 'used task', '{}', 'completed', ?, ?, ?, 7)
                ''',
                (account_id, os.environ['TW_WEB_DATA_DIR'], os.path.join(os.environ['TW_WEB_DATA_DIR'], 'used.log'), web_app.now()),
            )
            account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
            capacity = web_app.account_capacity_payload(account, conn)

        self.assertEqual(capacity['api_used_24h'], 7)
        self.assertEqual(capacity['api_budget_24h'], 20)
        self.assertEqual(capacity['api_remaining_estimate'], 13)
        self.assertEqual(capacity['level'], 'healthy')
        self.assertEqual(capacity['adaptive_policy']['risk_level'], 'healthy')

    def test_account_capacity_marks_cooldown_and_expired_accounts(self):
        with web_app.db() as conn:
            cooldown_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, cooldown_until)
                values (?, ?, ?, ?, ?, 'active', ?, ?)
                ''',
                ('cooling', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'cooling', web_app.now(), web_app.seconds_from_now(3600)),
            ).lastrowid
            expired_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at)
                values (?, ?, ?, ?, ?, 'auth_expired', ?)
                ''',
                ('expired', 'a2', 'c2', 'auth_token=a2; ct0=c2;', 'expired', web_app.now()),
            ).lastrowid
            cooling = web_app.account_capacity_payload(conn.execute('select * from accounts where id = ?', (cooldown_id,)).fetchone(), conn)
            expired = web_app.account_capacity_payload(conn.execute('select * from accounts where id = ?', (expired_id,)).fetchone(), conn)

        self.assertEqual(cooling['level'], 'cooldown')
        self.assertGreater(cooling['cooldown_remaining_seconds'], 0)
        self.assertEqual(expired['score'], 0)
        self.assertEqual(expired['level'], 'expired')
        self.assertEqual(cooling['adaptive_policy']['risk_level'], 'cooldown')
        self.assertEqual(expired['adaptive_policy']['risk_level'], 'expired')

    def test_account_capacity_marks_exhausted_daily_api_budget(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, tier, daily_quota)
                values (?, ?, ?, ?, ?, 'active', ?, 'stable', 10)
                ''',
                ('limited', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'limited', web_app.now()),
            ).lastrowid
            conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at, api_calls)
                values (1, ?, 'benchmark_account', 'budget task', '{}', 'completed', ?, ?, ?, 12)
                ''',
                (account_id, os.environ['TW_WEB_DATA_DIR'], os.path.join(os.environ['TW_WEB_DATA_DIR'], 'budget.log'), web_app.now()),
            )
            account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
            capacity = web_app.account_capacity_payload(account, conn)

        self.assertEqual(capacity['api_remaining_estimate'], 0)
        self.assertEqual(capacity['level'], 'limited')
        self.assertLessEqual(capacity['score'], 25)

    def test_adaptive_policy_marks_watch_and_risky_accounts(self):
        with web_app.db() as conn:
            watch_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, tier, daily_quota)
                values (?, ?, ?, ?, ?, 'active', ?, 'stable', 100)
                ''',
                ('watch', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'watch', web_app.now()),
            ).lastrowid
            risky_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, tier, daily_quota)
                values (?, ?, ?, ?, ?, 'active', ?, 'stable', 100)
                ''',
                ('risky', 'a2', 'c2', 'auth_token=a2; ct0=c2;', 'risky', web_app.now()),
            ).lastrowid
            conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at, api_calls, last_error_type)
                values (1, ?, 'benchmark_account', 'limited', '{}', 'failed', ?, ?, ?, 1, 'rate_limited')
                ''',
                (risky_id, os.environ['TW_WEB_DATA_DIR'], os.path.join(os.environ['TW_WEB_DATA_DIR'], 'risky.log'), web_app.now()),
            )
            conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at, api_calls, last_error_type)
                values (1, ?, 'benchmark_account', 'failed', '{}', 'failed', ?, ?, ?, 1, 'failed')
                ''',
                (watch_id, os.environ['TW_WEB_DATA_DIR'], os.path.join(os.environ['TW_WEB_DATA_DIR'], 'watch.log'), web_app.now()),
            )
            watch = web_app.account_capacity_payload(conn.execute('select * from accounts where id = ?', (watch_id,)).fetchone(), conn)
            risky = web_app.account_capacity_payload(conn.execute('select * from accounts where id = ?', (risky_id,)).fetchone(), conn)

        self.assertEqual(watch['adaptive_policy']['risk_level'], 'watch')
        self.assertEqual(risky['adaptive_policy']['risk_level'], 'risky')
        self.assertEqual(risky['adaptive_policy']['max_tweet_limit'], web_app.RISKY_TWEET_LIMIT)

    def test_watch_account_creation_applies_adaptive_throttle(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier, daily_quota)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 'stable', 100)
                ''',
                ('watch-create', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'watchcreate', web_app.now(), web_app.now()),
            ).lastrowid
            conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at, api_calls, last_error_type)
                values (1, ?, 'benchmark_account', 'failed', '{}', 'failed', ?, ?, ?, 1, 'failed')
                ''',
                (account_id, os.environ['TW_WEB_DATA_DIR'], os.path.join(os.environ['TW_WEB_DATA_DIR'], 'watch-create.log'), web_app.now()),
            )

        config = {
            'task_type': 'benchmark_account',
            'targets': 'watchcreate',
            'time_range': web_app.task_default_time_range(),
            'tweet_limit': 50,
            'max_concurrent_requests': 5,
            'likes': True,
            'has_retweet': True,
        }
        web_app.validate_task_config(config)
        task_id = web_app.create_queued_task(1, account_id, config)

        with web_app.db() as conn:
            task = conn.execute('select * from tasks where id = ?', (task_id,)).fetchone()
        saved = web_app.json.loads(task['config_json'])
        self.assertTrue(saved['adaptive_throttle_applied'])
        self.assertEqual(saved['tweet_limit'], web_app.WATCH_TWEET_LIMIT)
        self.assertEqual(saved['max_concurrent_requests'], 2)
        self.assertFalse(saved['likes'])
        self.assertEqual(saved['adaptive_policy']['risk_level'], 'watch')

    def test_risky_account_creation_forces_small_slice(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier, daily_quota)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 'stable', 100)
                ''',
                ('risky-create', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'riskycreate', web_app.now(), web_app.now()),
            ).lastrowid
            conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at, api_calls, last_error_type)
                values (1, ?, 'benchmark_account', 'limited', '{}', 'failed', ?, ?, ?, 1, 'rate_limited')
                ''',
                (account_id, os.environ['TW_WEB_DATA_DIR'], os.path.join(os.environ['TW_WEB_DATA_DIR'], 'limited.log'), web_app.now()),
            )

        config = {
            'task_type': 'benchmark_account',
            'targets': 'riskycreate',
            'time_range': web_app.task_default_time_range(),
            'tweet_limit': 50,
            'max_concurrent_requests': 4,
            'likes': True,
            'has_retweet': True,
            'high_lights': True,
        }
        web_app.validate_task_config(config)
        task_id = web_app.create_queued_task(1, account_id, config)

        with web_app.db() as conn:
            task = conn.execute('select * from tasks where id = ?', (task_id,)).fetchone()
        saved = web_app.json.loads(task['config_json'])
        self.assertEqual(saved['tweet_limit'], web_app.RISKY_TWEET_LIMIT)
        self.assertEqual(saved['max_concurrent_requests'], 1)
        self.assertFalse(saved['likes'])
        self.assertFalse(saved['has_retweet'])
        self.assertFalse(saved['high_lights'])
        self.assertEqual(saved['adaptive_policy']['risk_level'], 'risky')

    def test_cooldown_and_expired_accounts_reject_new_tasks(self):
        with web_app.db() as conn:
            cooldown_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier, cooldown_until)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 'stable', ?)
                ''',
                ('cooldown-create', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'cooldowncreate', web_app.now(), web_app.now(), web_app.seconds_from_now(3600)),
            ).lastrowid
            expired_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier)
                values (?, ?, ?, ?, ?, 'auth_expired', ?, ?, 'stable')
                ''',
                ('expired-create', 'a2', 'c2', 'auth_token=a2; ct0=c2;', 'expiredcreate', web_app.now(), web_app.now()),
            ).lastrowid

        config = {
            'task_type': 'benchmark_account',
            'targets': 'cooldowncreate',
            'time_range': web_app.task_default_time_range(),
            'tweet_limit': 5,
            'max_concurrent_requests': 1,
        }
        web_app.validate_task_config(config)
        with self.assertRaises(web_app.HTTPException):
            web_app.create_queued_task(1, cooldown_id, dict(config))
        with self.assertRaises(web_app.HTTPException):
            web_app.create_queued_task(1, expired_id, {**config, 'targets': 'expiredcreate'})

    def test_auto_account_prefers_higher_capacity_score(self):
        with web_app.db() as conn:
            low_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, tier, daily_quota, failure_count)
                values (?, ?, ?, ?, ?, 'active', ?, 'stable', 10, 5)
                ''',
                ('low', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'low', web_app.now()),
            ).lastrowid
            conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, tier, daily_quota)
                values (?, ?, ?, ?, ?, 'active', ?, 'stable', 50)
                ''',
                ('high', 'a2', 'c2', 'auth_token=a2; ct0=c2;', 'high', web_app.now()),
            )
            conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at, api_calls)
                values (1, ?, 'benchmark_account', 'spent task', '{}', 'completed', ?, ?, ?, 9)
                ''',
                (low_id, os.environ['TW_WEB_DATA_DIR'], os.path.join(os.environ['TW_WEB_DATA_DIR'], 'spent.log'), web_app.now()),
            )

        selected = web_app.select_account_for_task()
        self.assertEqual(selected['label'], 'high')

    def test_uncertain_accounts_keep_usable_policy_but_clear_capacity_reason(self):
        self.assertIn(web_app.ACCOUNT_UNKNOWN_STATUS, web_app.ACCOUNT_USABLE_STATUSES)
        self.assertIn(web_app.ACCOUNT_CHECK_FAILED_STATUS, web_app.ACCOUNT_USABLE_STATUSES)
        with web_app.db() as conn:
            unknown = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier)
                values (?, ?, ?, ?, ?, ?, ?, ?, 'new')
                ''',
                ('unknown-account', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'unknownacct', web_app.ACCOUNT_UNKNOWN_STATUS, web_app.now(), web_app.now()),
            ).lastrowid
            check_failed = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier, last_error)
                values (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
                ''',
                ('check-failed-account', 'a2', 'c2', 'auth_token=a2; ct0=c2;', 'checkfailedacct', web_app.ACCOUNT_CHECK_FAILED_STATUS, web_app.now(), web_app.now(), 'HTTP 404'),
            ).lastrowid
            unknown_account = conn.execute('select * from accounts where id = ?', (unknown,)).fetchone()
            check_failed_account = conn.execute('select * from accounts where id = ?', (check_failed,)).fetchone()

            unknown_capacity = web_app.account_capacity_payload(unknown_account, conn)
            check_failed_capacity = web_app.account_capacity_payload(check_failed_account, conn)

        self.assertEqual(unknown_capacity['reason'], '检测未确认，可尝试使用')
        self.assertEqual(check_failed_capacity['reason'], '检测异常，可尝试但需关注')

    def test_new_account_daily_limit_blocks_manual_selection(self):
        with web_app.db() as conn:
            cursor = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 'new')
                ''',
                ('new-account', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'newbie', web_app.now(), web_app.now()),
            )
            account_id = cursor.lastrowid
            for index in range(web_app.ACCOUNT_NEW_TASK_LIMIT_24H):
                conn.execute(
                    '''
                    insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at)
                    values (1, ?, 'benchmark_account', ?, '{}', 'completed', ?, ?, ?)
                    ''',
                    (account_id, f'task-{index}', os.environ['TW_WEB_DATA_DIR'], os.path.join(os.environ['TW_WEB_DATA_DIR'], f'{index}.log'), web_app.now()),
                )

        with self.assertRaises(web_app.HTTPException):
            web_app.select_account_for_task(account_id)

    def test_resource_result_sets_rate_limit_cooldown(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at)
                values (?, ?, ?, ?, ?, 'active', ?, ?)
                ''',
                ('account', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'acct', web_app.now(), web_app.now()),
            ).lastrowid
            proxy_id = conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, created_at)
                values (?, ?, 1, 'active', ?)
                ''',
                ('proxy', 'http://127.0.0.1:8080', web_app.now()),
            ).lastrowid

        web_app.record_task_resource_result({'account_id': account_id, 'proxy_id': proxy_id}, 'rate_limited', 'rate_limited')

        with web_app.db() as conn:
            account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
            proxy = conn.execute('select * from proxies where id = ?', (proxy_id,)).fetchone()
        self.assertIsNotNone(account['cooldown_until'])
        self.assertIsNotNone(proxy['cooldown_until'])
        self.assertEqual(account['failure_count'], 1)
        self.assertEqual(proxy['failure_count'], 1)

    def test_resource_result_uses_rate_limit_reset_marker(self):
        reset_at = web_app.seconds_from_now(7200)
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at)
                values (?, ?, ?, ?, ?, 'active', ?, ?)
                ''',
                ('account-reset', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'acctreset', web_app.now(), web_app.now()),
            ).lastrowid

        web_app.record_task_resource_result({'account_id': account_id}, 'rate_limited', 'rate_limited', reset_at)

        with web_app.db() as conn:
            account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
        self.assertEqual(account['cooldown_until'], reset_at)

    def test_estimate_benchmark_api_budget(self):
        config = {'task_type': 'benchmark_account', 'targets': 'one\ntwo', 'tweet_limit': 21}
        self.assertEqual(web_app.estimate_api_budget(config), 6)

    def test_target_limits_drive_budget_and_validation(self):
        config = {'task_type': 'benchmark_account', 'targets': 'one\ntwo', 'tweet_limit': 10, 'target_limits': {'one': 5, 'two': 41}}
        web_app.validate_task_config(config)
        self.assertEqual(config['target_limits'], {'one': 5, 'two': 41})
        self.assertEqual(web_app.estimate_api_budget(config), 6)

        invalid = {'task_type': 'benchmark_account', 'targets': 'one', 'tweet_limit': 10, 'target_limits': {'two': 5}}
        with self.assertRaises(web_app.HTTPException):
            web_app.validate_task_config(invalid)

    def test_automatic_concurrency_uses_conservative_base(self):
        original_default = web_app.DEFAULT_MAX_CONCURRENT_REQUESTS
        try:
            web_app.DEFAULT_MAX_CONCURRENT_REQUESTS = 8
            config = {'task_type': 'benchmark_account', 'targets': 'one', 'tweet_limit': 10}
            web_app.validate_task_config(config)
        finally:
            web_app.DEFAULT_MAX_CONCURRENT_REQUESTS = original_default
        self.assertEqual(config['max_concurrent_requests'], 2)

    def test_missing_concurrency_is_selected_automatically(self):
        config = {
            'task_type': 'benchmark_account',
            'targets': 'one',
            'time_range': web_app.task_default_time_range(),
            'tweet_limit': 10,
        }
        web_app.validate_task_config(config)
        self.assertEqual(config['max_concurrent_requests'], 2)

    def test_large_healthy_task_uses_higher_automatic_concurrency(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 'stable')
                ''',
                ('large-auto', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'largeauto', web_app.now(), web_app.now()),
            ).lastrowid

        config = {
            'task_type': 'benchmark_account',
            'targets': 'one\ntwo',
            'time_range': web_app.task_default_time_range(),
            'tweet_limit': 50,
        }
        web_app.validate_task_config(config)
        task_id = web_app.create_queued_task(1, account_id, config)

        with web_app.db() as conn:
            task = conn.execute('select * from tasks where id = ?', (task_id,)).fetchone()
        saved = web_app.json.loads(task['config_json'])
        self.assertEqual(saved['max_concurrent_requests'], 3)

    def test_benchmark_task_title_omits_repeated_type_prefix(self):
        self.assertEqual(
            web_app.title_from_config({'task_type': 'benchmark_account', 'targets': 'arsenal'}),
            'arsenal',
        )

    def test_create_task_records_tracked_bloggers(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 'stable')
                ''',
                ('blogger-account', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'acct', web_app.now(), web_app.now()),
            ).lastrowid
            second_account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 'stable')
                ''',
                ('blogger-account-2', 'a2', 'c2', 'auth_token=a2; ct0=c2;', 'acct2', web_app.now(), web_app.now()),
            ).lastrowid

        config = {
            'task_type': 'benchmark_account',
            'targets': 'one\ntwo',
            'time_range': web_app.task_default_time_range(),
            'tweet_limit': 10,
            'target_limits': {'one': 5, 'two': 12},
            'max_concurrent_requests': 1,
        }
        web_app.validate_task_config(config)
        web_app.create_queued_task(1, account_id, config)
        web_app.create_queued_task(1, second_account_id, dict(config))

        with web_app.db() as conn:
            rows = conn.execute('select * from tracked_bloggers order by screen_name').fetchall()
        self.assertEqual([row['screen_name'] for row in rows], ['one', 'two'])
        self.assertEqual([row['default_tweet_limit'] for row in rows], [5, 12])
        self.assertEqual([row['use_count'] for row in rows], [2, 2])

    def test_blogger_crud_helpers(self):
        with web_app.db() as conn:
            row = web_app.upsert_tracked_blogger(conn, 'https://x.com/example', default_tweet_limit=7)
            self.assertEqual(row['screen_name'], 'example')
            self.assertEqual(row['default_tweet_limit'], 7)
            updated = web_app.upsert_tracked_blogger(conn, '@example', default_tweet_limit=9, mark_used=True)
            self.assertEqual(updated['default_tweet_limit'], 9)
            self.assertEqual(updated['use_count'], 1)

    def test_adaptive_throttle_caps_target_limits(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier, daily_quota)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 'stable', 100)
                ''',
                ('risky-limits', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'riskylimits', web_app.now(), web_app.now()),
            ).lastrowid
            conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at, api_calls, last_error_type)
                values (1, ?, 'benchmark_account', 'limited', '{}', 'failed', ?, ?, ?, 1, 'rate_limited')
                ''',
                (account_id, os.environ['TW_WEB_DATA_DIR'], os.path.join(os.environ['TW_WEB_DATA_DIR'], 'risky-limits.log'), web_app.now()),
            )

        config = {
            'task_type': 'benchmark_account',
            'targets': 'one\ntwo',
            'time_range': web_app.task_default_time_range(),
            'tweet_limit': 50,
            'target_limits': {'one': 5, 'two': 50},
            'max_concurrent_requests': 2,
        }
        web_app.validate_task_config(config)
        task_id = web_app.create_queued_task(1, account_id, config)
        with web_app.db() as conn:
            task = conn.execute('select * from tasks where id = ?', (task_id,)).fetchone()
        saved = web_app.json.loads(task['config_json'])
        self.assertEqual(saved['target_limits']['one'], 5)
        self.assertEqual(saved['target_limits']['two'], web_app.RISKY_TWEET_LIMIT)

    def test_parse_crawler_rate_limit_reset_marker(self):
        reset_at = web_app.seconds_from_now(3600)
        self.assertEqual(web_app.parse_crawler_rate_limit_reset(f'CRAWLER_RATE_LIMIT_RESET={reset_at}'), reset_at)

    def test_budget_exhausted_is_classified_without_retry_error(self):
        error_type, message = web_app.classify_failure('CRAWLER_ERROR_TYPE=budget_exhausted\nAPI 预算已用尽', 1)
        self.assertEqual(error_type, 'budget_exhausted')
        self.assertIn('预算', message)
        self.assertFalse(web_app.should_retry_task(error_type))

    def test_release_reserved_resources_on_queued_cancel(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, task_count, last_used_at)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 1, ?)
                ''',
                ('account', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'acct', web_app.now(), web_app.now(), web_app.now()),
            ).lastrowid
            task_id = conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at)
                values (1, ?, 'benchmark_account', 'queued task', '{}', 'queued', ?, ?, ?)
                ''',
                (account_id, web_app.DATA_DIR.as_posix(), web_app.DATA_DIR.joinpath('t.log').as_posix(), web_app.now()),
            ).lastrowid
            task = conn.execute('select * from tasks where id = ?', (task_id,)).fetchone()

        with web_app.db() as conn:
            web_app.release_reserved_resources_in_conn(conn, task)
            conn.execute("update tasks set status = 'cancelled', finished_at = ?, error = ?, last_error_type = ? where id = ?", (web_app.now(), '用户取消', 'cancelled', task_id))

        with web_app.db() as conn:
            account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
        self.assertEqual(account['task_count'], 0)

    def test_scheduled_auto_account_reserves_available_account(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at, tier)
                values (?, ?, ?, ?, ?, 'active', ?, ?, 'stable')
                ''',
                ('auto-account', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'autoacct', web_app.now(), web_app.now()),
            ).lastrowid

        config = {
            'task_type': 'benchmark_account',
            'targets': 'autoacct',
            'time_range': web_app.task_default_time_range(),
            'tweet_limit': 1,
            'max_concurrent_requests': 1,
            'has_video': False,
        }
        original_start_worker = web_app.start_background_worker
        web_app.start_background_worker = lambda: None
        try:
            task_id = web_app.create_queued_task(1, 0, config, resource_mode='scheduled', schedule_id=123)
        finally:
            web_app.start_background_worker = original_start_worker

        with web_app.db() as conn:
            task = conn.execute('select * from tasks where id = ?', (task_id,)).fetchone()
            account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
        self.assertEqual(task['account_id'], account_id)
        self.assertEqual(task['resource_mode'], 'scheduled')
        self.assertEqual(task['schedule_id'], 123)
        self.assertEqual(account['task_count'], 1)
        self.assertIsNotNone(account['last_used_at'])

    def test_health_status_exposes_resource_policy(self):
        payload = web_app.health_status_payload()

        self.assertIn('resource_policy', payload)
        self.assertEqual(payload['resource_policy']['account_new_task_limit_24h'], web_app.ACCOUNT_NEW_TASK_LIMIT_24H)
        self.assertEqual(payload['resource_policy']['proxy_min_interval_seconds'], web_app.PROXY_MIN_INTERVAL_SECONDS)
        self.assertEqual(payload['resource_policy']['proxy_health_min_interval_seconds'], web_app.PROXY_HEALTH_MIN_INTERVAL_SECONDS)
        self.assertEqual(payload['resource_policy']['default_max_concurrent_requests'], web_app.DEFAULT_MAX_CONCURRENT_REQUESTS)
        self.assertEqual(payload['resource_policy']['account_api_interval_seconds'], web_app.ACCOUNT_API_INTERVAL_SECONDS)

    def test_proxy_health_failure_keeps_enabled_and_cools_down(self):
        with web_app.db() as conn:
            proxy_id = conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, created_at)
                values (?, ?, 1, 'active', ?)
                ''',
                ('proxy', 'http://127.0.0.1:8080', web_app.now()),
            ).lastrowid

        refreshed = web_app.update_proxy_health(proxy_id, False, error='connect timeout')

        self.assertTrue(refreshed['enabled'])
        self.assertEqual(refreshed['status'], 'check_failed')
        self.assertIsNotNone(refreshed['cooldown_until'])
        self.assertEqual(refreshed['failure_count'], 1)
        self.assertIn('connect timeout', refreshed['last_error'])

    def test_proxy_health_success_auto_restores_failed_proxy(self):
        with web_app.db() as conn:
            proxy_id = conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, created_at, cooldown_until, last_error, failure_count)
                values (?, ?, 1, 'check_failed', ?, ?, 'connect timeout', 3)
                ''',
                ('proxy', 'http://127.0.0.1:8080', web_app.now(), web_app.seconds_from_now(1800)),
            ).lastrowid

        refreshed = web_app.update_proxy_health(proxy_id, True, ip='203.0.113.1')

        self.assertTrue(refreshed['enabled'])
        self.assertEqual(refreshed['status'], 'active')
        self.assertEqual(refreshed['detected_ip'], '203.0.113.1')
        self.assertIsNone(refreshed['cooldown_until'])
        self.assertIsNone(refreshed['last_error'])
        self.assertEqual(refreshed['failure_count'], 0)

    def test_auto_proxy_selection_skips_failed_proxy_until_restored(self):
        with web_app.db() as conn:
            conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, created_at, cooldown_until)
                values (?, ?, 1, 'check_failed', ?, ?)
                ''',
                ('failed', 'http://127.0.0.1:8080', web_app.now(), web_app.seconds_from_now(1800)),
            )
            conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, created_at)
                values (?, ?, 1, 'active', ?)
                ''',
                ('ready', 'http://127.0.0.1:8081', web_app.now()),
            )
            selected = web_app.select_proxy_for_task_in_conn(conn)

        self.assertEqual(selected['label'], 'ready')

    def test_account_bound_proxy_is_preferred_for_auto_proxy_selection(self):
        with web_app.db() as conn:
            proxy_id = conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, created_at)
                values (?, ?, 1, 'active', ?)
                ''',
                ('bound', 'http://127.0.0.1:8080', web_app.now()),
            ).lastrowid
            conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, created_at)
                values (?, ?, 1, 'active', ?)
                ''',
                ('fallback', 'http://127.0.0.1:8081', web_app.now()),
            )
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, bound_proxy_id)
                values (?, ?, ?, ?, ?, 'active', ?, ?)
                ''',
                ('bound-account', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'boundacct', web_app.now(), proxy_id),
            ).lastrowid
            selected = web_app.select_proxy_for_task_in_conn(conn, account_id=account_id)

        self.assertEqual(selected['label'], 'bound')

    def test_account_bound_proxy_falls_back_when_unavailable(self):
        with web_app.db() as conn:
            proxy_id = conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, created_at, cooldown_until)
                values (?, ?, 1, 'check_failed', ?, ?)
                ''',
                ('bound-failed', 'http://127.0.0.1:8080', web_app.now(), web_app.seconds_from_now(1800)),
            ).lastrowid
            conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, created_at)
                values (?, ?, 1, 'active', ?)
                ''',
                ('fallback-ready', 'http://127.0.0.1:8081', web_app.now()),
            )
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, bound_proxy_id)
                values (?, ?, ?, ?, ?, 'active', ?, ?)
                ''',
                ('fallback-account', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'fallbackacct', web_app.now(), proxy_id),
            ).lastrowid
            selected = web_app.select_proxy_for_task_in_conn(conn, account_id=account_id)

        self.assertEqual(selected['label'], 'fallback-ready')

    def test_account_warmup_promotes_stable_after_three_successes(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, tier)
                values (?, ?, ?, ?, ?, 'active', ?, 'new')
                ''',
                ('warmup', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'warmupacct', web_app.now()),
            ).lastrowid

        original_validate = web_app.validate_account_cookie
        web_app.validate_account_cookie = lambda cookie: (True, 'warmupacct', '')
        try:
            with web_app.db() as conn:
                for _ in range(web_app.ACCOUNT_WARMUP_STABLE_SUCCESS_THRESHOLD):
                    result = web_app.run_account_warmup_once(conn, account_id)
                    self.assertTrue(result['ok'])
            with web_app.db() as conn:
                account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
        finally:
            web_app.validate_account_cookie = original_validate

        self.assertEqual(account['tier'], 'stable')
        self.assertEqual(account['warmup_success_streak'], web_app.ACCOUNT_WARMUP_STABLE_SUCCESS_THRESHOLD)
        self.assertIsNotNone(account['last_warmup_at'])

    def test_account_warmup_resets_streak_on_failed_check(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, tier, warmup_success_streak)
                values (?, ?, ?, ?, ?, 'active', ?, 'new', 2)
                ''',
                ('warmup-fail', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'warmupfail', web_app.now()),
            ).lastrowid

        original_validate = web_app.validate_account_cookie
        web_app.validate_account_cookie = lambda cookie: (False, None, 'HTTP 401')
        try:
            with web_app.db() as conn:
                result = web_app.run_account_warmup_once(conn, account_id)
            with web_app.db() as conn:
                account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
        finally:
            web_app.validate_account_cookie = original_validate

        self.assertFalse(result['ok'])
        self.assertEqual(account['warmup_success_streak'], 0)
        self.assertNotEqual(account['tier'], 'stable')

    def test_batch_warmup_targets_new_and_low_score_accounts(self):
        with web_app.db() as conn:
            new_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, tier)
                values (?, ?, ?, ?, ?, 'active', ?, 'new')
                ''',
                ('new-warmup', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'newwarmup', web_app.now()),
            ).lastrowid
            stable_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, tier, warmup_success_streak)
                values (?, ?, ?, ?, ?, 'active', ?, 'stable', ?)
                ''',
                ('stable-warmup', 'a2', 'c2', 'auth_token=a2; ct0=c2;', 'stablewarmup', web_app.now(), web_app.ACCOUNT_WARMUP_STABLE_SUCCESS_THRESHOLD),
            ).lastrowid
            targets = web_app.account_warmup_target_ids(conn)

        self.assertIn(new_id, targets)
        self.assertNotIn(stable_id, targets)

    def test_health_check_skips_recently_checked_proxies(self):
        old_checked_at = (web_app.datetime.now() - web_app.timedelta(seconds=web_app.PROXY_HEALTH_MIN_INTERVAL_SECONDS + 30)).strftime('%Y-%m-%d %H:%M:%S')
        with web_app.db() as conn:
            recent_id = conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, last_checked_at, created_at)
                values (?, ?, 1, 'active', ?, ?)
                ''',
                ('recent-proxy', 'http://127.0.0.1:8080', web_app.now(), web_app.now()),
            ).lastrowid
            old_id = conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, last_checked_at, created_at)
                values (?, ?, 1, 'active', ?, ?)
                ''',
                ('old-proxy', 'http://127.0.0.1:8081', old_checked_at, web_app.now()),
            ).lastrowid

        checked = []
        original_account_check = web_app.check_account_row
        original_proxy_check = web_app.check_proxy_row
        web_app.check_account_row = lambda account: None
        web_app.check_proxy_row = lambda proxy: checked.append(proxy['id'])
        try:
            web_app.run_health_check_once()
        finally:
            web_app.check_account_row = original_account_check
            web_app.check_proxy_row = original_proxy_check

        self.assertEqual(checked, [old_id])
        self.assertNotIn(recent_id, checked)

    def test_health_check_skips_running_and_recently_checked_accounts(self):
        with web_app.db() as conn:
            running_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at)
                values (?, ?, ?, ?, ?, 'active', ?)
                ''',
                ('running', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'running', web_app.now()),
            ).lastrowid
            recent_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, last_checked_at, created_at)
                values (?, ?, ?, ?, ?, 'active', ?, ?)
                ''',
                ('recent', 'a2', 'c2', 'auth_token=a2; ct0=c2;', 'recent', web_app.now(), web_app.now()),
            ).lastrowid
            ready_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at)
                values (?, ?, ?, ?, ?, 'active', ?)
                ''',
                ('ready', 'a3', 'c3', 'auth_token=a3; ct0=c3;', 'ready', web_app.now()),
            ).lastrowid
            conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at)
                values (1, ?, 'benchmark_account', 'running task', '{}', 'running', ?, ?, ?)
                ''',
                (running_id, web_app.DATA_DIR.as_posix(), web_app.DATA_DIR.joinpath('running.log').as_posix(), web_app.now()),
            )

        checked = []
        original = web_app.check_account_row
        web_app.check_account_row = lambda account: checked.append(account['id'])
        try:
            web_app.run_health_check_once()
        finally:
            web_app.check_account_row = original

        self.assertEqual(checked, [ready_id])

    def test_concurrency_is_capped_for_account_safety(self):
        self.assertEqual(web_app.safe_max_concurrent_requests(99), web_app.MAX_CONCURRENT_REQUESTS_CAP)
        self.assertEqual(web_app.safe_max_concurrent_requests(''), web_app.DEFAULT_MAX_CONCURRENT_REQUESTS)

    def test_rate_limited_tasks_do_not_retry_immediately(self):
        self.assertFalse(web_app.should_retry_task('rate_limited'))
        self.assertTrue(web_app.should_retry_task('network_failed'))

    def test_precheck_task_budget_rejects_over_remaining_budget(self):
        with web_app.db() as conn:
            account_id = conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at, tier, daily_quota)
                values (?, ?, ?, ?, ?, 'active', ?, 'stable', 5)
                ''',
                ('budget-precheck', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'budgetprecheck', web_app.now()),
            ).lastrowid
            conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at, api_calls)
                values (1, ?, 'benchmark_account', 'used', '{}', 'completed', ?, ?, ?, 4)
                ''',
                (account_id, os.environ['TW_WEB_DATA_DIR'], os.path.join(os.environ['TW_WEB_DATA_DIR'], 'used.log'), web_app.now()),
            )
            account = conn.execute('select * from accounts where id = ?', (account_id,)).fetchone()
            result = web_app.precheck_task_budget({'task_type': 'benchmark_account', 'targets': 'one,two', 'tweet_limit': 50}, account, conn)

        self.assertFalse(result['ok'])
        self.assertGreater(result['budget'], result['allowed'])
        self.assertIn('预计需要', result['message'])

    def test_proxy_payload_includes_quality_score(self):
        with web_app.db() as conn:
            proxy_id = conn.execute(
                '''
                insert into proxies (label, proxy, enabled, status, created_at, success_count, failure_count, health_score, last_check_at)
                values (?, ?, 1, 'active', ?, 8, 2, 0.8, ?)
                ''',
                ('quality-proxy', 'http://127.0.0.1:8080', web_app.now(), web_app.now()),
            ).lastrowid
            proxy = conn.execute('select * from proxies where id = ?', (proxy_id,)).fetchone()
            payload = web_app.proxy_payload(proxy)

        self.assertEqual(payload['quality']['score'], 0.8)
        self.assertEqual(payload['quality']['level'], 'watch')
        self.assertEqual(payload['last_check_at'], payload['quality']['last_check_at'])

    def test_local_login_helper_reports_unsupported_backend(self):
        original_name = web_app.os.name
        try:
            web_app.os.name = 'posix'
            ok, message = web_app.start_local_login_helper_process()
        finally:
            web_app.os.name = original_name

        self.assertFalse(ok)
        self.assertIn('Web 后端不在 Windows 本机', message)

        payload = web_app.local_login_helper_diagnostics('unsupported', message, failure_reason=message)
        self.assertFalse(payload['ok'])
        self.assertEqual(payload['status'], 'unsupported')
        self.assertIn('auto_start_supported', payload)
        self.assertIn('helper_url', payload)

    def test_local_login_helper_install_script_uses_current_vps_host(self):
        script = web_app.local_login_helper_install_script('https://download.example.com', 'download.example.com')
        self.assertIn('download.example.com,127.0.0.1,localhost', script)
        self.assertIn('https://download.example.com/api/accounts/local-browser-login/helper/script', script)
        self.assertIn('TwitterDownloadLocalLoginHelper', script)


if __name__ == '__main__':
    unittest.main()
