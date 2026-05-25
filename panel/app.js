const form = document.querySelector("#configForm");
const startBtn = document.querySelector("#startBtn");
const stopBtn = document.querySelector("#stopBtn");
const reloadConfig = document.querySelector("#reloadConfig");
const clearLog = document.querySelector("#clearLog");
const logBox = document.querySelector("#logBox");
const toast = document.querySelector("#toast");
const statusPill = document.querySelector("#statusPill");
const statusText = document.querySelector("#statusText");

const fields = [
  "save_path",
  "user_lst",
  "cookie",
  "image_format",
  "max_concurrent_requests",
  "proxy",
  "media_count_limit",
  "has_video",
  "has_retweet",
  "down_log",
  "autoSync",
  "md_output",
];

let logsClearedAt = 0;

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDateRange() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 364);
  return `${formatDate(start)}:${formatDate(today)}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function setDateRange(value) {
  const fallback = defaultDateRange();
  const [fallbackStart, fallbackEnd] = fallback.split(":");
  const [start, end] = (value || fallback).split(":");
  document.querySelector("#start_date").max = fallbackEnd;
  document.querySelector("#end_date").max = fallbackEnd;
  document.querySelector("#start_date").value = start || fallbackStart;
  document.querySelector("#end_date").value = end || fallbackEnd;
}

function fillConfig(config) {
  for (const name of fields) {
    const el = document.querySelector(`#${name}`);
    if (!el || !(name in config)) continue;
    if (el.type === "checkbox") {
      el.checked = Boolean(config[name]);
    } else {
      el.value = config[name] ?? "";
    }
  }
  setDateRange(config.time_range);
}

function collectConfig() {
  const data = {};
  for (const name of fields) {
    const el = document.querySelector(`#${name}`);
    if (!el) continue;
    data[name] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  data.high_lights = false;
  data.likes = false;
  data.log_output = true;
  data.time_range = `${document.querySelector("#start_date").value}:${document.querySelector("#end_date").value}`;
  data.max_concurrent_requests = Number(data.max_concurrent_requests || 8);
  data.media_count_limit = Number(data.media_count_limit || 0);
  return data;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    let message = `请求失败：${response.status}`;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }
  return response.json();
}

function statusLabel(status) {
  const labels = {
    idle: "等待启动",
    starting: "正在启动",
    running: "运行中",
    stopping: "正在停止",
    stopped: "已停止",
    finished: "已完成",
    failed: "异常退出",
  };
  return labels[status] || status;
}

function formatSeconds(value) {
  const seconds = Math.max(0, Math.round(Number(value || 0)));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}m ${remain}s`;
}

function renderStatus(snapshot) {
  const status = snapshot.status || "idle";
  statusPill.className = `status-pill ${status}`;
  statusText.textContent = statusLabel(status);
  document.querySelector("#runningFor").textContent = formatSeconds(snapshot.running_for);
  document.querySelector("#apiCalls").textContent = snapshot.summary?.api_calls ?? 0;
  document.querySelector("#downloads").textContent = snapshot.summary?.downloads ?? 0;
  document.querySelector("#outputPath").textContent = snapshot.output_path || "-";

  startBtn.disabled = ["starting", "running", "stopping"].includes(status);
  stopBtn.disabled = !["starting", "running"].includes(status);

  const logs = snapshot.logs || [];
  if (snapshot.log_version > logsClearedAt) {
    logBox.textContent = logs.length ? logs.join("\n") : snapshot.message || "等待任务启动...";
    logBox.scrollTop = logBox.scrollHeight;
  }
}

async function loadConfig() {
  const config = await api("/api/config");
  fillConfig(config);
  showToast("默认配置已读取");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const config = collectConfig();
  if (!config.cookie.includes("auth_token=") || !config.cookie.includes("ct0=")) {
    showToast("cookie 需要包含 auth_token 和 ct0");
    return;
  }
  try {
    const snapshot = await api("/api/start", {
      method: "POST",
      body: JSON.stringify(config),
    });
    renderStatus(snapshot);
    showToast("任务已启动");
  } catch (error) {
    showToast(error.message);
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    const snapshot = await api("/api/stop", { method: "POST" });
    renderStatus(snapshot);
    showToast("已发送停止指令");
  } catch (error) {
    showToast(error.message);
  }
});

reloadConfig.addEventListener("click", () => {
  loadConfig().catch((error) => showToast(error.message));
});

clearLog.addEventListener("click", () => {
  logBox.textContent = "日志显示已清空，任务仍会继续运行。";
  fetch("/api/status")
    .then((response) => response.json())
    .then((snapshot) => {
      logsClearedAt = snapshot.log_version || 0;
    })
    .catch(() => {
      logsClearedAt = Number.MAX_SAFE_INTEGER;
    });
});

const events = new EventSource("/api/logs/stream");
events.onmessage = (event) => {
  renderStatus(JSON.parse(event.data));
};
events.onerror = () => {
  showToast("日志连接断开，正在等待浏览器重连");
};

loadConfig()
  .then(() => api("/api/status"))
  .then(renderStatus)
  .catch((error) => showToast(error.message));
