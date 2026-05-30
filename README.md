# X/Twitter Download Manager

面向 X/Twitter 内容备份与任务管理的本地工具集。项目提供传统脚本、轻量本地面板和完整 Web 管理端，支持按用户、关键词、高级搜索条件和评论区任务采集媒体与文本内容，并提供账号、代理、任务日志和结果汇总能力。

> 本项目仅用于学习研究、个人资料备份和授权场景下的数据整理。使用者需要自行遵守所在地区法律法规、X/Twitter 平台规则、内容版权和隐私要求。

## English Summary

X/Twitter Download Manager is a local toolkit for media download, task management, and authorized content archiving. It includes Python scripts, a lightweight local panel, a full Web console, Docker deployment files, account/session management, proxy configuration, task logs, and result reports.

Use it only for lawful research, personal backup, or authorized internal workflows. The project does not provide any guarantee for bypassing platform limits, access controls, copyright restrictions, or account risk.

## Features

- Download images, videos and GIFs by X/Twitter username.
- Support multiple accounts, time ranges, retweets, Highlights and Likes options.
- Download by tag, keyword or X advanced search syntax.
- Export text-only tweets for specified users.
- Download replies for supported users or tweet links.
- Fetch profile information, including avatar, banner and bio.
- Generate Markdown records, CSV statistics and task summary reports.
- Manage tasks through a browser-based Web console with live logs.
- Manage account sessions and proxy settings from the Web console.
- Deploy locally, on a private server, or through Docker Compose with optional Caddy HTTPS reverse proxy.

## Requirements

- Python 3.8 or later. Python 3.12 is used by the Docker image.
- Node.js 22 or later, only required when rebuilding the React Web console locally.
- A valid X/Twitter login session Cookie containing at least `auth_token` and `ct0`.
- Optional: Playwright Chromium, required for browser-login related workflows.

Install Python dependencies:

```bash
pip install -r requirements.txt
```

Install Playwright browser runtime when needed:

```bash
python -m playwright install
```

## Quick Start

### Full Web Console

The full Web console is the recommended entry point for account management, proxy pools, task queues, runtime control, logs, reports and packaged downloads.

Build the frontend after the first checkout or after frontend changes:

```bash
cd frontend
npm install
npm run build
cd ..
```

Start the backend:

```bash
python web_app.py
```

Open:

```text
http://127.0.0.1:8000
```

The console provides task templates, recent task history, output statistics and generated `summary_report.md` files after task completion.

### Lightweight Local Panel

Use the lightweight panel for quick local downloads on a personal machine:

```bash
python panel_app.py
```

Open:

```text
http://127.0.0.1:7860
```

The panel supports username, Cookie, output directory, date range, image format, concurrency, proxy and common download options.

### Traditional Script Mode

For configuration-file based media downloads:

```bash
python main.py
```

The script reads `settings.json`. At minimum, configure `user_lst` and `cookie` before running.

## Web Console Accounts

The Web console supports three account input methods:

- Manually enter `auth_token` and `ct0`.
- Use "Local Authorization Login": the VPS creates a login task, the user's own computer opens Chrome, and the helper sends the cookie back to the VPS.
- Import Cookies from BitBrowser local API when the selected browser profile has already logged in to X/Twitter.

For VPS deployments, keep the Web backend running on the VPS and run the local helper on the operator's Windows computer. The VPS never needs to log in to Chrome. The browser login feature is enabled by default, and can be made explicit with:

```text
TW_WEB_ENABLE_BROWSER_LOGIN=1
```

The operator flow is:

1. Open the VPS Web console account page from the Windows computer that will authorize the account.
2. Click "Local Authorization Login".
3. If the helper has already been installed, click "Auto launch and open Chrome".
4. First-time users click "Install Local Authorization Helper" once and run the downloaded installer.
5. Complete X/Twitter password, email verification, or 2FA in the Chrome window that opens locally.

The installer stores the helper under the user's local AppData directory, starts it in the background, registers a Windows logon startup task, and registers the `tw-login-helper://` browser launch protocol. After the first install, the Web console can launch the local helper directly. When `auth_token` and `ct0` are detected, the helper posts them to the VPS callback URL and the account is saved automatically. The helper listens on `127.0.0.1:18765` and only returns the session fields required by this project.

Advanced users can also start the helper manually from a checked-out project directory:

```powershell
start_local_login_helper.bat
```

If the Web console uses a custom domain, allow it with:

```text
TW_LOCAL_LOGIN_ALLOWED_HOSTS=your.domain.com
```

If Chrome is not installed in the default location, set:

```text
TW_LOCAL_CHROME_PATH=C:/Path/To/chrome.exe
```

For BitBrowser import, enable the local API in BitBrowser first. The local API is usually similar to:

```text
http://127.0.0.1:54345
```

Then enter the local API address and the browser profile ID in the account page. Multiple profile IDs can be separated by new lines or English commas. To reduce operational risk, each import is limited to 10 profiles.

## Docker Deployment

The repository includes Docker and Docker Compose files for single-machine deployment.

Create the production environment file:

```bash
cp env.production.example .env.production
```

Edit at least these values before starting the service:

```text
APP_HOST_PORT=18081
TW_WEB_ADMIN_PASSWORD=change-this-strong-password
TW_WEB_SESSION_SECRET=replace-with-at-least-32-random-characters
```

Start the application:

```bash
docker compose --env-file .env.production up -d --build app
```

Deployment notes:

- The container listens on `8000`.
- The default host port is `18081`, configurable through `APP_HOST_PORT`.
- Persistent data is stored in `./data`, including SQLite data, task files and downloaded results.
- In public mode, the default admin password is rejected. Always set a strong `TW_WEB_ADMIN_PASSWORD`.
- `TW_WEB_SESSION_SECRET` must be a random string of at least 32 characters in public mode.
- To disable browser-login features completely, set `TW_WEB_ENABLE_BROWSER_LOGIN=0`.

Optional Caddy HTTPS reverse proxy:

```bash
docker compose --profile caddy --env-file .env.production up -d --build
```

Before enabling Caddy, confirm that host ports `80` and `443` are available, and configure `DOMAIN` and `ACME_EMAIL` in `.env.production`.

## Configuration

`settings.json` controls the traditional script mode.

| Field | Description |
| --- | --- |
| `save_path` | Output directory. Leave empty to use the project directory. Use `/` in Windows paths. |
| `user_lst` | Usernames to download, without `@`. Separate multiple users with English commas. |
| `cookie` | X/Twitter Cookie. Must include `auth_token` and `ct0`. |
| `time_range` | Date range, for example `2026-01-01:2026-05-25`. Empty value defaults to the most recent year. |
| `has_retweet` | Include retweets. This may significantly increase API usage. |
| `high_lights` | Download content from the Highlights tab. |
| `likes` | Download content from the Likes tab when visible to the current account. |
| `down_log` | Record downloaded items to reduce duplicate downloads. |
| `autoSync` | Adjust the left side of the time range based on existing local content. |
| `image_format` | Image format. Supported values: `orig`, `jpg`, `png`. |
| `has_video` | Download videos and GIFs. |
| `log_output` | Print download logs during script execution. |
| `max_concurrent_requests` | Maximum concurrent requests. Lower it when failures increase. |
| `proxy` | Proxy address. Supports HTTP, SOCKS5 and `host:port:user:pass` formats. |
| `md_output` | Generate Markdown records. |
| `media_count_limit` | Limit the number of media links in a single Markdown file. `0` means unlimited. |

## Script Entrypoints

| Script | Purpose |
| --- | --- |
| `web_app.py` | Full Web console backend. |
| `panel_app.py` | Lightweight local browser panel. |
| `main.py` | Download media by username according to `settings.json`. |
| `tag_down.py` | Download by tag, keyword or advanced search query. |
| `text_down.py` | Export text-only tweets for specified users. |
| `reply_down.py` | Download reply content for supported users or tweet links. |
| `profile_down.py` | Fetch user profile information. |

## Advanced Search

`tag_down.py` can work with X advanced search syntax. You can build a query from:

```text
https://x.com/search-advanced
```

Copy the generated search query and set it as `_filter` in `tag_down.py`.

Common use cases:

- Download by keyword.
- Split large tasks by date range.
- Include or exclude specific users.
- Filter by language.
- Filter by engagement metrics.
- Reduce rate-limit pressure by splitting large jobs into smaller tasks.

If a query contains double quotes, replace them with single quotes or escape them correctly in the Python string.

## Proxy Formats

Task configuration and proxy pools support these formats:

```text
http://127.0.0.1:7890
http://user:pass@gate.example.com:1000
socks5://user:pass@gate.example.com:1000
gate.example.com:1000:user:pass
```

The `host:port:user:pass` format is treated as an HTTP proxy and converted to `http://user:pass@host:port` before use. Use a full `socks5://user:pass@host:port` URL when the provider requires SOCKS5.

## Rate Limits and Reliability

X/Twitter may limit API usage by account, endpoint, time window or behavior pattern. If the program reports `Rate limit exceeded`, the current account is likely temporarily limited.

Recommended mitigation:

- Disable `has_retweet` when retweets are not required.
- Split large jobs into smaller date ranges.
- Reduce `max_concurrent_requests` when downloads fail frequently.
- Refresh `auth_token` and `ct0` when the Cookie expires.
- Verify proxy availability before running large tasks.
- Use authorized accounts and avoid unnecessary repeated requests.

Resource governance defaults:

| Environment variable | Default | Description |
| --- | ---: | --- |
| `TW_ACCOUNT_NEW_TASK_LIMIT_24H` | `3` | Daily task cap for new accounts. |
| `TW_ACCOUNT_STABLE_TASK_LIMIT_24H` | `20` | Daily task cap for stable accounts. |
| `TW_ACCOUNT_NEW_MIN_INTERVAL_SECONDS` | `1800` | Minimum interval between tasks for new accounts. |
| `TW_ACCOUNT_MIN_INTERVAL_SECONDS` | `600` | Minimum interval between tasks for stable accounts. |
| `TW_ACCOUNT_RATE_LIMIT_COOLDOWN_SECONDS` | `43200` | Account cooldown after rate-limit failures. |
| `TW_ACCOUNT_TRANSIENT_COOLDOWN_SECONDS` | `1800` | Account cooldown after transient network failures. |
| `TW_PROXY_MIN_INTERVAL_SECONDS` | `180` | Minimum interval between proxy assignments. |
| `TW_PROXY_FAILURE_COOLDOWN_SECONDS` | `1800` | Proxy cooldown after network failures. |
| `TW_PROXY_RATE_LIMIT_COOLDOWN_SECONDS` | `7200` | Proxy cooldown after rate-limit failures. |
| `TW_WORKER_CONCURRENCY` | `1` | Maximum background tasks running at once. |
| `TW_ACCOUNT_API_INTERVAL_SECONDS` | `8` | Minimum interval between account API requests across workers. |
| `TW_CRAWLER_PAGE_DELAY_SECONDS` | `6` | Delay after each GraphQL timeline page. |
| `TW_CRAWLER_REQUEST_RETRIES` | `1` | Request retries. Auth failures stop immediately. |
| `TW_MEDIA_DOWNLOAD_RETRIES` | `5` | Maximum retries per media download. |
| `TW_DEFAULT_MAX_CONCURRENT_REQUESTS` | `2` | Default media download concurrency. |
| `TW_MAX_CONCURRENT_REQUESTS_CAP` | `16` | Backend cap for task concurrency values. |
| `TW_ACCOUNT_HEALTH_MIN_INTERVAL_SECONDS` | `1800` | Minimum interval between account health checks. |

Scheduled tasks can use a fixed account or `account_id = 0` for automatic account assignment. Automatic assignment reuses the same resource governance and atomic reservation path as manually created tasks.

## FAQ

### Which Cookie fields are required?

At minimum:

```text
auth_token=your-value; ct0=your-value;
```

Do not commit real Cookies to a public repository. Treat Cookies as account credentials.

### How should Windows paths be written?

Use `/` in JSON values:

```text
D:/Downloads/twitter
```

Do not write unescaped backslashes directly in JSON strings.

### Why do downloads become slow or fail?

Common causes include account rate limits, unstable network, invalid proxy, expired Cookie, high concurrency or content that is not visible to the current account. Start by lowering concurrency, reducing the date range and checking the account session.

### How are duplicate downloads avoided?

Enable `down_log`. The program writes local download records and skips known items. To force a re-download, disable `down_log` or remove the corresponding `cache_data.log` file from the output directory.

## Security and Compliance

- Do not expose the Web console to the public Internet with the default password.
- Do not store real Cookies, proxy credentials or account secrets in version control.
- Downloaded media, text and profile data may be protected by copyright, platform terms and privacy rules.
- Confirm that you have the right to access, process, retain and distribute any collected data.
- For production or commercial use, evaluate the official X API and complete a separate legal and compliance review.

The user is solely responsible for account risk, data handling risk and legal consequences caused by improper use.
