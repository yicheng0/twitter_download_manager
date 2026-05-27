import os
import tempfile
import unittest
from datetime import datetime

os.environ['TW_WEB_DATA_DIR'] = tempfile.mkdtemp(prefix='twitter-result-db-')
os.environ['TW_WEB_PUBLIC'] = '0'
os.environ['TW_WEB_CREDENTIAL_KEY'] = 'test-result-db-secret'

import web_app  # noqa: E402


class ResultDbHeatmapTest(unittest.TestCase):
    def setUp(self):
        web_app.init_db()
        with web_app.db() as conn:
            conn.execute('delete from task_items')
            conn.execute('delete from media_assets')
            conn.execute('delete from tasks')
            conn.execute('delete from result_db_configs')

    def test_secret_payload_hides_encrypted_password(self):
        encrypted = web_app.encrypt_secret('db-password')
        with web_app.db() as conn:
            row_id = conn.execute(
                '''
                insert into result_db_configs
                  (label, db_type, host, port, database_name, username, encrypted_password, ssl_enabled, enabled, status, created_at, updated_at)
                values ('result', 'postgresql', 'localhost', 5432, 'analytics', 'user', ?, 0, 1, 'untested', ?, ?)
                ''',
                (encrypted, web_app.now(), web_app.now()),
            ).lastrowid
            row = conn.execute('select * from result_db_configs where id = ?', (row_id,)).fetchone()

        payload = web_app.result_db_payload(row)

        self.assertTrue(payload['has_password'])
        self.assertNotIn('password', payload)
        self.assertNotIn('encrypted_password', payload)
        self.assertEqual(web_app.decrypt_secret(encrypted), 'db-password')

    def test_local_heatmap_has_seven_days_and_hour_cells(self):
        with web_app.db() as conn:
            conn.execute(
                '''
                insert into tasks (id, user_id, task_type, title, config_json, status, output_dir, log_path, created_at)
                values (1, 1, 'benchmark_account', 'heatmap task', '{}', 'completed', ?, ?, ?)
                ''',
                (web_app.DATA_DIR.as_posix(), web_app.DATA_DIR.joinpath('heatmap.log').as_posix(), web_app.now()),
            )
            conn.execute(
                '''
                insert into task_items
                  (task_id, source_file, tweet_url, tweet_date, display_name, screen_name, content,
                   favorite_count, retweet_count, reply_count, media_count, created_at)
                values (1, 'result.csv', 'https://x.com/a/status/1', ?, 'A', 'a', 'hello', 0, 0, 0, 2, ?)
                ''',
                (web_app.now(), web_app.now()),
            )

        heatmap = web_app.local_result_heatmap(days=7, user=web_app.INTERNAL_USER)

        self.assertEqual(heatmap['source'], 'local')
        self.assertEqual(len(heatmap['dates']), 7)
        self.assertEqual(len(heatmap['hours']), 24)
        self.assertEqual(len(heatmap['cells']), 7 * 24)
        self.assertEqual(heatmap['total'], 1)
        self.assertEqual(heatmap['max_count'], 1)

    def test_dashboard_heatmap_days_are_normalized(self):
        self.assertEqual(web_app.dashboard_heatmap(days=30, user=web_app.INTERNAL_USER)['days'], 30)
        self.assertEqual(web_app.dashboard_heatmap(days=99, user=web_app.INTERNAL_USER)['days'], 7)

    def test_heatmap_items_return_latest_rows_for_selected_hour(self):
        current = datetime.now().replace(minute=12, second=0, microsecond=0)
        stamp = current.strftime('%Y-%m-%d %H:%M:%S')
        with web_app.db() as conn:
            conn.execute(
                '''
                insert into tasks (id, user_id, task_type, title, config_json, status, output_dir, log_path, created_at)
                values (1, 1, 'benchmark_account', 'heatmap task', '{}', 'completed', ?, ?, ?)
                ''',
                (web_app.DATA_DIR.as_posix(), web_app.DATA_DIR.joinpath('heatmap.log').as_posix(), web_app.now()),
            )
            conn.execute(
                '''
                insert into task_items
                  (task_id, source_file, tweet_url, tweet_date, display_name, screen_name, content,
                   favorite_count, retweet_count, reply_count, media_count, created_at)
                values (1, 'result.csv', 'https://x.com/a/status/1', ?, 'A', 'a', 'hello', 0, 0, 0, 2, ?)
                ''',
                (stamp, stamp),
            )
            conn.execute(
                '''
                insert into task_items
                  (task_id, source_file, tweet_url, tweet_date, display_name, screen_name, content,
                   favorite_count, retweet_count, reply_count, media_count, created_at)
                values (1, 'result.csv', 'https://x.com/a/status/2', ?, 'B', 'b', 'world', 3, 2, 1, 0, ?)
                ''',
                (stamp, stamp),
            )

        result = web_app.dashboard_heatmap_items(
            web_app.INTERNAL_USER,
            current.strftime('%Y-%m-%d'),
            current.hour,
            limit=1,
        )

        self.assertEqual(result['source'], 'local')
        self.assertEqual(result['total'], 2)
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['task_title'], 'heatmap task')
        self.assertEqual(result['items'][0]['screen_name'], 'b')


if __name__ == '__main__':
    unittest.main()
