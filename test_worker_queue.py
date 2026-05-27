import csv
import os
import tempfile
import unittest
from pathlib import Path

os.environ['TW_WEB_DATA_DIR'] = tempfile.mkdtemp(prefix='twitter-worker-queue-')
os.environ['TW_WEB_PUBLIC'] = '0'
os.environ['TW_WORKER_CONCURRENCY'] = '2'

import web_app  # noqa: E402


class WorkerQueueTest(unittest.TestCase):
    def setUp(self):
        web_app.init_db()
        web_app.stop_worker = False
        with web_app.db() as conn:
            conn.execute('delete from media_assets')
            conn.execute('delete from task_items')
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

    def add_task(self, account_id, title='task'):
        task_dir = Path(os.environ['TW_WEB_DATA_DIR']) / title
        task_dir.mkdir(parents=True, exist_ok=True)
        with web_app.db() as conn:
            return conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at)
                values (1, ?, 'benchmark_account', ?, '{}', 'queued', ?, ?, ?)
                ''',
                (account_id, title, str(task_dir), str(task_dir / 'task.log'), web_app.now()),
            ).lastrowid

    def test_acquire_queued_task_sets_exclusive_lease(self):
        account_id = self.add_account()
        task_id = self.add_task(account_id)

        first = web_app.acquire_queued_task('worker-a')
        second = web_app.acquire_queued_task('worker-b')

        self.assertEqual(first['id'], task_id)
        self.assertEqual(first['locked_by'], 'worker-a')
        self.assertIsNone(second)
        with web_app.db() as conn:
            row = conn.execute('select status, locked_by, heartbeat_at from tasks where id = ?', (task_id,)).fetchone()
        self.assertEqual(row['status'], 'running')
        self.assertEqual(row['locked_by'], 'worker-a')
        self.assertIsNotNone(row['heartbeat_at'])

    def test_reset_stale_task_lease_returns_task_to_queue(self):
        account_id = self.add_account()
        task_id = self.add_task(account_id)
        stale = web_app.seconds_from_now(-(web_app.TASK_LEASE_TIMEOUT_SECONDS + 10))
        with web_app.db() as conn:
            conn.execute(
                "update tasks set status = 'running', locked_by = 'worker-a', heartbeat_at = ?, process_id = 123 where id = ?",
                (stale, task_id),
            )

        web_app.reset_stale_task_leases()

        with web_app.db() as conn:
            row = conn.execute('select status, locked_by, process_id, last_error_type from tasks where id = ?', (task_id,)).fetchone()
        self.assertEqual(row['status'], 'queued')
        self.assertIsNone(row['locked_by'])
        self.assertIsNone(row['process_id'])
        self.assertEqual(row['last_error_type'], 'worker_timeout')

    def test_index_task_outputs_creates_item_and_media_rows(self):
        account_id = self.add_account()
        task_id = self.add_task(account_id, 'indexed-task')
        with web_app.db() as conn:
            task = conn.execute('select * from tasks where id = ?', (task_id,)).fetchone()
        output_dir = Path(task['output_dir'])
        media_path = output_dir / 'image.jpg'
        media_path.write_bytes(b'img')
        csv_path = output_dir / 'result.csv'
        with csv_path.open('w', encoding='utf-8-sig', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Tweet Date', 'Display Name', 'User Name', 'Tweet URL', 'Media Type', 'Media URL', 'Saved Path', 'Tweet Content', 'Favorite Count', 'Retweet Count', 'Reply Count'])
            writer.writerow(['2026-05-27 10:00', 'Name', '@acct', 'https://x.com/acct/status/1', 'Image', 'https://pbs.twimg.com/a.jpg', str(media_path), 'hello', '3', '2', '1'])

        counts = web_app.index_task_outputs(task)

        self.assertEqual(counts, {'items': 1, 'media_assets': 1})
        with web_app.db() as conn:
            item = conn.execute('select * from task_items where task_id = ?', (task_id,)).fetchone()
            media = conn.execute('select * from media_assets where task_id = ?', (task_id,)).fetchone()
        self.assertEqual(item['tweet_url'], 'https://x.com/acct/status/1')
        self.assertEqual(item['media_count'], 1)
        self.assertEqual(media['status'], 'downloaded')
        self.assertEqual(media['byte_size'], 3)

    def test_update_task_progress_from_log_is_monotonic(self):
        account_id = self.add_account()
        task_id = self.add_task(account_id, 'progress-task')
        with web_app.db() as conn:
            task = conn.execute('select * from tasks where id = ?', (task_id,)).fetchone()
            conn.execute('update tasks set api_calls = 5, download_count = 4, progress_done = 4 where id = ?', (task_id,))
        log_path = Path(task['log_path'])
        log_path.write_text('任务完成, 耗时 1.00 秒, API 调用 2 次, 下载 1 份文件\n', encoding='utf-8')

        web_app.update_task_progress_from_log(task_id, log_path)

        with web_app.db() as conn:
            row = conn.execute('select api_calls, download_count, progress_done from tasks where id = ?', (task_id,)).fetchone()
        self.assertEqual(row['api_calls'], 5)
        self.assertEqual(row['download_count'], 4)
        self.assertEqual(row['progress_done'], 4)


if __name__ == '__main__':
    unittest.main()
