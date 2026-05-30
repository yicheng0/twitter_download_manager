import json
import os
import tempfile
import unittest

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
        self.assertEqual(int(row['value']), 4)
        self.assertIn('timezone', columns)
        self.assertIn('consecutive_failures', columns)

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


if __name__ == '__main__':
    unittest.main()
