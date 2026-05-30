"""
反检测工具模块
提供请求头生成、间隔抖动、配额管理等反检测功能
"""
import random
import time
from datetime import datetime, timedelta
from backend.crawler.runtime.user_agent_pool import get_ua_metadata


def generate_request_headers(account_row, cookie, referer='https://twitter.com/'):
    """
    生成完整的反检测请求头

    Args:
        account_row: 账号数据库记录（dict 或 sqlite3.Row）
        cookie: Cookie 字符串
        referer: Referer URL

    Returns:
        dict: 完整的请求头
    """
    from backend.crawler.runtime.crawler_runtime import AUTHORIZATION, ct0_from_cookie

    # 安全地从 dict 或 sqlite3.Row 中取值
    def _get(row, key):
        try:
            if hasattr(row, 'keys') and key in row.keys():
                return row[key]
            if isinstance(row, dict):
                return row.get(key)
        except Exception:
            pass
        return None

    # 获取账号绑定的 UA 元数据
    user_agent = _get(account_row, 'user_agent')
    accept_language = _get(account_row, 'accept_language')

    if not user_agent:
        # 如果账号没有 UA，使用默认值（兼容旧账号）
        user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        accept_language = 'en-US,en;q=0.9'

    # 获取 UA 元数据
    ua_meta = get_ua_metadata(user_agent)

    # 基础请求头
    headers = {
        'user-agent': user_agent,
        'authorization': AUTHORIZATION,
        'cookie': cookie,
        'x-csrf-token': ct0_from_cookie(cookie),
        'referer': referer,
        'accept': '*/*',
        'accept-language': accept_language or ua_meta['accept_language'],
        'accept-encoding': 'gzip, deflate, br',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': (accept_language or ua_meta['accept_language']).split(',')[0].split('-')[0],
    }

    # 添加 Chrome 特有的 sec-ch-ua 请求头（Firefox 不需要）
    if ua_meta['sec_ch_ua']:
        headers['sec-ch-ua'] = ua_meta['sec_ch_ua']
        headers['sec-ch-ua-mobile'] = '?0'
        headers['sec-ch-ua-platform'] = ua_meta['sec_ch_ua_platform']

    # 添加 Fetch 元数据请求头
    headers['sec-fetch-dest'] = 'empty'
    headers['sec-fetch-mode'] = 'cors'
    headers['sec-fetch-site'] = 'same-origin'

    return headers


def random_interval(base, variance):
    """
    生成随机间隔（基础值 ± 抖动范围）

    Args:
        base: 基础间隔（秒）
        variance: 抖动范围（秒）

    Returns:
        float: 随机间隔
    """
    return max(0.1, base + random.uniform(-variance, variance))


def should_take_break(request_count, break_after=25):
    """
    判断是否需要休息

    Args:
        request_count: 当前请求计数
        break_after: 多少次请求后休息

    Returns:
        bool: 是否需要休息
    """
    if request_count <= 0:
        return False
    # 在 break_after ± 5 的范围内随机触发
    threshold = random.randint(max(1, break_after - 5), break_after + 5)
    return request_count >= threshold


def calculate_break_duration(min_seconds=30, max_seconds=90):
    """
    计算休息时长

    Args:
        min_seconds: 最短休息时间（秒）
        max_seconds: 最长休息时间（秒）

    Returns:
        int: 休息时长（秒）
    """
    return random.randint(min_seconds, max_seconds)


def shuffle_targets(targets):
    """
    打乱采集目标顺序

    Args:
        targets: 目标列表

    Returns:
        list: 打乱后的目标列表
    """
    shuffled = list(targets)
    random.shuffle(shuffled)
    return shuffled


def check_account_quota(account_id, conn):
    """
    检查账号是否还有配额

    Args:
        account_id: 账号 ID
        conn: 数据库连接

    Returns:
        bool: True 表示有配额，False 表示配额已用完
    """
    account = conn.execute(
        'SELECT daily_quota, daily_used, quota_reset_at FROM accounts WHERE id = ?',
        (account_id,)
    ).fetchone()

    if not account:
        return False

    # 检查是否需要重置配额
    if account['quota_reset_at']:
        try:
            reset_time = datetime.fromisoformat(account['quota_reset_at'])
            if datetime.now() >= reset_time:
                # 重置配额
                conn.execute(
                    'UPDATE accounts SET daily_used = 0, quota_reset_at = ? WHERE id = ?',
                    ((datetime.now() + timedelta(days=1)).isoformat(), account_id)
                )
                conn.commit()
                return True
        except Exception:
            pass
    else:
        # 首次使用，设置重置时间
        conn.execute(
            'UPDATE accounts SET quota_reset_at = ? WHERE id = ?',
            ((datetime.now() + timedelta(days=1)).isoformat(), account_id)
        )
        conn.commit()

    # 检查配额
    daily_quota = account['daily_quota'] or 200
    daily_used = account['daily_used'] or 0
    return daily_used < daily_quota


def increment_account_usage(account_id, conn):
    """
    增加账号使用计数

    Args:
        account_id: 账号 ID
        conn: 数据库连接
    """
    conn.execute(
        'UPDATE accounts SET daily_used = daily_used + 1 WHERE id = ?',
        (account_id,)
    )
    conn.commit()


def should_insert_exploration_request(request_count):
    """
    判断是否应该插入探索请求（模拟真实用户行为）

    Args:
        request_count: 当前请求计数

    Returns:
        bool: 是否插入探索请求
    """
    # 每 10-15 次请求有 1/15 的概率插入探索请求
    if request_count > 0 and request_count % random.randint(10, 15) == 0:
        return random.random() < 0.15
    return False


def get_exploration_urls():
    """
    获取探索请求的 URL 列表（模拟用户浏览行为）

    Returns:
        list: URL 列表
    """
    return [
        'https://twitter.com/i/api/2/guide.json',
        'https://twitter.com/i/api/graphql/V7H0Ap3_Hh2FyS75OCDO3Q/TrendingTopics',
        'https://twitter.com/i/api/1.1/search/typeahead.json?q=news',
    ]


def execute_exploration_request(client):
    """
    执行探索请求

    Args:
        client: CrawlerClient 实例
    """
    url = random.choice(get_exploration_urls())
    try:
        client.get(url)
        time.sleep(random.uniform(2, 5))
    except Exception:
        pass  # 探索请求失败不影响主流程


if __name__ == '__main__':
    # 测试代码
    print('=== 反检测工具测试 ===')

    # 测试随机间隔
    print('\n1. 随机间隔测试（基础 10 秒，抖动 3 秒）：')
    for i in range(5):
        interval = random_interval(10, 3)
        print(f'   第 {i+1} 次: {interval:.2f} 秒')

    # 测试休息机制
    print('\n2. 休息机制测试：')
    for count in [0, 10, 20, 25, 30]:
        should_break = should_take_break(count)
        if should_break:
            duration = calculate_break_duration()
            print(f'   请求 {count} 次后: 需要休息 {duration} 秒')
        else:
            print(f'   请求 {count} 次后: 继续工作')

    # 测试目标打乱
    print('\n3. 目标打乱测试：')
    targets = ['user1', 'user2', 'user3', 'user4', 'user5']
    print(f'   原始顺序: {targets}')
    shuffled = shuffle_targets(targets)
    print(f'   打乱后: {shuffled}')
