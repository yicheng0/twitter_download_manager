"""
代理健康检查模块
定期检查代理可用性并更新健康评分
"""
import sqlite3
import time
from datetime import datetime

import httpx


def check_proxy(proxy_url, timeout=10):
    """
    检查单个代理的可用性

    Args:
        proxy_url: 代理 URL
        timeout: 超时时间（秒）

    Returns:
        tuple: (是否成功, 检测到的 IP, 错误信息)
    """
    try:
        from proxy_utils import normalize_proxy_url
        normalized_url = normalize_proxy_url(proxy_url)
        response = httpx.get('https://api.ipify.org?format=json', proxy=normalized_url, timeout=timeout)
        if response.status_code == 200:
            data = response.json()
            return True, data.get('ip', ''), ''
        return False, '', f'HTTP {response.status_code}'
    except Exception as e:
        return False, '', str(e)


def update_proxy_health(conn, proxy_id, success):
    """
    更新代理健康评分

    Args:
        conn: 数据库连接
        proxy_id: 代理 ID
        success: 本次检查是否成功
    """
    proxy = conn.execute('SELECT success_count, failure_count, health_score FROM proxies WHERE id = ?', (proxy_id,)).fetchone()
    if not proxy:
        return

    success_count = proxy['success_count'] or 0
    fail_count = proxy['failure_count'] or 0

    if success:
        success_count += 1
        # 成功后重置连续失败计数
        fail_count = max(0, fail_count - 1)
    else:
        fail_count += 1

    # 计算健康评分（0.0 - 1.0）
    total = success_count + fail_count
    if total > 0:
        health_score = success_count / total
    else:
        health_score = 1.0

    # 连续失败 5 次以上，健康评分大幅降低
    if fail_count >= 5:
        health_score = max(0.0, health_score - 0.3)

    conn.execute(
        'UPDATE proxies SET success_count = ?, failure_count = ?, health_score = ?, last_check_at = ? WHERE id = ?',
        (success_count, fail_count, health_score, datetime.now().isoformat(), proxy_id)
    )
    conn.commit()


def check_all_proxies(db_path=None):
    """
    检查所有启用的代理

    Args:
        db_path: 数据库路径（可选）
    """
    if not db_path:
        import os
        from pathlib import Path
        base_dir = Path(__file__).resolve().parent
        data_dir = Path(os.environ.get('TW_WEB_DATA_DIR', base_dir / 'web_data'))
        db_path = data_dir / 'web.sqlite3'

    try:
        conn = sqlite3.connect(db_path, timeout=10)
        conn.row_factory = sqlite3.Row

        # 获取所有启用的代理
        proxies = conn.execute("SELECT id, proxy FROM proxies WHERE enabled = 1").fetchall()

        for proxy in proxies:
            proxy_id = proxy['id']
            proxy_url = proxy['proxy']

            print(f'[代理健康检查] 检查代理 #{proxy_id}: {proxy_url[:50]}...')

            success, detected_ip, error = check_proxy(proxy_url)

            if success:
                print(f'[代理健康检查] 代理 #{proxy_id} 可用，IP: {detected_ip}')
                # 更新检测到的 IP
                conn.execute('UPDATE proxies SET detected_ip = ? WHERE id = ?', (detected_ip, proxy_id))
            else:
                print(f'[代理健康检查] 代理 #{proxy_id} 不可用: {error}')
                # 更新错误信息
                conn.execute('UPDATE proxies SET last_error = ? WHERE id = ?', (error, proxy_id))

            # 更新健康评分
            update_proxy_health(conn, proxy_id, success)

            # 避免请求过快
            time.sleep(1)

        conn.close()
        print(f'[代理健康检查] 完成，共检查 {len(proxies)} 个代理')

    except Exception as e:
        print(f'[代理健康检查] 错误: {e}')


if __name__ == '__main__':
    # 测试代码
    print('=== 代理健康检查测试 ===')
    check_all_proxies()
