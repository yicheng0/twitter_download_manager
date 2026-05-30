import json
import os
import tempfile
import unittest
import asyncio

os.environ['TW_WEB_DATA_DIR'] = tempfile.mkdtemp(prefix='twitter-schedule-ops-')
os.environ['TW_WEB_PUBLIC'] = '0'

import web_app  # noqa: E402


class ScheduleOperationsTest(unittest.TestCase):
    def setUp(self):
        web_app.init_db()
        with web_app.db() as conn:
            conn.execute('delete from operation_logs')
            conn.execute('delete from scheduled_tasks')
            conn.execute('delete from tasks')
            conn.execute('delete from accounts')

    def add_account(self):
        with web_app.db() as conn:
            return conn.execute(
                '''
                insert into accounts (label, auth_token, ct0, cookie, screen_name, status, created_at)
                values (?, ?, ?, ?, ?, 'active', ?)
                ''',
                ('account', 'a1', 'c1', 'auth_token=a1; ct0=c1;', 'acct', web_app.now()),
            ).lastrowid

    def add_schedule(self, account_id, next_run_at=None):
        config = {
            'task_type': 'benchmark_account',
            'targets': 'acct',
            'time_range': web_app.task_default_time_range(),
            'tweet_limit': 1,
            'has_video': True,
            'max_concurrent_requests': 1,
        }
        with web_app.db() as conn:
            return conn.execute(
                '''
                insert into scheduled_tasks
                  (user_id, account_id, name, enabled, schedule_type, run_time, weekdays, config_json, next_run_at, created_at, updated_at)
                values (1, ?, 'schedule', 1, 'daily', '09:00', '', ?, ?, ?, ?)
                ''',
                (account_id, json.dumps(config), next_run_at or web_app.seconds_from_now(3600), web_app.now(), web_app.now()),
            ).lastrowid

    def test_schema_migrations_are_recorded_and_idempotent(self):
        web_app.init_db()
        web_app.init_db()
        with web_app.db() as conn:
            row = conn.execute("select value from app_meta where key = 'schema_version'").fetchone()
            columns = {item['name'] for item in conn.execute('pragma table_info(scheduled_tasks)').fetchall()}
        self.assertEqual(int(row['value']), 6)
        self.assertIn('timezone', columns)
        self.assertIn('consecutive_failures', columns)
        with web_app.db() as conn:
            blogger_columns = {item['name'] for item in conn.execute('pragma table_info(tracked_bloggers)').fetchall()}
            monitor_columns = {item['name'] for item in conn.execute('pragma table_info(schedule_monitor_states)').fetchall()}
        self.assertIn('screen_name', blogger_columns)
        self.assertIn('latest_tweet_id', monitor_columns)

    def test_bulk_blogger_import_skips_invalid_and_duplicates(self):
        class FakeRequest:
            async def json(self):
                return {
                    'text': '@one\nhttps://x.com/two\none\nbad-name!',
                    'default_tweet_limit': 7,
                }

        result = asyncio.run(web_app.api_bulk_add_bloggers(FakeRequest(), user={'id': 1, 'role': 'admin'}))

        self.assertEqual([item['screen_name'] for item in result['imported']], ['one', 'two'])
        self.assertEqual(len(result['duplicates']), 1)
        self.assertEqual(len(result['skipped']), 1)
        with web_app.db() as conn:
            row = conn.execute("select default_tweet_limit from tracked_bloggers where screen_name = 'one'").fetchone()
        self.assertEqual(row['default_tweet_limit'], 7)

    def test_monitor_first_run_creates_baseline_without_task(self):
        account_id = self.add_account()
        schedule_id = self.add_schedule(account_id, web_app.now())
        with web_app.db() as conn:
            conn.execute(
                "update scheduled_tasks set config_json = json_set(config_json, '$.monitor_new_content', 1, '$.monitor_interval_minutes', 15) where id = ?",
                (schedule_id,),
            )
            schedule = dict(conn.execute('select * from scheduled_tasks where id = ?', (schedule_id,)).fetchone())

        original = web_app.latest_tweet_for_monitor
        web_app.latest_tweet_for_monitor = lambda screen_name, account, proxy_value='': {
            'screen_name': screen_name,
            'tweet_id': '100',
            'tweet_url': f'https://x.com/{screen_name}/status/100',
            'tweet_at': web_app.now(),
        }
        try:
            web_app.trigger_schedule(schedule)
        finally:
            web_app.latest_tweet_for_monitor = original

        with web_app.db() as conn:
            task_count = conn.execute('select count(*) as count from tasks where schedule_id = ?', (schedule_id,)).fetchone()['count']
            state = conn.execute('select * from schedule_monitor_states where schedule_id = ? and screen_name = ?', (schedule_id, 'acct')).fetchone()
            log = conn.execute("select * from operation_logs where schedule_id = ? and event_type = 'monitor_baseline_created'", (schedule_id,)).fetchone()
        self.assertEqual(task_count, 0)
        self.assertEqual(state['latest_tweet_id'], '100')
        self.assertIsNotNone(log)

    def test_monitor_new_content_creates_task_and_completion_advances_baseline(self):
        account_id = self.add_account()
        schedule_id = self.add_schedule(account_id, web_app.now())
        with web_app.db() as conn:
            conn.execute(
                "update scheduled_tasks set config_json = json_set(config_json, '$.monitor_new_content', 1, '$.monitor_interval_minutes', 15) where id = ?",
                (schedule_id,),
            )
            conn.execute(
                '''
                insert into schedule_monitor_states
                  (schedule_id, screen_name, latest_tweet_id, latest_tweet_url, last_checked_at, created_at, updated_at)
                values (?, 'acct', '100', 'https://x.com/acct/status/100', ?, ?, ?)
                ''',
                (schedule_id, web_app.seconds_from_now(-3600), web_app.now(), web_app.now()),
            )
            schedule = dict(conn.execute('select * from scheduled_tasks where id = ?', (schedule_id,)).fetchone())

        original = web_app.latest_tweet_for_monitor
        web_app.latest_tweet_for_monitor = lambda screen_name, account, proxy_value='': {
            'screen_name': screen_name,
            'tweet_id': '101',
            'tweet_url': f'https://x.com/{screen_name}/status/101',
            'tweet_at': web_app.now(),
        }
        try:
            web_app.trigger_schedule(schedule)
        finally:
            web_app.latest_tweet_for_monitor = original

        with web_app.db() as conn:
            task = conn.execute('select * from tasks where schedule_id = ? order by id desc limit 1', (schedule_id,)).fetchone()
            pending = conn.execute('select * from schedule_monitor_states where schedule_id = ? and screen_name = ?', (schedule_id, 'acct')).fetchone()
        self.assertIsNotNone(task)
        self.assertEqual(pending['pending_tweet_id'], '101')

        web_app.record_schedule_task_result(dict(task), 'completed')
        with web_app.db() as conn:
            state = conn.execute('select * from schedule_monitor_states where schedule_id = ? and screen_name = ?', (schedule_id, 'acct')).fetchone()
        self.assertEqual(state['latest_tweet_id'], '101')
        self.assertIsNone(state['pending_tweet_id'])

    def test_schedule_config_does_not_require_concurrency(self):
        config = web_app.build_schedule_config({
            'task_type': 'benchmark_account',
            'targets': 'acct',
            'time_range': web_app.task_default_time_range(),
            'tweet_limit': 10,
            'has_video': True,
        })

        self.assertEqual(config['max_concurrent_requests'], 2)

    def test_run_now_does_not_change_next_run_at(self):
        account_id = self.add_account()
        next_run_at = web_app.seconds_from_now(7200)
        schedule_id = self.add_schedule(account_id, next_run_at)

        payload = web_app.api_run_schedule_now(schedule_id, user={'id': 1, 'role': 'admin'})

        self.assertIn('task_id', payload)
        with web_app.db() as conn:
            row = conn.execute('select next_run_at, last_task_id from scheduled_tasks where id = ?', (schedule_id,)).fetchone()
        self.assertEqual(row['next_run_at'], next_run_at)
        self.assertEqual(row['last_task_id'], payload['task_id'])

    def test_schedule_disables_after_repeated_trigger_failures(self):
        schedule_id = self.add_schedule(999)
        with web_app.db() as conn:
            schedule = dict(conn.execute('select * from scheduled_tasks where id = ?', (schedule_id,)).fetchone())

        for _ in range(web_app.SCHEDULE_FAILURE_DISABLE_THRESHOLD):
            web_app.trigger_schedule(schedule)

        with web_app.db() as conn:
            row = conn.execute('select enabled, consecutive_failures, last_error from scheduled_tasks where id = ?', (schedule_id,)).fetchone()
            log = conn.execute("select * from operation_logs where schedule_id = ? and event_type = 'schedule_failed' order by id desc limit 1", (schedule_id,)).fetchone()
        self.assertEqual(row['enabled'], 0)
        self.assertEqual(row['consecutive_failures'], web_app.SCHEDULE_FAILURE_DISABLE_THRESHOLD)
        self.assertTrue(row['last_error'])
        self.assertIsNotNone(log)

    def test_operation_log_filters_and_retention(self):
        web_app.append_operation_log('info', 'task_created', 'hello world')
        web_app.append_operation_log('error', 'task_failed', 'needle failure', error_type='network_failed')
        old = web_app.seconds_from_now(-(web_app.OPERATION_LOG_RETENTION_DAYS + 1) * 86400)
        with web_app.db() as conn:
            conn.execute(
                '''
                insert into operation_logs (created_at, level, event_type, message, error_type, details_json)
                values (?, 'info', 'old_event', 'old', null, '{}')
                ''',
                (old,),
            )

        filtered = web_app.api_operation_logs(user={'id': 1, 'role': 'admin'}, level='error', error_type='network_failed', q='needle')
        deleted = web_app.cleanup_operation_logs()

        self.assertEqual(filtered['total'], 1)
        self.assertEqual(filtered['logs'][0]['event_type'], 'task_failed')
        self.assertEqual(deleted, 1)

    def test_delete_single_operation_log(self):
        web_app.append_operation_log('info', 'task_created', 'hello world')
        with web_app.db() as conn:
            row = conn.execute("select id from operation_logs where event_type = 'task_created'").fetchone()

        payload = web_app.api_delete_operation_log(row['id'], user={'id': 1, 'role': 'admin'})

        self.assertTrue(payload['ok'])
        with web_app.db() as conn:
            count = conn.execute('select count(*) as count from operation_logs').fetchone()
        self.assertEqual(count['count'], 0)

    def test_delete_missing_operation_log_returns_404(self):
        with self.assertRaises(web_app.HTTPException) as ctx:
            web_app.api_delete_operation_log(9999, user={'id': 1, 'role': 'admin'})

        self.assertEqual(ctx.exception.status_code, 404)

    def test_delete_operation_logs_respects_filters(self):
        web_app.append_operation_log('info', 'task_created', 'keep this')
        web_app.append_operation_log('warning', 'task_failed', 'delete needle', error_type='network_failed')
        web_app.append_operation_log('error', 'task_failed', 'other failure', error_type='auth_expired')

        payload = web_app.api_delete_operation_logs(
            user={'id': 1, 'role': 'admin'},
            level='warning',
            q='needle',
        )

        self.assertEqual(payload['deleted'], 1)
        with web_app.db() as conn:
            rows = conn.execute('select level, message from operation_logs order by id').fetchall()
        self.assertEqual(len(rows), 2)
        self.assertEqual([row['message'] for row in rows], ['keep this', 'other failure'])

    def test_non_admin_cannot_delete_operation_logs(self):
        with web_app.db() as conn:
            user_id = conn.execute(
                'insert into users (username, password_hash, role, created_at) values (?, ?, ?, ?)',
                ('regular', 'hash', 'user', web_app.now()),
            ).lastrowid

        request = type('Request', (), {'session': {'user_id': user_id}})()
        with self.assertRaises(web_app.HTTPException) as ctx:
            web_app.require_api_admin(request)

        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
