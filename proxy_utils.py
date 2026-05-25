import re
from urllib.parse import quote, unquote, urlsplit, urlunsplit


SUPPORTED_PROXY_SCHEMES = {'http', 'https', 'socks4', 'socks5'}


def normalize_proxy_url(value):
    text = str(value or '').strip()
    if not text:
        return ''

    if '://' in text:
        return normalize_proxy_url_with_scheme(text)

    parts = text.split(':')
    if len(parts) == 2:
        host, port = parts
        host = host.strip()
        port = port.strip()
        if not host or not port.isdigit():
            raise ValueError('代理格式应为 host:port 或 host:port:username:password')
        return f'http://{host}:{port}'

    if len(parts) == 4:
        host, port, username, password = [part.strip() for part in parts]
        if not host or not port.isdigit() or not username or not password:
            raise ValueError('代理格式应为 host:port:username:password')
        return f'http://{quote(username, safe="")}:{quote(password, safe="")}@{host}:{port}'

    raise ValueError('代理格式应为 http://host:port、socks5://user:pass@host:port 或 host:port:username:password')


def proxy_for_httpx(value):
    return normalize_proxy_url(value) or None


def normalize_proxy_url_with_scheme(text):
    parsed = urlsplit(text)
    scheme = parsed.scheme.lower()
    if scheme not in SUPPORTED_PROXY_SCHEMES:
        raise ValueError('代理协议只支持 http、https、socks4、socks5')
    try:
        port = parsed.port
    except ValueError:
        raise ValueError('代理端口必须是数字')
    if not parsed.hostname or not port:
        raise ValueError('代理地址必须包含 host 和 port')

    host = parsed.hostname
    if ':' in host and not host.startswith('['):
        host = f'[{host}]'
    netloc = f'{host}:{port}'
    if parsed.username:
        auth = quote(unquote(parsed.username), safe='')
        if parsed.password is not None:
            auth += f':{quote(unquote(parsed.password), safe="")}'
        netloc = f'{auth}@{netloc}'
    return urlunsplit((scheme, netloc, parsed.path or '', parsed.query or '', parsed.fragment or ''))


def redact_proxy_url(value):
    if not value:
        return ''
    text = str(value)
    text = re.sub(
        r'((?:https?|socks5?|socks4)://)([^:@/\s]+):([^@/\s]+)@',
        r'\1[账号]:[密码]@',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r'(?<![\w.-])([A-Za-z0-9.-]+\.[A-Za-z]{2,}|localhost|127\.0\.0\.1):(\d+):([^:\s]+):([^:\s]+)',
        r'\1:\2:[账号]:[密码]',
        text,
        flags=re.IGNORECASE,
    )
    return text
