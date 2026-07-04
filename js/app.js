import { scenarios } from "./scenarios.js";
import { createState, getDerivedViews, loadVirtualBrowser, runCommand } from "./engine.js";

const STORAGE_KEYS = {
  scenario: "apache-lab:scenario",
  terminalMode: "apache-lab:terminal-mode",
  terminalGeometry: "apache-lab:terminal-geometry"
};

const selectors = {
  scenarioList: "#scenarioList",
  progressText: "#progressText",
  progressBar: "#progressBar",
  resetScenario: "#resetScenario",
  exerciseMeta: "#exerciseMeta",
  exerciseTitle: "#exerciseTitle",
  exerciseDescription: "#exerciseDescription",
  exerciseSummary: "#exerciseSummary",
  guideSteps: "#guideSteps",
  goalList: "#goalList",
  serviceList: "#serviceList",
  packageList: "#packageList",
  listenerList: "#listenerList",
  networkState: "#networkState",
  browserForm: "#browserForm",
  browserUrl: "#browserUrl",
  browserReload: "#browserReload",
  browserViewport: "#browserViewport",
  commandTips: "#commandTips",
  terminalPanel: "#terminalPanel",
  terminalHeader: "#terminalHeader",
  terminalHome: "#terminalHome",
  terminalResize: "#terminalResize",
  terminalOutput: "#terminalOutput",
  terminalForm: "#terminalForm",
  terminalInput: "#terminalInput"
};

const els = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, document.querySelector(selector)]));

let currentScenarioId = readStorage(STORAGE_KEYS.scenario) || scenarios[0].id;
let state = createState(currentScenarioId);
let terminalLines = [];
let historyIndex = 0;
let dragState = null;
let resizeState = null;

init();

function init() {
  appendTerminal("system", "systemd / Apache 初級ラボへようこそ。help で利用できるコマンドを確認できます。");
  bindEvents();
  restoreTerminalMode();
  render();
  renderTerminal();
  focusTerminal();
}

function bindEvents() {
  els.scenarioList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scenario-id]");
    if (!button) return;
    switchScenario(button.dataset.scenarioId);
  });

  els.resetScenario.addEventListener("click", () => resetScenario());

  document.addEventListener("click", (event) => {
    const commandButton = event.target.closest("[data-command]");
    if (commandButton) {
      insertCommand(commandButton.dataset.command);
      return;
    }

    const browserButton = event.target.closest("[data-browser-url]");
    if (browserButton) {
      loadBrowser(browserButton.dataset.browserUrl);
    }
  });

  els.browserForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadBrowser(els.browserUrl.value);
  });

  els.browserReload.addEventListener("click", () => loadBrowser(els.browserUrl.value));

  els.terminalForm.addEventListener("submit", (event) => {
    event.preventDefault();
    executeTerminalCommand();
  });

  els.terminalInput.addEventListener("keydown", handleTerminalKeys);

  document.querySelectorAll("[data-terminal-mode]").forEach((button) => {
    button.addEventListener("click", () => setTerminalMode(button.dataset.terminalMode));
  });

  els.terminalHome.addEventListener("click", () => {
    resetTerminalGeometry();
    focusTerminal();
  });

  els.terminalHeader.addEventListener("pointerdown", startTerminalDrag);
  els.terminalResize.addEventListener("pointerdown", startTerminalResize);
  window.addEventListener("pointermove", moveTerminalPointer);
  window.addEventListener("pointerup", stopTerminalPointer);
  window.addEventListener("resize", clampTerminalToViewport);
}

function switchScenario(scenarioId) {
  currentScenarioId = scenarioId;
  writeStorage(STORAGE_KEYS.scenario, scenarioId);
  state = createState(scenarioId);
  terminalLines = [];
  appendTerminal("system", `演習を切り替えました: ${getDerivedViews(state).scenario.title}`);
  render();
  renderTerminal();
  focusTerminal();
}

function resetScenario() {
  state = createState(currentScenarioId);
  terminalLines = [];
  appendTerminal("system", "演習を初期状態へ戻しました。");
  render();
  renderTerminal();
  focusTerminal();
}

function executeTerminalCommand() {
  const input = els.terminalInput.value.trim();
  if (!input) return;
  appendTerminal("input", `[student@web01 ~]$ ${input}`);
  els.terminalInput.value = "";

  const result = runCommand(state, input);
  historyIndex = state.commands.length;

  if (result.clear) {
    terminalLines = [];
  } else if (result.output) {
    appendTerminal("output", result.output);
  }

  if (result.reset) {
    state = createState(currentScenarioId);
    appendTerminal("system", "初期状態へ戻りました。");
  }

  render();
  renderTerminal();
  focusTerminal();
}

function handleTerminalKeys(event) {
  if (event.isComposing) return;

  if (event.key === "ArrowUp") {
    event.preventDefault();
    const history = state.commands.map((command) => command.raw);
    if (!history.length) return;
    historyIndex = Math.max(0, historyIndex - 1);
    els.terminalInput.value = history[historyIndex] || history[0];
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    const history = state.commands.map((command) => command.raw);
    if (!history.length) return;
    historyIndex = Math.min(history.length, historyIndex + 1);
    els.terminalInput.value = historyIndex >= history.length ? "" : history[historyIndex];
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    completeCommand();
    return;
  }

  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    appendTerminal("input", "^C");
    appendTerminal("output", "Interrupt: 実行中のフォアグラウンド処理はありません。");
    renderTerminal();
    return;
  }

  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    appendTerminal("input", "^Z");
    appendTerminal("output", "Stopped: このラボでは長時間実行ジョブは開始されていません。");
    renderTerminal();
  }
}

function completeCommand() {
  const value = els.terminalInput.value;
  const commands = commandPalette();
  const matches = commands.filter((command) => command.startsWith(value));
  if (matches.length === 1) {
    els.terminalInput.value = matches[0];
  } else if (matches.length > 1) {
    appendTerminal("output", matches.join("    "));
    renderTerminal();
  }
}

function insertCommand(command) {
  els.terminalInput.value = command;
  focusTerminal({ force: true });
}

function loadBrowser(url) {
  const result = loadVirtualBrowser(state, url);
  els.browserUrl.value = result.url;
  render();
  focusTerminal();
}

function render() {
  const view = getDerivedViews(state);
  renderScenarioList(view);
  renderCurrentExercise(view);
  renderGuide(view);
  renderGoals(view);
  renderState(view);
  renderBrowser(view);
  renderCommandTips(view);
}

function renderScenarioList(view) {
  els.scenarioList.innerHTML = scenarios
    .map((scenario, index) => {
      const active = scenario.id === view.scenario.id ? " active" : "";
      return `
        <button class="scenario-item${active}" type="button" data-scenario-id="${escapeAttr(scenario.id)}">
          <span class="scenario-number">${index + 1}</span>
          <span>
            <strong>${escapeHtml(scenario.title)}</strong>
            <small>${escapeHtml(scenario.level)} / ${escapeHtml(scenario.duration)}</small>
          </span>
        </button>
      `;
    })
    .join("");

  els.progressText.textContent = `${view.progress.done}/${view.progress.total}`;
  const percent = view.progress.total === 0 ? 0 : Math.round((view.progress.done / view.progress.total) * 100);
  els.progressBar.style.width = `${percent}%`;
}

function renderCurrentExercise(view) {
  els.exerciseMeta.textContent = `${view.scenario.level} / ${view.scenario.duration}`;
  els.exerciseTitle.textContent = view.scenario.title;
  els.exerciseDescription.textContent = view.scenario.description;
  els.exerciseSummary.textContent = view.scenario.guide.summary;
}

function renderGuide(view) {
  els.guideSteps.innerHTML = view.guide
    .map((step, index) => {
      const commands = step.commands
        .map((command) => `<button type="button" class="command-chip" data-command="${escapeAttr(command)}">${escapeHtml(command)}</button>`)
        .join("");
      const browserAction = step.browserUrl
        ? `<button type="button" class="command-chip browser-chip" data-browser-url="${escapeAttr(step.browserUrl)}">仮想ブラウザ: ${escapeHtml(step.browserUrl)}</button>`
        : "";
      return `
        <section class="step-item${step.done ? " done" : ""}">
          <div class="step-index">${step.done ? "✓" : index + 1}</div>
          <div>
            <div class="step-phase">${escapeHtml(step.phase)}</div>
            <h4>${escapeHtml(step.purpose)}</h4>
            <p>${escapeHtml(step.expected)}</p>
            <div class="chip-row">${commands}${browserAction}</div>
          </div>
        </section>
      `;
    })
    .join("");
}

function renderGoals(view) {
  els.goalList.innerHTML = view.goals
    .map(
      (goal) => `
        <li class="${goal.done ? "done" : ""}">
          <span>${goal.done ? "✓" : ""}</span>
          <p>${escapeHtml(goal.text)}</p>
        </li>
      `
    )
    .join("");
}

function renderState(view) {
  els.serviceList.innerHTML = view.services
    .map((service) => {
      const statusClass = service.activeState === "active" ? "ok" : service.activeState === "failed" ? "bad" : "idle";
      const unitState = service.installed ? (service.enabled ? "enabled" : "disabled") : "not installed";
      const ports = service.ports.length ? `port ${service.ports.join(", ")}` : "no listener";
      return `
        <div class="service-row">
          <div>
            <strong>${escapeHtml(service.name)}.service</strong>
            <small>${escapeHtml(unitState)}</small>
          </div>
          <div class="service-status ${statusClass}">${escapeHtml(service.activeState)}</div>
          <div class="service-port">${escapeHtml(ports)}</div>
        </div>
      `;
    })
    .join("");

  els.packageList.innerHTML = view.packages
    .map(
      (pkg) => `
        <div class="mini-row">
          <span>${escapeHtml(pkg.name)}</span>
          <strong>${pkg.installed ? "installed" : "available"}</strong>
        </div>
      `
    )
    .join("");

  els.listenerList.innerHTML = view.listeners.length
    ? view.listeners
        .map(
          (listener) => `
            <div class="mini-row">
              <span>${escapeHtml(listener.process)}</span>
              <strong>0.0.0.0:${listener.port}</strong>
            </div>
          `
        )
        .join("")
    : `<div class="empty-note">LISTEN中のTCPポートはありません。</div>`;

  els.networkState.innerHTML = `
    <div class="network-line"><span>IF</span><strong>${escapeHtml(view.network.interface)}</strong></div>
    <div class="network-line"><span>IP</span><strong>${escapeHtml(view.network.address)}</strong></div>
    <div class="network-line"><span>GW</span><strong>${escapeHtml(view.network.gateway)}</strong></div>
    <div class="network-line"><span>DNS</span><strong>${escapeHtml(view.network.dns)}</strong></div>
  `;
}

function renderBrowser(view) {
  els.browserUrl.value = view.browser.url;
  if (view.browser.kind === "apache") {
    els.browserViewport.innerHTML = `
      <div class="browser-page apache-test-page">
        <header class="apache-test-header">
          <h4>${escapeHtml(view.browser.title)}</h4>
        </header>
        <div class="apache-test-content">
          <p class="apache-test-intro">${escapeHtml(view.browser.body)}</p>
          <div class="apache-test-columns">
            <section class="apache-test-section">
              <h5>あなたが一般ユーザーの場合:</h5>
              <p>このページが表示されているということは、アクセス先のWebサーバーはHTTPリクエストに応答しています。</p>
              <p>期待したWebサイトではなくこのテストページが表示される場合は、まだ公開用コンテンツが配置されていない可能性があります。</p>
              <p>この仮想ラボでは、Apacheの起動確認としてこの画面を使います。端末の <code>curl http://localhost/</code> と同じサーバー応答を、ブラウザ表示として確認しています。</p>
            </section>
            <section class="apache-test-section">
              <h5>あなたがWebサイト管理者の場合:</h5>
              <p>Apache HTTP Server は起動しており、port 80で待ち受けています。学習環境では、systemdで <code>httpd.service</code> がactiveになっている状態です。</p>
              <p>Webサイトを公開するには、DocumentRootである <code>/var/www/html/</code> にHTMLファイルを追加します。設定を変更した場合は、サービスの再読み込みや再起動も確認してください。</p>
              <div class="apache-powered" aria-label="Powered by Apache 2.4">
                <span class="apache-feather"></span>
                <span class="apache-powered-text">
                  <small>Powered by</small>
                  <strong>APACHE</strong>
                  <em>2.4</em>
                </span>
              </div>
            </section>
          </div>
          <p class="apache-test-meta">
            <span>URL: ${escapeHtml(view.browser.url)}</span>
            <span>Status: ${escapeHtml(view.browser.status)}</span>
            <span>Host: ${escapeHtml(view.browser.host || "web01.lab.local")}</span>
            <span>Service: ${escapeHtml(view.browser.service || "httpd.service")}</span>
            <span>State: ${escapeHtml(view.browser.serviceState || "active")}</span>
            <span>Port: ${escapeHtml(view.browser.port || 80)}</span>
          </p>
        </div>
      </div>
    `;
    return;
  }

  const statusClass = view.browser.kind === "idle" ? "idle" : "error";
  els.browserViewport.innerHTML = `
    <div class="browser-message ${statusClass}">
      <strong>${escapeHtml(view.browser.title)}</strong>
      <span>${escapeHtml(view.browser.status)}</span>
      <p>${escapeHtml(view.browser.body)}</p>
    </div>
  `;
}

function renderCommandTips(view) {
  els.commandTips.innerHTML = view.commandTips
    .map((command) => `<button type="button" class="command-chip" data-command="${escapeAttr(command)}">${escapeHtml(command)}</button>`)
    .join("");
}

function appendTerminal(kind, text) {
  terminalLines.push({ kind, text });
  if (terminalLines.length > 120) terminalLines = terminalLines.slice(-120);
}

function renderTerminal() {
  els.terminalOutput.innerHTML = terminalLines
    .map((line) => `<div class="terminal-line ${escapeAttr(line.kind)}">${escapeHtml(line.text)}</div>`)
    .join("");
  els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
}

function commandPalette() {
  const view = getDerivedViews(state);
  return Array.from(
    new Set([
      ...view.commandTips,
      "help",
      "clear",
      "reset",
      "sudo dnf makecache",
      "dnf info httpd",
      "sudo dnf install -y httpd",
      "systemctl status httpd",
      "sudo systemctl start httpd",
      "sudo systemctl enable httpd",
      "journalctl -u httpd -n 20",
      "ss -lntp",
      "curl http://localhost/",
      "ip addr",
      "ip route",
      "ping -c 2 192.168.56.1",
      "cat /usr/lib/systemd/system/httpd.service"
    ])
  ).sort();
}

function restoreTerminalMode() {
  const mode = readStorage(STORAGE_KEYS.terminalMode) || "embedded";
  setTerminalMode(mode, false);
  const geometry = readJsonStorage(STORAGE_KEYS.terminalGeometry);
  if (geometry) applyTerminalGeometry(geometry);
}

function setTerminalMode(mode, persist = true) {
  document.body.dataset.terminalMode = mode;
  els.terminalPanel.classList.toggle("is-floating", mode === "floating");
  els.terminalPanel.classList.toggle("is-expanded", mode === "expanded");
  els.terminalPanel.classList.toggle("is-minimized", mode === "minimized");

  if (mode === "embedded" || mode === "expanded" || mode === "minimized") {
    els.terminalPanel.style.left = "";
    els.terminalPanel.style.top = "";
    els.terminalPanel.style.width = "";
    els.terminalPanel.style.height = "";
  }
  if (mode === "floating" && !els.terminalPanel.style.left) {
    applyTerminalGeometry(defaultTerminalGeometry());
  }
  if (persist) writeStorage(STORAGE_KEYS.terminalMode, mode);
  clampTerminalToViewport();
  focusTerminal();
}

function startTerminalDrag(event) {
  if (document.body.dataset.terminalMode !== "floating") return;
  if (event.target.closest("button")) return;
  const rect = els.terminalPanel.getBoundingClientRect();
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    left: rect.left,
    top: rect.top
  };
  els.terminalHeader.setPointerCapture(event.pointerId);
}

function startTerminalResize(event) {
  if (document.body.dataset.terminalMode !== "floating") return;
  const rect = els.terminalPanel.getBoundingClientRect();
  resizeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    width: rect.width,
    height: rect.height
  };
  els.terminalResize.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function moveTerminalPointer(event) {
  if (dragState) {
    const geometry = currentTerminalGeometry();
    geometry.left = dragState.left + (event.clientX - dragState.startX);
    geometry.top = dragState.top + (event.clientY - dragState.startY);
    applyTerminalGeometry(clampedGeometry(geometry));
  }

  if (resizeState) {
    const geometry = currentTerminalGeometry();
    geometry.width = resizeState.width + (event.clientX - resizeState.startX);
    geometry.height = resizeState.height + (event.clientY - resizeState.startY);
    applyTerminalGeometry(clampedGeometry(geometry));
  }
}

function stopTerminalPointer() {
  if (dragState || resizeState) {
    writeJsonStorage(STORAGE_KEYS.terminalGeometry, currentTerminalGeometry());
  }
  dragState = null;
  resizeState = null;
}

function clampTerminalToViewport() {
  if (document.body.dataset.terminalMode !== "floating") return;
  applyTerminalGeometry(clampedGeometry(currentTerminalGeometry()));
}

function resetTerminalGeometry() {
  applyTerminalGeometry(defaultTerminalGeometry());
  writeJsonStorage(STORAGE_KEYS.terminalGeometry, currentTerminalGeometry());
  if (document.body.dataset.terminalMode !== "floating") {
    setTerminalMode("floating");
  }
}

function currentTerminalGeometry() {
  const rect = els.terminalPanel.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width || 640,
    height: rect.height || 360
  };
}

function defaultTerminalGeometry() {
  return {
    left: Math.max(16, window.innerWidth - 680),
    top: Math.max(88, window.innerHeight - 430),
    width: Math.min(640, window.innerWidth - 32),
    height: Math.min(360, window.innerHeight - 110)
  };
}

function clampedGeometry(geometry) {
  const minWidth = Math.min(360, window.innerWidth - 24);
  const minHeight = 220;
  const width = Math.min(Math.max(geometry.width, minWidth), Math.max(minWidth, window.innerWidth - 24));
  const height = Math.min(Math.max(geometry.height, minHeight), Math.max(minHeight, window.innerHeight - 24));
  const left = Math.min(Math.max(geometry.left, 12), Math.max(12, window.innerWidth - width - 12));
  const top = Math.min(Math.max(geometry.top, 12), Math.max(12, window.innerHeight - height - 12));
  return { left, top, width, height };
}

function applyTerminalGeometry(geometry) {
  els.terminalPanel.style.left = `${geometry.left}px`;
  els.terminalPanel.style.top = `${geometry.top}px`;
  els.terminalPanel.style.width = `${geometry.width}px`;
  els.terminalPanel.style.height = `${geometry.height}px`;
}

function focusTerminal(options = {}) {
  const { force = false } = options;
  window.requestAnimationFrame(() => {
    if (!force && !shouldAutoFocusTerminal()) return;
    els.terminalInput.focus({ preventScroll: true });
  });
}

function shouldAutoFocusTerminal() {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (els.terminalPanel.contains(active)) return true;
  return !active.closest("input, select, textarea, button, a[href], [contenteditable='true']");
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be disabled in some classroom browser profiles.
  }
}

function readJsonStorage(key) {
  const value = readStorage(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function writeJsonStorage(key, value) {
  writeStorage(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
