const STORAGE_KEY = "review-dashboard-connection";
const DEFAULT_PROMPT_TEMPLATE =
  "你是一个复习提醒助手。当前学习目标是：{learning_goal}。今天到了定期复习时间，请结合上一次复习内容和当前学习进度，直接输出一份新的复习清单。要求：仅输出无序列表；不要写解释；优先补强薄弱点。上一次复习内容：{previous_review_content}。当前学习进度：{learning_progress}。";

const state = {
  connection: inferConnection(),
  files: {
    jobs: null,
    reviewState: null,
    history: null,
  },
  jobsData: { jobs: [] },
  reviewStateData: { jobs: {} },
};

const elements = {
  owner: document.querySelector("#owner"),
  repo: document.querySelector("#repo"),
  branch: document.querySelector("#branch"),
  token: document.querySelector("#token"),
  rememberToken: document.querySelector("#remember-token"),
  loadButton: document.querySelector("#load-button"),
  saveButton: document.querySelector("#save-button"),
  dispatchButton: document.querySelector("#dispatch-button"),
  clearButton: document.querySelector("#clear-button"),
  taskList: document.querySelector("#task-list"),
  historyList: document.querySelector("#history-list"),
  statusLog: document.querySelector("#status-log"),
  addTaskButton: document.querySelector("#add-task-button"),
  taskTemplate: document.querySelector("#task-template"),
  metricTotal: document.querySelector("#metric-total"),
  metricEnabled: document.querySelector("#metric-enabled"),
  metricNextDate: document.querySelector("#metric-next-date"),
  defaultDifyBaseUrl: document.querySelector("#default-dify-base-url"),
  defaultApiKeyEnv: document.querySelector("#default-api-key-env"),
  defaultEmailCodeEnv: document.querySelector("#default-email-code-env"),
  defaultEmailAddress: document.querySelector("#default-email-address"),
  defaultContentOutputKey: document.querySelector("#default-content-output-key"),
  defaultHistoryLimit: document.querySelector("#default-history-limit"),
};

bootstrap();

function bootstrap() {
  fillConnectionForm();
  bindEvents();
  renderTasks();
  renderHistory();
  writeStatus("页面已就绪。先填写仓库连接信息，再读取数据。\n");
}

function bindEvents() {
  elements.loadButton.addEventListener("click", () => void handleLoad());
  elements.saveButton.addEventListener("click", () => void handleSave());
  elements.dispatchButton.addEventListener("click", () => void handleDispatch());
  elements.clearButton.addEventListener("click", clearSavedConnection);
  elements.addTaskButton.addEventListener("click", () => {
    const today = new Date().toISOString().slice(0, 10);
    state.jobsData.jobs.push(buildEmptyJob(today));
    renderTasks();
    renderSummary();
  });
}

function inferConnection() {
  const saved = loadSavedConnection();
  const inferred = {
    owner: "",
    repo: "",
    branch: saved.branch || "main",
    token: saved.token || "",
    remember: Boolean(saved.token),
  };

  if (window.location.hostname.endsWith("github.io")) {
    inferred.owner = window.location.hostname.split(".")[0];
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      inferred.repo = pathParts[0];
    }
  }

  return {
    owner: saved.owner || inferred.owner,
    repo: saved.repo || inferred.repo,
    branch: saved.branch || inferred.branch,
    token: saved.token || inferred.token,
    remember: saved.remember || inferred.remember,
  };
}

function loadSavedConnection() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveConnectionIfNeeded() {
  const connection = readConnectionForm();
  if (!connection.remember) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
}

function clearSavedConnection() {
  localStorage.removeItem(STORAGE_KEY);
  elements.token.value = "";
  elements.rememberToken.checked = false;
  writeStatus("已清除浏览器里保存的连接信息。\n", true);
}

function fillConnectionForm() {
  elements.owner.value = state.connection.owner;
  elements.repo.value = state.connection.repo;
  elements.branch.value = state.connection.branch || "main";
  elements.token.value = state.connection.token;
  elements.rememberToken.checked = state.connection.remember;
}

function readConnectionForm() {
  return {
    owner: elements.owner.value.trim(),
    repo: elements.repo.value.trim(),
    branch: elements.branch.value.trim() || "main",
    token: elements.token.value.trim(),
    remember: elements.rememberToken.checked,
  };
}

async function handleLoad() {
  try {
    const connection = validateConnection(false);
    state.connection = connection;
    saveConnectionIfNeeded();
    writeStatus("开始读取仓库数据...\n", true);

    const [jobsFile, stateFile, historyFile] = await Promise.all([
      getContentFile(connection, "review_jobs.json"),
      getContentFile(connection, "review_state.json", true),
      getContentFile(connection, "review_history.md", true),
    ]);

    state.files.jobs = jobsFile;
    state.files.reviewState = stateFile;
    state.files.history = historyFile;
    state.jobsData = jobsFile.content ? JSON.parse(jobsFile.content) : { jobs: [] };
    state.reviewStateData = stateFile.content ? JSON.parse(stateFile.content) : { jobs: {} };

    renderDefaultsFromJobs();
    renderTasks();
    renderHistory();
    renderSummary();
    writeStatus("仓库数据读取完成。\n");
  } catch (error) {
    writeStatus(`读取失败: ${error.message}\n`);
  }
}

async function handleSave() {
  try {
    const connection = validateConnection(true);
    state.connection = connection;
    saveConnectionIfNeeded();

    const jobsData = buildJobsPayload();
    const reviewStateData = buildStatePayload(jobsData);
    const historyMarkdown = renderHistoryMarkdown(reviewStateData, jobsData);

    writeStatus("正在保存到仓库...\n", true);

    const jobsResponse = await putContentFile(connection, "review_jobs.json", JSON.stringify(jobsData, null, 2) + "\n", state.files.jobs?.sha, "chore: update review jobs from dashboard");
    const stateResponse = await putContentFile(connection, "review_state.json", JSON.stringify(reviewStateData, null, 2) + "\n", state.files.reviewState?.sha, "chore: update review state from dashboard");
    const historyResponse = await putContentFile(connection, "review_history.md", historyMarkdown, state.files.history?.sha, "chore: update review history from dashboard");

    state.files.jobs = { sha: jobsResponse.content.sha, content: JSON.stringify(jobsData, null, 2) + "\n" };
    state.files.reviewState = { sha: stateResponse.content.sha, content: JSON.stringify(reviewStateData, null, 2) + "\n" };
    state.files.history = { sha: historyResponse.content.sha, content: historyMarkdown };
    state.jobsData = jobsData;
    state.reviewStateData = reviewStateData;

    renderHistory();
    renderSummary();
    writeStatus("保存完成。仓库里的学习任务、状态和历史都已更新。\n");
  } catch (error) {
    writeStatus(`保存失败: ${error.message}\n`);
  }
}

async function handleDispatch() {
  try {
    const connection = validateConnection(true);
    state.connection = connection;
    saveConnectionIfNeeded();

    writeStatus("正在触发 Review Notifier 工作流...\n", true);
    await githubFetch(connection, `/repos/${connection.owner}/${connection.repo}/actions/workflows/review-notifier.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: connection.branch }),
    });
    writeStatus("工作流已触发。如果某个任务的 next_review_date 小于等于今天，就会发送复习邮件。\n");
  } catch (error) {
    writeStatus(`触发失败: ${error.message}\n`);
  }
}

function validateConnection(requireToken) {
  const connection = readConnectionForm();
  if (!connection.owner || !connection.repo) {
    throw new Error("请先填写仓库所有者和仓库名");
  }
  if (requireToken && !connection.token) {
    throw new Error("写入仓库或触发 Action 时必须提供 GitHub Token");
  }
  return connection;
}

function renderDefaultsFromJobs() {
  const sample = state.jobsData.jobs[0] || {};
  elements.defaultDifyBaseUrl.value = sample.dify_base_url || "https://api.dify.ai/v1";
  elements.defaultApiKeyEnv.value = sample.api_key_env || "DIFY_API_KEY";
  elements.defaultEmailCodeEnv.value = sample.email_code_env || "QQ_EMAIL_CODE";
  elements.defaultEmailAddress.value = sample.email_address || "";
  elements.defaultContentOutputKey.value = sample.content_output_key || "content";
  elements.defaultHistoryLimit.value = sample.history_limit || 20;
}

function buildEmptyJob(today) {
  return {
    name: `task-${Date.now()}`,
    enabled: true,
    user_id: "",
    learning_goal: "",
    review_prompt_template: DEFAULT_PROMPT_TEMPLATE,
    email_subject_template: "{learning_goal} 复习提醒",
    email_address: elements.defaultEmailAddress.value.trim(),
    interval_days: 3,
    next_review_date: today,
  };
}

function renderTasks() {
  elements.taskList.innerHTML = "";
  if (!state.jobsData.jobs.length) {
    elements.taskList.innerHTML = '<div class="empty-state">还没有学习任务。点击“添加学习任务”开始。</div>';
    renderSummary();
    return;
  }

  state.jobsData.jobs.forEach((job, index) => {
    const fragment = elements.taskTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".task-card");
    const title = fragment.querySelector(".task-title");
    const removeButton = fragment.querySelector('[data-action="remove"]');
    const stateEntry = state.reviewStateData.jobs?.[job.name] || {};

    title.textContent = job.learning_goal || job.name || "未命名任务";

    card.querySelectorAll("[data-field]").forEach((field) => {
      const key = field.dataset.field;
      const source = key === "learning_progress" ? stateEntry : job;
      const value = source?.[key] ?? "";
      if (field.type === "checkbox") {
        field.checked = Boolean(value);
      } else {
        field.value = value;
      }

      field.addEventListener("input", () => {
        if (key === "learning_progress") {
          const entry = ensureStateEntry(job.name);
          entry.learning_progress = field.value;
        } else if (key === "name") {
          const oldName = job.name;
          const newName = field.value;
          migrateStateEntry(oldName, newName);
          job[key] = newName;
        } else if (field.type === "checkbox") {
          job[key] = field.checked;
        } else {
          job[key] = field.value;
        }

        if (key === "name") {
          title.textContent = job.learning_goal || field.value || "未命名任务";
          renderHistory();
        }
        if (key === "learning_goal") {
          title.textContent = field.value || job.name || "未命名任务";
          renderHistory();
        }
        renderSummary();
      });
    });

    removeButton.addEventListener("click", () => {
      state.jobsData.jobs.splice(index, 1);
      renderTasks();
      renderHistory();
      renderSummary();
    });

    elements.taskList.appendChild(fragment);
  });

  renderSummary();
}

function renderHistory() {
  elements.historyList.innerHTML = "";
  const stateJobs = state.reviewStateData.jobs || {};
  const entries = Object.entries(stateJobs);

  if (!entries.length) {
    elements.historyList.innerHTML = '<div class="empty-state">还没有历史记录。等 Action 发送过至少一次复习邮件后，这里就会出现内容。</div>';
    return;
  }

  for (const [jobName, entry] of entries) {
    const matchingJob = state.jobsData.jobs.find((job) => job.name === jobName);
    const card = document.createElement("article");
    card.className = "history-card";
    const title = matchingJob?.learning_goal || jobName;
    const history = Array.isArray(entry.history) ? [...entry.history].reverse() : [];

    card.innerHTML = `
      <div class="history-head">
        <div>
          <p class="eyebrow">历史任务</p>
          <h3>${escapeHtml(title)}</h3>
        </div>
        <strong>${entry.review_count || 0} 次复习</strong>
      </div>
      <div class="history-meta">
        最近发送：${escapeHtml(entry.last_sent_date || "暂无记录")}<br />
        当前进度：${escapeHtml(entry.learning_progress || "暂无记录")}
      </div>
    `;

    if (!history.length) {
      const empty = document.createElement("div");
      empty.className = "history-entry";
      empty.textContent = "暂无复习记录。";
      card.appendChild(empty);
    } else {
      history.slice(0, 5).forEach((item) => {
        const box = document.createElement("div");
        box.className = "history-entry";
        box.innerHTML = `
          <div class="history-entry-title">${escapeHtml(item.sent_at || "未知时间")} | ${escapeHtml(item.subject || "复习提醒")}</div>
          <div class="history-entry-content">${escapeHtml(item.content || "未保存到复习内容。")}</div>
        `;
        card.appendChild(box);
      });
    }

    elements.historyList.appendChild(card);
  }
}

function renderSummary() {
  const jobs = state.jobsData.jobs || [];
  const enabledJobs = jobs.filter((job) => job.enabled !== false);
  const nextDate = [...enabledJobs]
    .map((job) => job.next_review_date)
    .filter(Boolean)
    .sort()[0];

  elements.metricTotal.textContent = String(jobs.length);
  elements.metricEnabled.textContent = String(enabledJobs.length);
  elements.metricNextDate.textContent = nextDate || "-";
}

function ensureStateEntry(jobName) {
  if (!state.reviewStateData.jobs) {
    state.reviewStateData.jobs = {};
  }
  if (!state.reviewStateData.jobs[jobName]) {
    state.reviewStateData.jobs[jobName] = {
      learning_progress: "",
      last_sent_date: "",
      last_email_subject: "",
      last_review_content: "",
      review_count: 0,
      history: [],
    };
  }
  return state.reviewStateData.jobs[jobName];
}

function buildJobsPayload() {
  const defaults = {
    dify_base_url: elements.defaultDifyBaseUrl.value.trim(),
    api_key_env: elements.defaultApiKeyEnv.value.trim() || "DIFY_API_KEY",
    email_code_env: elements.defaultEmailCodeEnv.value.trim() || "QQ_EMAIL_CODE",
    email_address: elements.defaultEmailAddress.value.trim(),
    content_output_key: elements.defaultContentOutputKey.value.trim() || "content",
    history_limit: Number(elements.defaultHistoryLimit.value) || 20,
  };

  if (!defaults.dify_base_url) {
    throw new Error("请先填写 Dify Base URL");
  }

  const currentByName = new Map((state.jobsData.jobs || []).map((job) => [job.name, job]));
  const existingByName = new Map(((state.jobsData.jobs || []).map((job) => [job.name, job])));
  if (currentByName.size !== (state.jobsData.jobs || []).length) {
    throw new Error("任务 name 不能重复，请检查学习任务列表");
  }

  const jobs = [...currentByName.values()].map((job) => {
    if (!job.name.trim()) {
      throw new Error("每个学习任务都必须填写唯一的 name");
    }
    if (!job.learning_goal.trim()) {
      throw new Error(`任务 ${job.name} 缺少学习目标`);
    }
    if (!(job.email_address?.trim() || defaults.email_address)) {
      throw new Error(`任务 ${job.name} 缺少收件邮箱`);
    }

    const existing = existingByName.get(job.name) || {};
    return {
      name: job.name.trim(),
      enabled: job.enabled !== false,
      dify_base_url: defaults.dify_base_url,
      api_key_env: defaults.api_key_env,
      user_id: job.user_id?.trim() || existing.user_id || `review-bot-${job.name.trim()}`,
      learning_goal: job.learning_goal.trim(),
      review_prompt_template: job.review_prompt_template?.trim() || DEFAULT_PROMPT_TEMPLATE,
      email_subject_template: job.email_subject_template?.trim() || "{learning_goal} 复习提醒",
      email_address: job.email_address?.trim() || defaults.email_address,
      email_code_env: defaults.email_code_env,
      content_output_key: defaults.content_output_key,
      history_limit: defaults.history_limit,
      interval_days: Number(job.interval_days) || 3,
      next_review_date: job.next_review_date || new Date().toISOString().slice(0, 10),
      last_sent_date: existing.last_sent_date || "",
      last_result: existing.last_result || {},
    };
  });

  return { jobs };
}

function buildStatePayload(jobsData) {
  const nextState = structuredClone(state.reviewStateData.jobs || {});

  for (const job of jobsData.jobs) {
    const existing = nextState[job.name] || {};
    nextState[job.name] = {
      learning_progress: normalizeText(existing.learning_progress || readTaskLearningProgress(job.name)),
      last_sent_date: existing.last_sent_date || "",
      last_email_subject: existing.last_email_subject || "",
      last_review_content: existing.last_review_content || "",
      review_count: Number(existing.review_count) || 0,
      history: Array.isArray(existing.history) ? existing.history : [],
    };
  }

  return { jobs: nextState };
}

function readTaskLearningProgress(jobName) {
  const card = [...elements.taskList.querySelectorAll(".task-card")].find((node) => {
    const input = node.querySelector('[data-field="name"]');
    return input && input.value.trim() === jobName;
  });

  if (!card) {
    return "";
  }
  const field = card.querySelector('[data-field="learning_progress"]');
  return field ? field.value : "";
}

function migrateStateEntry(oldName, newName) {
  const trimmedOldName = normalizeText(oldName);
  const trimmedNewName = normalizeText(newName);
  if (!trimmedOldName || !trimmedNewName || trimmedOldName === trimmedNewName) {
    return;
  }
  if (!state.reviewStateData.jobs?.[trimmedOldName]) {
    return;
  }
  if (!state.reviewStateData.jobs[trimmedNewName]) {
    state.reviewStateData.jobs[trimmedNewName] = state.reviewStateData.jobs[trimmedOldName];
  }
  delete state.reviewStateData.jobs[trimmedOldName];
}

function renderHistoryMarkdown(reviewStateData, jobsData) {
  const lines = ["# 复习记录", ""];
  const jobsByName = new Map(jobsData.jobs.map((job) => [job.name, job]));

  for (const [jobName, entry] of Object.entries(reviewStateData.jobs || {}).sort(([a], [b]) => a.localeCompare(b))) {
    const learningGoal = jobsByName.get(jobName)?.learning_goal || jobName;
    lines.push(`## ${learningGoal}`);
    lines.push("");
    lines.push(`- 任务名：${jobName}`);
    lines.push(`- 最近发送：${entry.last_sent_date || "暂无记录"}`);
    lines.push(`- 学习进度：${entry.learning_progress || "暂无记录"}`);
    lines.push("");

    const history = Array.isArray(entry.history) ? [...entry.history].reverse() : [];
    if (!history.length) {
      lines.push("暂无复习记录。");
      lines.push("");
      continue;
    }

    for (const item of history) {
      lines.push(`### ${item.sent_at || "未知时间"} | ${item.subject || "复习提醒"}`);
      lines.push("");
      lines.push((item.content || "未保存到复习内容。").trim() || "未保存到复习内容。");
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

async function getContentFile(connection, path, optional = false) {
  try {
    const response = await githubFetch(connection, `/repos/${connection.owner}/${connection.repo}/contents/${path}?ref=${encodeURIComponent(connection.branch)}`);
    const content = decodeBase64Utf8(response.content || "");
    return { sha: response.sha, content };
  } catch (error) {
    if (optional && error.status === 404) {
      return { sha: undefined, content: "" };
    }
    throw error;
  }
}

async function putContentFile(connection, path, content, sha, message) {
  return githubFetch(connection, `/repos/${connection.owner}/${connection.repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: encodeBase64Utf8(content),
      sha,
      branch: connection.branch,
    }),
  });
}

async function githubFetch(connection, path, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    ...(options.headers || {}),
  };

  if (connection.token) {
    headers.Authorization = `Bearer ${connection.token}`;
  }

  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return {};
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.message || `GitHub API 请求失败: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function decodeBase64Utf8(value) {
  const cleaned = value.replace(/\n/g, "");
  const binary = atob(cleaned);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function writeStatus(message, reset = false) {
  if (reset) {
    elements.statusLog.textContent = "";
  }
  elements.statusLog.textContent += message;
  elements.statusLog.scrollTop = elements.statusLog.scrollHeight;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}