import os
import tempfile
import unittest

os.environ['TW_WEB_DATA_DIR'] = tempfile.mkdtemp(prefix='twitter-resource-governance-')
os.environ['TW_WEB_PUBLIC'] = '0'

import web_app  # noqa: E402


class ResourceGovernanceTest(unittest.TestCase):
    def setUp(self):
        web_app.init_db()

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


if __name__ == '__main__':
    unittest.main()
