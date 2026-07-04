import { getScenario, scenarios } from "./scenarios.js";

const LOCAL_URLS = new Set(["localhost", "127.0.0.1", "::1", "web01.lab.local"]);

export function createState(scenarioInput = scenarios[0]) {
  const scenario = typeof scenarioInput === "string" ? getScenario(scenarioInput) : scenarioInput;
  const state = clone(scenario.start);
  state.scenarioId = scenario.id;
  state.commands = [];
  state.observations = [];
  state.successes = [];
  state.failures = [];
  state.logs = clone(scenario.start.logs || []);
  state.browser = {
    url: "http://localhost/",
    status: "未表示",
    ok: false,
    title: "仮想ブラウザ",
    kind: "idle",
    body: "アドレスバーに http://localhost/ を入れて開くと、仮想Apacheの状態に応じた表示になります。"
  };
  ensureDefaults(state);
  refreshVirtualFiles(state);
  return state;
}

export function runCommand(state, input) {
  const raw = input.trim();
  if (!raw) {
    return { state, output: "", clear: false, reset: false };
  }

  const tokens = tokenize(raw);
  if (tokens.error) {
    addFailure(state, "shell:parse-error");
    return { state, output: `bash: ${tokens.error}`, clear: false, reset: false };
  }

  const context = parseCommandContext(tokens);
  if (!context.tokens.length) {
    addFailure(state, "sudo:missing-command");
    return { state, output: "sudo: a command is required", clear: false, reset: false };
  }
  const normalized = normalizeTokens(context.tokens);
  state.commands.push({ raw, normalized });

  let result;
  switch (context.tokens[0]) {
    case "sudo":
      result = { output: "sudo: a command is required" };
      break;
    case "help":
      result = { output: helpText() };
      break;
    case "clear":
      result = { output: "", clear: true };
      break;
    case "reset":
      result = { output: "この演習を初期状態へ戻します。", reset: true };
      break;
    case "dnf":
      result = { output: handleDnf(state, context.tokens, context) };
      break;
    case "rpm":
      result = { output: handleRpm(state, tokens) };
      break;
    case "systemctl":
      result = { output: handleSystemctl(state, context.tokens, context) };
      break;
    case "journalctl":
      result = { output: handleJournalctl(state, tokens) };
      break;
    case "ss":
      result = { output: handleSs(state, tokens) };
      break;
    case "curl":
      result = { output: handleCurl(state, tokens) };
      break;
    case "ip":
      result = { output: handleIp(state, tokens) };
      break;
    case "ping":
      result = { output: handlePing(state, tokens) };
      break;
    case "dig":
      result = { output: handleDig(state, tokens) };
      break;
    case "nslookup":
      result = { output: handleNslookup(state, tokens) };
      break;
    case "cat":
      result = { output: handleCat(state, tokens) };
      break;
    case "hostnamectl":
      result = { output: handleHostnamectl(state) };
      break;
    default:
      addFailure(state, `command:not-found:${context.tokens[0]}`);
      result = { output: `bash: ${context.tokens[0]}: command not found\nヒント: help で、このラボで使えるコマンドを確認できます。` };
      break;
  }

  refreshVirtualFiles(state);
  return { state, clear: false, reset: false, ...result };
}

export function getDerivedViews(state) {
  const scenario = getScenario(state.scenarioId);
  const services = Object.keys(state.runtime.services).map((name) => {
    const config = state.config.services[name];
    const runtime = state.runtime.services[name];
    return {
      name,
      description: config.description,
      installed: Boolean(config.unitExists),
      enabled: Boolean(config.enabled),
      activeState: runtime.activeState,
      subState: runtime.subState,
      pid: runtime.pid,
      ports: runtime.ports,
      lastError: runtime.lastError
    };
  });

  const packages = Object.keys(state.config.packages).map((name) => ({
    name,
    ...state.config.packages[name]
  }));

  const guide = scenario.guide.steps.map((step) => ({
    ...step,
    done: evaluateCheck(state, step.doneWhen)
  }));

  const goals = scenario.goals.map((goal) => ({
    ...goal,
    done: evaluateCheck(state, goal.check)
  }));

  return {
    scenario,
    guide,
    goals,
    progress: {
      done: goals.filter((goal) => goal.done).length,
      total: goals.length
    },
    services,
    packages,
    files: Object.keys(state.files).sort().map((path) => ({ path, content: state.files[path] })),
    logs: state.logs.slice(-12),
    network: state.runtime.network,
    browser: { ...state.browser },
    listeners: activeListeners(state),
    commandTips: scenario.commandTips
  };
}

export function evaluateCheck(state, check) {
  if (!check) return false;
  if (check.all) return check.all.every((item) => evaluateCheck(state, item));
  if (check.any) return check.any.some((item) => evaluateCheck(state, item));

  switch (check.type) {
    case "observation":
      return state.observations.includes(check.id);
    case "success":
      return state.successes.includes(check.id);
    case "failure":
      return state.failures.includes(check.id);
    case "packageInstalled":
      return Boolean(state.config.packages[check.name]?.installed);
    case "serviceActive":
      return state.runtime.services[check.name]?.activeState === "active";
    case "serviceInactive":
      return state.runtime.services[check.name]?.activeState === "inactive";
    case "serviceEnabled":
      return Boolean(state.config.services[check.name]?.enabled);
    case "serviceDisabled":
      return !state.config.services[check.name]?.enabled;
    case "portListening":
      return isPortListening(state, check.port, check.service);
    case "browserOk":
      return Boolean(state.browser.ok);
    default:
      return false;
  }
}

export function loadVirtualBrowser(state, urlInput) {
  const url = normalizeUrl(urlInput || state.browser.url || "http://localhost/");
  const parsed = parseVirtualUrl(url);

  if (!parsed.ok) {
    state.browser = {
      url,
      status: "無効なURL",
      ok: false,
      title: "URLを確認してください",
      kind: "error",
      body: "http://localhost/ のようなURLを入力します。"
    };
    addFailure(state, "browser:invalid-url");
    return { ...state.browser };
  }

  if (!LOCAL_URLS.has(parsed.host)) {
    state.browser = {
      url,
      status: "DNS_PROBE_FINISHED_NXDOMAIN",
      ok: false,
      title: "名前解決に失敗しました",
      kind: "error",
      body: `${parsed.host} はこの仮想ラボのDNSでは解決できません。localhostで確認してください。`
    };
    addFailure(state, "browser:dns");
    return { ...state.browser };
  }

  addObservation(state, "browser:localhost");
  if (!isPortListening(state, 80, "httpd")) {
    state.browser = {
      url,
      status: "ERR_CONNECTION_REFUSED",
      ok: false,
      title: "このサイトにアクセスできません",
      kind: "refused",
      body: "localhostのport 80へ接続できません。端末で systemctl status httpd や ss -lntp を実行して、サービス状態と待ち受けポートを確認してください。"
    };
    addFailure(state, "web:httpd:browser:refused");
    return { ...state.browser };
  }

  addSuccess(state, "web:httpd:browser");
  state.browser = {
    url,
    status: "200 OK",
    ok: true,
    title: "Apache HTTP Server Welcome Page",
    kind: "apache",
    body: "It works! 仮想Apache httpd が正常に起動し、port 80でHTTPリクエストに応答しています。",
    host: state.runtime.hostname,
    service: "httpd.service",
    serviceState: state.runtime.services.httpd.activeState,
    port: 80
  };
  return { ...state.browser };
}

function handleDnf(state, tokens, context = { sudo: false }) {
  const subcommand = tokens[1];
  if (!subcommand) {
    return "usage: dnf [makecache|info|install|list|check-update|repolist] ...";
  }

  if (["makecache", "install"].includes(subcommand) && !context.sudo) {
    addFailure(state, `sudo:required:dnf:${subcommand}`);
    return sudoRequiredMessage(`dnf ${subcommand}`);
  }

  if (subcommand === "makecache") {
    state.runtime.cacheFresh = true;
    addSuccess(state, "dnf:makecache");
    return [
      "Rocky Linux 9 - BaseOS                     2.1 MB/s | 2.4 MB     00:01",
      "Rocky Linux 9 - AppStream                  2.8 MB/s | 8.3 MB     00:03",
      "Metadata cache created."
    ].join("\n");
  }

  if (subcommand === "repolist") {
    addObservation(state, "dnf:repolist");
    return [
      "repo id       repo name",
      "baseos        Rocky Linux 9 - BaseOS",
      "appstream     Rocky Linux 9 - AppStream"
    ].join("\n");
  }

  if (subcommand === "check-update") {
    addObservation(state, "dnf:check-update");
    return [
      "Last metadata expiration check: 0:02:11 ago on Sat 04 Jul 2026 10:16:00 AM JST.",
      "No packages marked for update in this lab."
    ].join("\n");
  }

  if (subcommand === "info") {
    const packageName = tokens[2];
    if (!packageName || !state.config.packages[packageName]) {
      return "Error: No matching Packages to list";
    }
    addObservation(state, `dnf:info:${packageName}`);
    const pkg = state.config.packages[packageName];
    return [
      `Name         : ${packageName}`,
      `Version      : ${pkg.version}`,
      "Architecture : x86_64",
      `Repository   : ${pkg.installed ? "@System" : pkg.repo}`,
      `Summary      : ${pkg.summary}`,
      packageName === "httpd"
        ? "Description  : Apache is a powerful, efficient, and extensible HTTP server."
        : "Description  : nginx is an HTTP and reverse proxy server."
    ].join("\n");
  }

  if (subcommand === "install") {
    const packageName = tokens.slice(2).find((token) => !token.startsWith("-"));
    if (!packageName || !state.config.packages[packageName]) {
      addFailure(state, "dnf:install:not-found");
      return "No match for argument.\nError: Unable to find a match";
    }
    const pkg = state.config.packages[packageName];
    if (pkg.installed) {
      addSuccess(state, `dnf:install:${packageName}`);
      return `Package ${packageName}-${pkg.version}.x86_64 is already installed.\nNothing to do.`;
    }
    pkg.installed = true;
    if (state.config.services[packageName]) {
      state.config.services[packageName].unitExists = true;
    }
    addSuccess(state, `dnf:install:${packageName}`);
    addLog(state, packageName, `Installed package ${packageName}-${pkg.version}.x86_64.`, "info");
    return [
      "Dependencies resolved.",
      "================================================================================",
      " Package      Architecture  Version            Repository      Size",
      ` ${packageName}        x86_64        ${pkg.version}     appstream       45 k`,
      "================================================================================",
      "Transaction Summary",
      "Install  1 Package",
      "",
      "Complete!"
    ].join("\n");
  }

  if (subcommand === "list") {
    const installedOnly = tokens.includes("installed");
    const packageName = tokens[tokens.length - 1] === "installed" ? "" : tokens[tokens.length - 1];
    addObservation(state, "dnf:list");
    return listPackages(state, installedOnly, packageName);
  }

  return `No such command: ${subcommand}. Please use /usr/bin/dnf --help`;
}

function handleRpm(state, tokens) {
  if (tokens[1] !== "-q" || !tokens[2]) {
    return "usage: rpm -q PACKAGE";
  }
  const packageName = tokens[2];
  addObservation(state, `rpm:q:${packageName}`);
  const pkg = state.config.packages[packageName];
  if (pkg?.installed) {
    return `${packageName}-${pkg.version}.x86_64`;
  }
  return `package ${packageName} is not installed`;
}

function handleSystemctl(state, tokens, context = { sudo: false }) {
  const args = tokens.slice(1).filter((token) => !token.startsWith("--"));
  const action = args[0];
  const unit = normalizeUnit(args[1]);
  if (!action) {
    return "systemctl [status|start|stop|restart|enable|disable|is-active|is-enabled] UNIT";
  }

  if (!["status", "start", "stop", "restart", "enable", "disable", "is-active", "is-enabled"].includes(action)) {
    addFailure(state, `systemctl:unsupported:${action}`);
    return `Unknown command verb ${action}.`;
  }

  if (["start", "stop", "restart", "enable", "disable"].includes(action) && !context.sudo) {
    addFailure(state, `sudo:required:systemctl:${action}:${unit || "missing"}`);
    return sudoRequiredMessage(`systemctl ${action}`);
  }

  if (!unit) {
    return `Too few arguments for systemctl ${action}.`;
  }

  if (!state.config.services[unit]) {
    addFailure(state, `systemctl:unknown-unit:${unit}`);
    return `Unit ${unit}.service could not be found.`;
  }

  if (action === "status") {
    addObservation(state, `systemctl:status:${unit}`);
    return serviceStatus(state, unit);
  }

  if (!state.config.services[unit].unitExists) {
    addFailure(state, `systemctl:${action}:${unit}:not-found`);
    return `Failed to ${action} ${unit}.service: Unit ${unit}.service not found.`;
  }

  if (action === "is-active") {
    addObservation(state, `systemctl:is-active:${unit}`);
    return state.runtime.services[unit].activeState;
  }

  if (action === "is-enabled") {
    addObservation(state, `systemctl:is-enabled:${unit}`);
    return state.config.services[unit].enabled ? "enabled" : "disabled";
  }

  if (action === "enable") {
    state.config.services[unit].enabled = true;
    addSuccess(state, `service:${unit}:enabled`);
    return [
      `Created symlink /etc/systemd/system/multi-user.target.wants/${unit}.service -> /usr/lib/systemd/system/${unit}.service.`,
      "enabled"
    ].join("\n");
  }

  if (action === "disable") {
    state.config.services[unit].enabled = false;
    addSuccess(state, `service:${unit}:disabled`);
    return [
      `Removed /etc/systemd/system/multi-user.target.wants/${unit}.service.`,
      "disabled"
    ].join("\n");
  }

  if (action === "stop") {
    const service = state.runtime.services[unit];
    service.activeState = "inactive";
    service.subState = "dead";
    service.result = "success";
    service.pid = null;
    service.ports = [];
    service.lastError = "";
    addSuccess(state, `service:${unit}:stopped`);
    if (unit === "nginx") addSuccess(state, "port:80:freed");
    addLog(state, unit, `Stopped ${state.config.services[unit].description}.`, "info");
    return "";
  }

  if (action === "start" || action === "restart") {
    if (action === "restart") {
      state.runtime.services[unit].activeState = "inactive";
      state.runtime.services[unit].ports = [];
      state.runtime.services[unit].pid = null;
      addLog(state, unit, `Stopped ${state.config.services[unit].description}.`, "info");
    }
    return startService(state, unit);
  }

  return "";
}

function handleJournalctl(state, tokens) {
  const unit = normalizeUnit(findJournalUnit(tokens));
  const limit = findJournalLimit(tokens) || 20;
  if (!unit) {
    return "Specify a unit with -u, for example: journalctl -u httpd -n 20";
  }
  if (unit === "httpd") {
    addObservation(state, "journalctl:httpd");
  } else {
    addObservation(state, `journalctl:${unit}`);
  }

  const rows = state.logs.filter((entry) => entry.unit === unit).slice(-limit);
  if (!rows.length) {
    return "-- No entries --";
  }
  return rows.map((entry) => `${entry.time} ${state.runtime.hostname} ${entry.unit}[${journalPid(state, entry.unit)}]: ${entry.message}`).join("\n");
}

function handleSs(state, tokens) {
  const joined = tokens.slice(1).join("");
  if (!joined.includes("l") || !joined.includes("n") || !joined.includes("t")) {
    return "Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process\nヒント: ss -lntp でLISTEN中のTCPポートを確認します。";
  }
  addObservation(state, "ss:lntp");
  const lines = ["State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process"];
  const listeners = activeListeners(state);
  if (!listeners.length) return lines.join("\n");
  for (const listener of listeners) {
    lines.push(
      `LISTEN 0      511          0.0.0.0:${listener.port}      0.0.0.0:*     users:(("${listener.process}",pid=${listener.pid},fd=4))`
    );
  }
  return lines.join("\n");
}

function handleCurl(state, tokens) {
  const url = tokens.slice(1).find((token) => !token.startsWith("-")) || "http://localhost/";
  const parsed = parseVirtualUrl(normalizeUrl(url));
  if (!parsed.ok || !LOCAL_URLS.has(parsed.host)) {
    addFailure(state, "curl:host");
    return `curl: (6) Could not resolve host: ${url}`;
  }
  addObservation(state, "curl:localhost");
  if (!isPortListening(state, 80, "httpd")) {
    addFailure(state, "web:httpd:curl:refused");
    return "curl: (7) Failed to connect to localhost port 80 after 0 ms: Connection refused";
  }
  addSuccess(state, "web:httpd:curl");
  return [
    "<!doctype html>",
    "<html>",
    "<head><title>Apache HTTP Server Test Page</title></head>",
    "<body>",
    "<h1>Apache HTTP Server Test Page</h1>",
    "<p>It works from the virtual httpd service.</p>",
    "</body>",
    "</html>"
  ].join("\n");
}

function handleIp(state, tokens) {
  const sub = tokens[1];
  if (sub === "addr" || sub === "a") {
    addObservation(state, "ip:addr");
    return [
      "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN",
      "    inet 127.0.0.1/8 scope host lo",
      `2: ${state.runtime.network.interface}: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP`,
      `    inet ${state.runtime.network.address} brd 192.168.56.255 scope global ${state.runtime.network.interface}`
    ].join("\n");
  }
  if (sub === "route" || sub === "r") {
    addObservation(state, "ip:route");
    return [
      `default via ${state.runtime.network.gateway} dev ${state.runtime.network.interface} proto dhcp metric 100`,
      `192.168.56.0/24 dev ${state.runtime.network.interface} proto kernel scope link src 192.168.56.20 metric 100`
    ].join("\n");
  }
  return "usage: ip [addr|route]";
}

function handlePing(state, tokens) {
  const target = tokens.slice(1).filter((token) => !token.startsWith("-") && !/^\d+$/.test(token)).pop();
  if (!target) return "usage: ping [-c COUNT] HOST";
  const host = target === "localhost" ? "127.0.0.1" : target;
  const ok = ["127.0.0.1", "192.168.56.1", "8.8.8.8", "web01.lab.local"].includes(host);
  addObservation(state, `ping:${target}`);
  if (!ok) {
    addFailure(state, `ping:${target}`);
    return `PING ${target} (${target}) 56(84) bytes of data.\nFrom 192.168.56.20 icmp_seq=1 Destination Host Unreachable\n\n--- ${target} ping statistics ---\n1 packets transmitted, 0 received, +1 errors, 100% packet loss`;
  }
  addSuccess(state, `ping:${target}`);
  return [
    `PING ${target} (${host}) 56(84) bytes of data.`,
    `64 bytes from ${host}: icmp_seq=1 ttl=64 time=0.321 ms`,
    `64 bytes from ${host}: icmp_seq=2 ttl=64 time=0.290 ms`,
    "",
    `--- ${target} ping statistics ---`,
    "2 packets transmitted, 2 received, 0% packet loss, time 1001ms"
  ].join("\n");
}

function handleDig(state, tokens) {
  const name = tokens[1] || "localhost";
  addObservation(state, `dig:${name}`);
  if (name === "localhost" || name === "web01.lab.local") {
    return [
      `;; QUESTION SECTION:`,
      `;${name}.                 IN      A`,
      "",
      ";; ANSWER SECTION:",
      `${name}.          0       IN      A       127.0.0.1`
    ].join("\n");
  }
  return ";; connection timed out; no servers could be reached";
}

function handleNslookup(state, tokens) {
  const name = tokens[1] || "localhost";
  addObservation(state, `nslookup:${name}`);
  if (name === "localhost" || name === "web01.lab.local") {
    return [
      `Server:         ${state.runtime.network.dns}`,
      `Address:        ${state.runtime.network.dns}#53`,
      "",
      `Name:   ${name}`,
      "Address: 127.0.0.1"
    ].join("\n");
  }
  return `** server can't find ${name}: NXDOMAIN`;
}

function handleCat(state, tokens) {
  const path = tokens[1];
  if (!path) return "cat: missing file operand";
  if (!state.files[path]) {
    addFailure(state, `cat:not-found:${path}`);
    return `cat: ${path}: No such file or directory`;
  }
  addObservation(state, `cat:${path}`);
  return state.files[path];
}

function handleHostnamectl(state) {
  addObservation(state, "hostnamectl");
  return [
    ` Static hostname: ${state.runtime.hostname}`,
    "       Icon name: computer-vm",
    "         Chassis: vm",
    "      Machine ID: 9f0d9d82d2a24df7a4d2f1c0a001lab",
    "   Boot ID: 5214e71c3c3d4f86a5f06f001apache",
    "Operating System: Rocky Linux 9.4 (Blue Onyx)",
    "     CPE OS Name: cpe:/o:rocky:rocky:9::baseos",
    "          Kernel: Linux 5.14.0-427.el9.x86_64",
    "    Architecture: x86-64"
  ].join("\n");
}

function startService(state, unit) {
  const serviceConfig = state.config.services[unit];
  const service = state.runtime.services[unit];
  const blocked = serviceConfig.ports.map((port) => portOwner(state, port, unit)).find(Boolean);

  if (blocked) {
    service.activeState = "failed";
    service.subState = "failed";
    service.result = "exit-code";
    service.pid = null;
    service.ports = [];
    service.lastError = `Address already in use: ${blocked.name}.service is already listening on port ${blocked.port}`;
    addFailure(state, `systemctl:start:${unit}:failed`);
    addLog(state, unit, `(98)Address already in use: AH00072: make_sock: could not bind to address 0.0.0.0:${blocked.port}`, "error");
    addLog(state, unit, "no listening sockets available, shutting down", "error");
    addLog(state, unit, `${unit}.service: Failed with result 'exit-code'.`, "info");
    return [
      `Job for ${unit}.service failed because the control process exited with error code.`,
      `See "systemctl status ${unit}.service" and "journalctl -xeu ${unit}.service" for details.`
    ].join("\n");
  }

  service.activeState = "active";
  service.subState = "running";
  service.result = "success";
  service.pid = state.runtime.nextPid++;
  service.ports = [...serviceConfig.ports];
  service.lastError = "";
  addSuccess(state, `service:${unit}:started`);
  for (const port of service.ports) {
    addSuccess(state, `port:${port}:listening`);
  }
  addLog(state, unit, `Started ${serviceConfig.description}.`, "info");
  if (unit === "httpd") {
    addLog(state, unit, "Server configured, listening on: port 80", "info");
  }
  return "";
}

function serviceStatus(state, unit) {
  const config = state.config.services[unit];
  if (!config.unitExists) {
    return `Unit ${unit}.service could not be found.`;
  }

  const service = state.runtime.services[unit];
  const loaded = `loaded (/usr/lib/systemd/system/${unit}.service; ${config.enabled ? "enabled" : "disabled"}; preset: disabled)`;
  const header = `● ${unit}.service - ${config.description}`;
  const logLines = state.logs
    .filter((entry) => entry.unit === unit)
    .slice(-4)
    .map((entry) => `${entry.time} ${state.runtime.hostname} ${unit}[${journalPid(state, unit)}]: ${entry.message}`);

  if (service.activeState === "active") {
    return [
      header,
      `     Loaded: ${loaded}`,
      "     Active: active (running) since Sat 2026-07-04 10:24:18 JST; 1min ago",
      `   Main PID: ${service.pid} (${unit})`,
      unit === "httpd" ? '     Status: "Total requests: 0; Idle/Busy workers 100/0"' : "",
      `      Tasks: ${unit === "httpd" ? "213" : "5"} (limit: 11120)`,
      `     Memory: ${unit === "httpd" ? "28.4M" : "9.6M"}`,
      `     CGroup: /system.slice/${unit}.service`,
      `             └─${service.pid} /usr/sbin/${unit} -DFOREGROUND`,
      ...logLines
    ].filter(Boolean).join("\n");
  }

  if (service.activeState === "failed") {
    return [
      header,
      `     Loaded: ${loaded}`,
      "     Active: failed (Result: exit-code) since Sat 2026-07-04 10:23:14 JST; 2min ago",
      `    Process: 1443 ExecStart=/usr/sbin/${unit} $OPTIONS -DFOREGROUND (code=exited, status=1/FAILURE)`,
      `   Main PID: 1443 (code=exited, status=1/FAILURE)`,
      service.lastError ? `     Result: ${service.lastError}` : "",
      ...logLines
    ].filter(Boolean).join("\n");
  }

  return [
    header,
    `     Loaded: ${loaded}`,
    "     Active: inactive (dead)",
    ...logLines
  ].join("\n");
}

function listPackages(state, installedOnly, packageName) {
  const rows = [];
  for (const [name, pkg] of Object.entries(state.config.packages)) {
    if (packageName && packageName !== name) continue;
    if (installedOnly && !pkg.installed) continue;
    const repo = pkg.installed ? "@System" : pkg.repo;
    rows.push(`${name}.x86_64                         ${pkg.version}                     ${repo}`);
  }
  if (!rows.length) return "Error: No matching Packages to list";
  return [installedOnly ? "Installed Packages" : "Available Packages", ...rows].join("\n");
}

function activeListeners(state) {
  const listeners = [];
  for (const [name, service] of Object.entries(state.runtime.services)) {
    if (service.activeState !== "active") continue;
    for (const port of service.ports) {
      listeners.push({ service: name, process: name, pid: service.pid, port });
    }
  }
  return listeners;
}

function isPortListening(state, port, serviceName) {
  return activeListeners(state).some((listener) => listener.port === port && (!serviceName || listener.service === serviceName));
}

function portOwner(state, port, excludeService) {
  return activeListeners(state).find((listener) => listener.port === port && listener.service !== excludeService);
}

function refreshVirtualFiles(state) {
  const base = {
    "/etc/os-release": [
      'NAME="Rocky Linux"',
      'VERSION="9.4 (Blue Onyx)"',
      'ID="rocky"',
      'PLATFORM_ID="platform:el9"',
      'PRETTY_NAME="Rocky Linux 9.4 (Blue Onyx)"'
    ].join("\n"),
    "/etc/hostname": state.runtime.hostname,
    "/etc/resolv.conf": `nameserver ${state.runtime.network.dns}\nsearch lab.local`,
    "/etc/yum.repos.d/rocky.repo": [
      "[baseos]",
      "name=Rocky Linux 9 - BaseOS",
      "enabled=1",
      "",
      "[appstream]",
      "name=Rocky Linux 9 - AppStream",
      "enabled=1"
    ].join("\n")
  };

  if (state.config.packages.httpd.installed) {
    base["/etc/httpd/conf/httpd.conf"] = [
      "ServerRoot \"/etc/httpd\"",
      "Listen 80",
      "IncludeOptional conf.modules.d/*.conf",
      "User apache",
      "Group apache",
      "DocumentRoot \"/var/www/html\"",
      "<Directory \"/var/www/html\">",
      "    AllowOverride None",
      "    Require all granted",
      "</Directory>"
    ].join("\n");
    base["/var/www/html/index.html"] = [
      "<!doctype html>",
      "<html>",
      "<head><title>Apache HTTP Server Test Page</title></head>",
      "<body><h1>Apache HTTP Server Test Page</h1></body>",
      "</html>"
    ].join("\n");
    base["/usr/lib/systemd/system/httpd.service"] = [
      "[Unit]",
      "Description=The Apache HTTP Server",
      "After=network.target remote-fs.target nss-lookup.target",
      "",
      "[Service]",
      "Type=notify",
      "ExecStart=/usr/sbin/httpd $OPTIONS -DFOREGROUND",
      "ExecReload=/usr/sbin/httpd $OPTIONS -k graceful",
      "",
      "[Install]",
      "WantedBy=multi-user.target"
    ].join("\n");
  }

  if (state.config.packages.nginx.installed) {
    base["/etc/nginx/nginx.conf"] = [
      "worker_processes auto;",
      "events { worker_connections 1024; }",
      "http {",
      "    server {",
      "        listen 80;",
      "        server_name localhost;",
      "    }",
      "}"
    ].join("\n");
    base["/usr/lib/systemd/system/nginx.service"] = [
      "[Unit]",
      "Description=The nginx HTTP and reverse proxy server",
      "After=network-online.target",
      "",
      "[Service]",
      "Type=forking",
      "ExecStart=/usr/sbin/nginx",
      "",
      "[Install]",
      "WantedBy=multi-user.target"
    ].join("\n");
  }

  state.files = { ...base, ...(state.files || {}) };
}

function ensureDefaults(state) {
  state.config ||= {};
  state.config.packages ||= {};
  state.config.services ||= {};
  state.runtime ||= {};
  state.runtime.services ||= {};
  state.runtime.nextPid ||= 2000;
  state.runtime.logIndex ||= 0;
  state.runtime.cacheFresh = Boolean(state.runtime.cacheFresh);
  state.runtime.network ||= {
    interface: "enp0s3",
    address: "192.168.56.20/24",
    gateway: "192.168.56.1",
    dns: "192.168.56.1"
  };
  for (const serviceName of ["httpd", "nginx"]) {
    state.runtime.services[serviceName] ||= {
      activeState: "inactive",
      subState: "dead",
      result: "success",
      pid: null,
      ports: [],
      lastError: ""
    };
  }
}

function addLog(state, unit, message, priority = "info") {
  const index = state.runtime.logIndex++;
  const minute = 24 + Math.floor(index / 4);
  const second = String((index * 7) % 60).padStart(2, "0");
  state.logs.push({
    time: `Jul 04 10:${String(minute).padStart(2, "0")}:${second}`,
    unit,
    priority,
    message
  });
}

function addObservation(state, id) {
  if (!state.observations.includes(id)) state.observations.push(id);
}

function addSuccess(state, id) {
  if (!state.successes.includes(id)) state.successes.push(id);
}

function addFailure(state, id) {
  if (!state.failures.includes(id)) state.failures.push(id);
}

function normalizeUnit(unit) {
  if (!unit) return "";
  return unit.replace(/\.service$/, "");
}

function findJournalUnit(tokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "-u" && tokens[index + 1]) return tokens[index + 1];
    if (token.startsWith("-u=")) return token.slice(3);
    if (token === "-xeu" && tokens[index + 1]) return tokens[index + 1];
  }
  return "";
}

function findJournalLimit(tokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index] === "-n" && /^\d+$/.test(tokens[index + 1] || "")) {
      return Number(tokens[index + 1]);
    }
  }
  return null;
}

function journalPid(state, unit) {
  return state.runtime.services[unit]?.pid || (unit === "httpd" ? 1443 : 1722);
}

function tokenize(input) {
  const tokens = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) return { error: "unexpected EOF while looking for matching quote" };
  if (current) tokens.push(current);
  return tokens;
}

function parseCommandContext(tokens) {
  if (tokens[0] !== "sudo") {
    return { sudo: false, tokens };
  }
  return { sudo: true, tokens: tokens.slice(1) };
}

function normalizeTokens(tokens) {
  return tokens.map((token) => token.trim()).filter(Boolean).join(" ");
}

function sudoRequiredMessage(command) {
  return [
    `権限がありません。${command} はroot権限が必要です。`,
    `sudo ${command} のように sudo を付けて実行してください。`
  ].join("\n");
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "http://localhost/";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function parseVirtualUrl(value) {
  try {
    const url = new URL(value);
    return { ok: true, host: url.hostname, path: url.pathname, protocol: url.protocol };
  } catch {
    return { ok: false };
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function helpText() {
  return [
    "このラボで使える主なコマンド:",
    "  sudo dnf makecache",
    "  dnf info httpd",
    "  sudo dnf install -y httpd",
    "  dnf list installed httpd",
    "  rpm -q httpd",
    "  systemctl status|is-active|is-enabled httpd",
    "  sudo systemctl start|stop|restart|enable|disable httpd",
    "  journalctl -u httpd -n 20",
    "  ss -lntp",
    "  curl http://localhost/",
    "  ip addr / ip route",
    "  ping -c 2 192.168.56.1",
    "  dig localhost / nslookup localhost",
    "  cat /usr/lib/systemd/system/httpd.service",
    "  clear / reset"
  ].join("\n");
}
