"""
User-Agent 池管理模块
提供真实浏览器 UA 及配套的请求头元数据
"""
import random


# 真实浏览器 User-Agent 池（2024-2025 最新版本）
USER_AGENTS = [
    # Chrome on Windows 10/11
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'platform': 'Windows',
        'sec_ch_ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec_ch_ua_platform': '"Windows"',
    },
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'platform': 'Windows',
        'sec_ch_ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec_ch_ua_platform': '"Windows"',
    },
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'platform': 'Windows',
        'sec_ch_ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'sec_ch_ua_platform': '"Windows"',
    },
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'platform': 'Windows',
        'sec_ch_ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        'sec_ch_ua_platform': '"Windows"',
    },
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'platform': 'Windows',
        'sec_ch_ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec_ch_ua_platform': '"Windows"',
    },
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'platform': 'Windows',
        'sec_ch_ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec_ch_ua_platform': '"Windows"',
    },

    # Chrome on macOS
    {
        'user_agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'platform': 'macOS',
        'sec_ch_ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec_ch_ua_platform': '"macOS"',
    },
    {
        'user_agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'platform': 'macOS',
        'sec_ch_ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        'sec_ch_ua_platform': '"macOS"',
    },
    {
        'user_agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'platform': 'macOS',
        'sec_ch_ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec_ch_ua_platform': '"macOS"',
    },

    # Edge on Windows
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        'platform': 'Windows',
        'sec_ch_ua': '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
        'sec_ch_ua_platform': '"Windows"',
    },
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
        'platform': 'Windows',
        'sec_ch_ua': '"Not A(Brand";v="99", "Microsoft Edge";v="121", "Chromium";v="121"',
        'sec_ch_ua_platform': '"Windows"',
    },
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        'platform': 'Windows',
        'sec_ch_ua': '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec_ch_ua_platform': '"Windows"',
    },

    # Firefox on Windows
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
        'platform': 'Windows',
        'sec_ch_ua': None,
        'sec_ch_ua_platform': None,
    },
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'platform': 'Windows',
        'sec_ch_ua': None,
        'sec_ch_ua_platform': None,
    },
    {
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
        'platform': 'Windows',
        'sec_ch_ua': None,
        'sec_ch_ua_platform': None,
    },

    # Firefox on macOS
    {
        'user_agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
        'platform': 'macOS',
        'sec_ch_ua': None,
        'sec_ch_ua_platform': None,
    },
    {
        'user_agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
        'platform': 'macOS',
        'sec_ch_ua': None,
        'sec_ch_ua_platform': None,
    },

    # Chrome on Linux
    {
        'user_agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'platform': 'Linux',
        'sec_ch_ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec_ch_ua_platform': '"Linux"',
    },
    {
        'user_agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'platform': 'Linux',
        'sec_ch_ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec_ch_ua_platform': '"Linux"',
    },
]


# Accept-Language 池
ACCEPT_LANGUAGES = [
    'en-US,en;q=0.9',
    'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'zh-CN,zh;q=0.9,en;q=0.8',
    'en-GB,en;q=0.9',
    'ja-JP,ja;q=0.9,en;q=0.8',
    'ko-KR,ko;q=0.9,en;q=0.8',
    'es-ES,es;q=0.9,en;q=0.8',
    'fr-FR,fr;q=0.9,en;q=0.8',
]


def get_random_ua():
    """
    随机获取一个 User-Agent 及其配套元数据

    Returns:
        dict: 包含 user_agent, platform, sec_ch_ua, sec_ch_ua_platform, accept_language
    """
    ua_data = random.choice(USER_AGENTS).copy()
    ua_data['accept_language'] = random.choice(ACCEPT_LANGUAGES)
    return ua_data


def get_ua_metadata(user_agent):
    """
    根据 User-Agent 字符串获取配套元数据

    Args:
        user_agent: User-Agent 字符串

    Returns:
        dict: 包含 platform, sec_ch_ua, sec_ch_ua_platform, accept_language
              如果找不到匹配的 UA，返回默认值
    """
    for ua_data in USER_AGENTS:
        if ua_data['user_agent'] == user_agent:
            result = ua_data.copy()
            result['accept_language'] = random.choice(ACCEPT_LANGUAGES)
            return result

    # 找不到匹配的，返回默认值
    return {
        'user_agent': user_agent,
        'platform': 'Windows',
        'sec_ch_ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec_ch_ua_platform': '"Windows"',
        'accept_language': 'en-US,en;q=0.9',
    }


if __name__ == '__main__':
    # 测试代码
    print('=== User-Agent 池测试 ===')
    print(f'总共 {len(USER_AGENTS)} 个 UA')
    print(f'总共 {len(ACCEPT_LANGUAGES)} 个 Accept-Language')
    print('\n随机获取 3 个 UA：')
    for i in range(3):
        ua = get_random_ua()
        print(f'\n{i+1}. {ua["platform"]}')
        print(f'   UA: {ua["user_agent"][:80]}...')
        print(f'   sec-ch-ua: {ua["sec_ch_ua"]}')
        print(f'   accept-language: {ua["accept_language"]}')

