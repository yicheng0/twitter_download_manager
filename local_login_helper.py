import json
import os
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = '127.0.0.1'
PORT = int(os.environ.get('TW_LOCAL_LOGIN_PORT', '18765') or 18765)
DEFAULT_ALLOWED_HOSTS = {
    'twitter.198-12-70-103.nip.io',
    '127.0.0.1',
    'localhost',
}
ALLOWED_HOSTS = DEFAULT_ALLOWED_HOSTS | {
    host.strip().lower()
    for host in os.environ.get('TW_LOCAL_LOGIN_ALLOWED_HOSTS', '').split(',')
    if host.strip()
}
active_login = None
active_lock = threading.Lock()


def find_chrome():
    explicit = os.environ.get('TW_LOCAL_CHROME_PATH', '').strip()
    candidates = [explicit] if explicit else []
    local_app_data = os.environ.get('LOCALAPPDATA', '')
    program_files = os.environ.get('PROGRAMFILES', '')
    program_files_x86 = os.environ.get('PROGRAMFILES(X86)', '')
    candidates.extend(
        [
            os.path.join(program_files, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            os.path.join(program_files_x86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            os.path.join(local_app_data, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            os.path.join(program_files, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            os.path.join(program_files_x86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
    )
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def allowed_url(url):
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or '').lower()
    if host not in ALLOWED_HOSTS:
        return False
    if host in {'127.0.0.1', 'localhost'}:
        return parsed.scheme in {'http', 'https'}
    return parsed.scheme == 'https'


def allowed_origin(origin):
    if not origin:
        return True
    parsed = urllib.parse.urlparse(origin)
    return (parsed.hostname or '').lower() in ALLOWED_HOSTS


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    origin = handler.headers.get('Origin', '')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Access-Control-Allow-Origin', origin if allowed_origin(origin) else 'null')
    handler.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type')
    handler.send_header('Access-Control-Allow-Private-Network', 'true')
    handler.send_header('Access-Control-Max-Age', '600')
    handler.send_header('Cache-Control', 'no-store')
    handler.end_headers()
    handler.wfile.write(body)


def post_callback(callback_url, payload):
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(
        callback_url,
        data=data,
        headers={'Content-Type': 'application/json', 'User-Agent': 'twitter-download-local-login-helper/1.0'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode('utf-8'))


def cookie_value(cookies, name):
    for cookie in cookies:
        if cookie.get('name') == name and ('x.com' in cookie.get('domain', '') or 'twitter.com' in cookie.get('domain', '')):
            return cookie.get('value') or ''
    return ''


def run_login(token, callback_url, expires_in):
    global active_login
    chrome_path = find_chrome()
    if not chrome_path:
        post_callback(callback_url, {'token': token, 'error': '本机未找到 Chrome 或 Edge，请先安装浏览器，或设置 TW_LOCAL_CHROME_PATH。'})
        with active_lock:
            active_login = None
        return

    browser = None
    try:
        from playwright.sync_api import sync_playwright

        deadline = time.time() + max(30, min(int(expires_in or 300), 900))
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=chrome_path,
                headless=False,
                args=['--new-window', '--disable-blink-features=AutomationControlled'],
            )
            context = browser.new_context(viewport={'width': 1280, 'height': 860})
            page = context.new_page()
            page.goto('https://x.com/i/flow/login', wait_until='domcontentloaded')
            while time.time() < deadline:
                cookies = context.cookies(['https://x.com', 'https://twitter.com'])
                auth_token = cookie_value(cookies, 'auth_token')
                ct0 = cookie_value(cookies, 'ct0')
                if auth_token and ct0:
                    response = post_callback(
                        callback_url,
                        {
                            'token': token,
                            'auth_token': auth_token,
                            'ct0': ct0,
                            'cookie': f'auth_token={auth_token}; ct0={ct0};',
                        },
                    )
                    if response.get('status') == 'completed':
                        browser.close()
                        browser = None
                        with active_lock:
                            active_login = None
                        return
                    if response.get('status') == 'failed':
                        browser.close()
                        browser = None
                        with active_lock:
                            active_login = None
                        return
                if page.is_closed():
                    raise RuntimeError('Chrome 登录窗口已关闭。')
                time.sleep(2)
            post_callback(callback_url, {'token': token, 'error': '本地 Chrome 登录超时，请重新开始。'})
    except Exception as exc:
        try:
            post_callback(callback_url, {'token': token, 'error': str(exc)})
        except Exception:
            pass
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        with active_lock:
            active_login = None


class Handler(BaseHTTPRequestHandler):
    server_version = 'TwitterDownloadLocalLoginHelper/1.0'

    def log_message(self, fmt, *args):
        print('[local-login]', fmt % args)

    def do_OPTIONS(self):
        json_response(self, 200, {})

    def do_GET(self):
        if self.path.rstrip('/') in {'', '/health'}:
            json_response(self, 200, {'ok': True, 'status': 'ready'})
            return
        json_response(self, 404, {'ok': False, 'message': 'not found'})

    def do_POST(self):
        if self.path.rstrip('/') != '/start':
            json_response(self, 404, {'ok': False, 'message': 'not found'})
            return
        origin = self.headers.get('Origin', '')
        if not allowed_origin(origin):
            json_response(self, 403, {'ok': False, 'message': '不允许的工作台来源。'})
            return
        try:
            length = int(self.headers.get('Content-Length') or '0')
            payload = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
        except Exception:
            json_response(self, 400, {'ok': False, 'message': '请求格式不是有效 JSON。'})
            return

        token = str(payload.get('token') or '').strip()
        callback_url = str(payload.get('callback_url') or '').strip()
        expires_in = int(payload.get('expires_in') or 300)
        if not token or not callback_url:
            json_response(self, 400, {'ok': False, 'message': '缺少 token 或 callback_url。'})
            return
        if not allowed_url(callback_url):
            json_response(self, 403, {'ok': False, 'message': 'callback_url 不在允许的工作台域名内。'})
            return

        global active_login
        with active_lock:
            if active_login and active_login.is_alive():
                json_response(self, 409, {'ok': False, 'message': '已有本地 Chrome 登录正在进行。'})
                return
            active_login = threading.Thread(target=run_login, args=(token, callback_url, expires_in), daemon=True)
            active_login.start()
        json_response(self, 200, {'ok': True, 'status': 'running', 'message': '已打开本机 Chrome 授权窗口。'})


def main():
    print(f'本地 Chrome 授权登录助手已启动: http://{HOST}:{PORT}')
    print('请保持此窗口打开，然后回到工作台点击“浏览器登录”。')
    print('允许的工作台域名:', ', '.join(sorted(ALLOWED_HOSTS)))
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == '__main__':
    main()
