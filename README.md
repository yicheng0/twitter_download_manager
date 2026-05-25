# 我的 Twitter/X 下载管理器

这是我整理维护的 Twitter/X 本地下载管理器版本。项目保留脚本下载能力，同时补充了本地 Web 面板，方便在浏览器里配置任务、查看日志和管理下载结果。

本项目仅用于学习、研究和个人资料备份。请使用自己的账号信息，遵守所在地区法律法规、目标平台规则和内容版权要求。

## 功能概览

- 按用户名下载推文图片、视频和 GIF。
- 支持多用户、时间范围、是否包含转推、亮点、喜欢内容等选项。
- 支持 Tag / 高级搜索下载，可配合 X 高级搜索语法使用。
- 支持指定用户纯文本推文获取。
- 支持评论区内容下载。
- 支持用户主页资料获取，包括头像、banner 和简介。
- 支持去重记录、自动同步、Markdown 记录和 CSV 统计。
- 提供本地浏览器面板，用表单启动任务并查看实时日志。

## 环境要求

- Python 3.8 或更高版本。
- 建议使用虚拟环境。
- 需要一个可用的 X/Twitter 登录会话 Cookie，至少包含 `auth_token` 和 `ct0`。

安装依赖：

```bash
pip install -r requirements.txt
```

如果需要使用浏览器登录相关能力，还需要安装 Playwright 浏览器：

```bash
python -m playwright install
```

## 线上部署

仓库已经带好 Docker 发布文件，适合单机 Linux 公网部署。

```bash
cp env.production.example .env.production
# 修改 APP_HOST_PORT、TW_WEB_ADMIN_PASSWORD、TW_WEB_SESSION_SECRET
docker compose --env-file .env.production up -d --build app
```

部署后：

- 应用容器内部监听 `8000`，默认通过宿主机 `18081` 对外访问，可用 `APP_HOST_PORT` 改成其它空闲端口。
- 如需使用 Caddy 接管 HTTPS 和域名反代，先确认宿主机 `80/443` 没有被其它项目占用，再运行 `docker compose --profile caddy --env-file .env.production up -d --build`。
- 数据持久化在 `./data`，包括 SQLite、任务文件和下载结果。
- 公网模式下管理员可以使用浏览器登录；如需完全关闭该能力，可设置 `TW_WEB_ENABLE_BROWSER_LOGIN=0`，再手动录入 `auth_token` 和 `ct0`。

## 推荐启动方式

### 完整 Web 管理端

推荐优先使用完整 Web 管理端，适合账号管理、代理池、任务队列、运行控制、结果汇报和打包下载。

首次使用或前端代码更新后，先构建 React 管理端：

```bash
cd frontend
npm install
npm run build
cd ..
```

然后启动后端：

```bash
python web_app.py
```

访问 `http://127.0.0.1:8000` 后，首页会显示“X 舆情采集看板”，包括任务总览、采集记录数、输出文件数、最近任务和任务模板。任务完成后，输出目录会生成 `summary_report.md`，用于快速说明采集目标、记录数、媒体数、互动指标和 Top 链接。

请注意：本项目适合内部研究和授权账号下的数据整理。X/Twitter 存在官方 API、平台规则、速率限制、内容版权和隐私边界；生产化前建议迁移到官方 API，并单独确认授权、数据留存和合规要求。

### 轻量本地面板

适合自己本机快速使用。

```bash
python panel_app.py
```

启动后访问：

```text
http://127.0.0.1:7860
```

面板支持填写用户名、Cookie、保存目录、日期范围、图片格式、并发数量、代理和常用下载选项。任务启动后可以在页面里查看运行状态、API 调用数、下载数量和实时日志。

默认管理员账号由环境变量控制：

```text
TW_WEB_ADMIN_USER=admin
TW_WEB_ADMIN_PASSWORD=admin123
```

首次公开部署前请务必修改默认密码。本项目更推荐只在本机或可信内网运行。

### 传统脚本方式

如果只想按配置文件运行媒体下载：

```bash
python main.py
```

脚本会读取 `settings.json`。常用字段如下：

| 字段 | 说明 |
| --- | --- |
| `save_path` | 保存目录，留空则保存到项目目录 |
| `user_lst` | 用户名列表，多个用户用英文逗号分隔，不需要 `@` |
| `cookie` | X/Twitter Cookie，必须包含 `auth_token` 和 `ct0` |
| `time_range` | 时间范围，格式如 `1990-01-01:2030-01-01` |
| `has_retweet` | 是否包含转推，开启后 API 消耗会明显增加 |
| `high_lights` | 是否下载 Highlights 内容 |
| `likes` | 是否下载 Likes 内容，仅适合本人账号可访问内容 |
| `down_log` | 记录已下载内容，避免重复下载 |
| `autoSync` | 根据本地已有内容自动同步新内容 |
| `image_format` | 图片格式，可选 `orig`、`jpg`、`png` |
| `has_video` | 是否下载视频和 GIF |
| `max_concurrent_requests` | 并发数量，失败较多时建议调低 |
| `proxy` | 代理地址，例如 `http://localhost:7890` |
| `md_output` | 是否生成 Markdown 记录 |

## 其他脚本入口

| 脚本 | 用途 |
| --- | --- |
| `main.py` | 按用户名下载媒体内容 |
| `tag_down.py` | 按 Tag 或高级搜索下载 |
| `text_down.py` | 获取指定用户纯文本推文 |
| `reply_down.py` | 下载指定用户或推文链接的评论区内容 |
| `profile_down.py` | 获取用户主页资料 |
| `panel_app.py` | 启动轻量本地面板 |
| `web_app.py` | 启动完整 Web 管理端 |

## 高级搜索说明

`tag_down.py` 可以配合 X 高级搜索使用。你可以在下面页面组装搜索条件：

```text
https://x.com/search-advanced
```

复制搜索栏里的条件后，填入 `tag_down.py` 的 `_filter`。如果条件中包含英文双引号，建议改成英文单引号或做好转义，避免 Python 字符串解析错误。

常见用途：

- 按关键词下载。
- 按时间范围分批下载。
- 指定或排除用户。
- 指定语言。
- 按互动量筛选。
- 拆分大任务，降低失败概率和限流压力。

## API 限流与稳定性

X/Twitter 接口会限制请求频率和每日调用量。如果程序出现类似 `Rate limit exceeded` 的提示，通常表示当前账号 API 调用次数暂时耗尽，需要等待恢复或减少任务规模。

经验建议：

- 不需要转推时关闭 `has_retweet`。
- 大任务拆成多个小时间段执行。
- 下载失败较多时降低 `max_concurrent_requests`。
- Cookie 失效时重新获取 `auth_token` 和 `ct0`。
- 使用代理时确认代理本身稳定可用。

## 常见问题

### Cookie 应该填什么？

至少需要包含：

```text
auth_token=你的值; ct0=你的值;
```

不要把示例里的 `xxxxxxxxxxx` 原样保留。Cookie 只建议在本机使用，不要提交到公开仓库。

### Windows 路径怎么写？

配置文件里建议使用 `/`：

```text
D:/Downloads/twitter
```

不要在 JSON 里直接写未转义的反斜杠。

### 为什么下载变慢或失败？

常见原因是账号限流、网络不稳定、代理异常、并发过高或目标内容权限不可见。先降低并发、缩小时间范围，再重新运行。

### 已下载的内容如何避免重复？

开启 `down_log` 后，程序会记录已下载内容，减少重复下载。如果你想强制重新下载，需要关闭该选项，或删除对应目录下的 `cache_data.log`。

## 使用边界

本项目是个人学习和本地管理工具，不提供任何规避平台限制的保证。下载到的图片、视频、文本等内容版权归内容创作者和平台所有。请勿用于商业采集、批量滥用、非法传播或侵犯他人权益的用途。因不当使用造成的账号风险、数据风险或法律责任，由使用者自行承担。
