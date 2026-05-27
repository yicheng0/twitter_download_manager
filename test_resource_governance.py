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


if __name__ == '__main__':
    unittest.main()
