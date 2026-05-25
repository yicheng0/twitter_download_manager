import os
import tempfile
import unittest

os.environ['TW_WEB_DATA_DIR'] = tempfile.mkdtemp(prefix='twitter-benchmark-account-')
os.environ['TW_WEB_PUBLIC'] = '0'

from benchmark_down import parse_screen_name  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from web_app import db, delete_task_row, now, validate_task_config  # noqa: E402


class BenchmarkAccountTest(unittest.TestCase):
    def test_parse_screen_name_from_supported_inputs(self):
        self.assertEqual(parse_screen_name('https://x.com/elonmusk'), 'elonmusk')
        self.assertEqual(parse_screen_name('https://twitter.com/elonmusk/'), 'elonmusk')
        self.assertEqual(parse_screen_name('https://x.com/arsenal?lang=en'), 'arsenal')
        self.assertEqual(parse_screen_name('x.com/elonmusk'), 'elonmusk')
        self.assertEqual(parse_screen_name('@elonmusk'), 'elonmusk')
        self.assertEqual(parse_screen_name('elonmusk'), 'elonmusk')

    def test_parse_screen_name_rejects_invalid_inputs(self):
        self.assertEqual(parse_screen_name('https://x.com/'), '')
        self.assertEqual(parse_screen_name('https://x.com/elonmusk/status/123'), '')
        self.assertEqual(parse_screen_name('bad-name!'), '')
        self.assertEqual(parse_screen_name('name-that-is-too-long'), '')

    def test_benchmark_account_config_validation_accepts_positive_limit(self):
        config = {
            'task_type': 'benchmark_account',
            'targets': 'https://x.com/elonmusk',
            'tweet_limit': 5,
            'time_range': '2026-05-01:2026-05-25',
        }
        validate_task_config(config)

    def test_benchmark_account_config_validation_rejects_missing_target(self):
        config = {
            'task_type': 'benchmark_account',
            'targets': '',
            'tweet_limit': 5,
            'time_range': '2026-05-01:2026-05-25',
        }
        with self.assertRaises(HTTPException) as exc:
            validate_task_config(config)
        self.assertEqual(exc.exception.status_code, 400)

    def test_benchmark_account_config_validation_rejects_invalid_target(self):
        config = {
            'task_type': 'benchmark_account',
            'targets': 'https://x.com/elonmusk/status/123',
            'tweet_limit': 5,
            'time_range': '2026-05-01:2026-05-25',
        }
        with self.assertRaises(HTTPException) as exc:
            validate_task_config(config)
        self.assertEqual(exc.exception.status_code, 400)

    def test_benchmark_account_config_validation_normalizes_target(self):
        config = {
            'task_type': 'benchmark_account',
            'targets': 'https://x.com/arsenal',
            'tweet_limit': 10,
            'time_range': '2026-05-01:2026-05-25',
        }
        validate_task_config(config)
        self.assertEqual(config['targets'], 'arsenal')

    def test_delete_task_removes_row_and_output_dir(self):
        output_dir = tempfile.mkdtemp(prefix='twitter-task-output-')
        with open(os.path.join(output_dir, 'result.txt'), 'w', encoding='utf-8') as f:
            f.write('ok')
        with db() as conn:
            cursor = conn.execute(
                '''
                insert into tasks (user_id, account_id, task_type, title, config_json, status, output_dir, log_path, created_at)
                values (?, ?, ?, ?, ?, 'completed', ?, ?, ?)
                ''',
                (1, None, 'benchmark_account', 'Test task', '{}', output_dir, os.path.join(output_dir, 'task.log'), now()),
            )
            task_id = cursor.lastrowid
        delete_task_row(task_id, {'id': 1, 'role': 'admin'})
        self.assertFalse(os.path.exists(output_dir))
        with db() as conn:
            row = conn.execute('select id from tasks where id = ?', (task_id,)).fetchone()
        self.assertIsNone(row)

    def test_benchmark_account_config_validation_rejects_non_positive_limit(self):
        config = {
            'task_type': 'benchmark_account',
            'targets': 'https://x.com/elonmusk',
            'tweet_limit': 0,
            'time_range': '2026-05-01:2026-05-25',
        }
        with self.assertRaises(HTTPException) as exc:
            validate_task_config(config)
        self.assertEqual(exc.exception.status_code, 400)


if __name__ == '__main__':
    unittest.main()
