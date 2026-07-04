import test from "node:test";
import assert from "node:assert/strict";
import { createState, evaluateCheck, getDerivedViews, loadVirtualBrowser, runCommand } from "../js/engine.js";
import { getScenario, scenarios } from "../js/scenarios.js";

test("dnf exercise installs httpd after metadata and package inspection", () => {
  const state = createState("install-httpd");

  runCommand(state, "sudo dnf makecache");
  runCommand(state, "dnf info httpd");
  runCommand(state, "sudo dnf install -y httpd");

  assert.equal(state.config.packages.httpd.installed, true);
  assert.equal(state.config.services.httpd.unitExists, true);
  assert.ok(state.successes.includes("dnf:makecache"));
  assert.ok(state.observations.includes("dnf:info:httpd"));

  const goals = getDerivedViews(state).goals;
  assert.equal(goals.every((goal) => goal.done), true);
});

test("systemctl exercise verifies httpd with curl and the virtual browser", () => {
  const state = createState("start-httpd");

  let browser = loadVirtualBrowser(state, "http://localhost/");
  assert.equal(browser.ok, false);
  assert.equal(browser.status, "ERR_CONNECTION_REFUSED");

  runCommand(state, "systemctl status httpd");
  const unit = runCommand(state, "cat /usr/lib/systemd/system/httpd.service");
  runCommand(state, "sudo systemctl start httpd");
  runCommand(state, "sudo systemctl enable httpd");
  const curl = runCommand(state, "curl http://localhost/");
  browser = loadVirtualBrowser(state, "http://localhost/");

  assert.match(unit.output, /ExecStart=\/usr\/sbin\/httpd/);
  assert.ok(state.observations.includes("cat:/usr/lib/systemd/system/httpd.service"));
  assert.match(curl.output, /Apache HTTP Server Test Page/);
  assert.equal(browser.ok, true);
  assert.equal(browser.status, "200 OK");
  assert.equal(browser.title, "Apache HTTP Server Welcome Page");
  assert.equal(browser.serviceState, "active");
  assert.equal(evaluateCheck(state, { type: "portListening", port: 80, service: "httpd" }), true);

  const goals = getDerivedViews(state).goals;
  assert.equal(goals.every((goal) => goal.done), true);
});

test("troubleshooting exercise requires evidence before repair completion", () => {
  const state = createState("troubleshoot-port");

  runCommand(state, "systemctl statusbad httpd");
  runCommand(state, "journalctl -u nginx -n 20");
  assert.equal(state.observations.includes("systemctl:status:httpd"), false);
  assert.equal(state.observations.includes("journalctl:httpd"), false);

  runCommand(state, "systemctl status httpd");
  runCommand(state, "journalctl -u httpd -n 20");
  runCommand(state, "ss -lntp");
  runCommand(state, "sudo systemctl stop nginx");
  runCommand(state, "sudo systemctl disable nginx");
  runCommand(state, "sudo systemctl start httpd");
  runCommand(state, "curl http://localhost/");
  loadVirtualBrowser(state, "http://localhost/");

  assert.equal(state.runtime.services.nginx.activeState, "inactive");
  assert.equal(state.config.services.nginx.enabled, false);
  assert.equal(state.runtime.services.httpd.activeState, "active");
  assert.ok(state.observations.includes("systemctl:status:httpd"));
  assert.ok(state.observations.includes("journalctl:httpd"));
  assert.ok(state.observations.includes("ss:lntp"));

  const goals = getDerivedViews(state).goals;
  assert.equal(goals.every((goal) => goal.done), true);
});

test("guide commands complete their steps, including browser actions", () => {
  for (const scenario of scenarios) {
    const state = createState(scenario.id);
    const steps = getScenario(scenario.id).guide.steps;

    for (const step of steps) {
      for (const command of step.commands) {
        runCommand(state, command);
      }
      if (step.browserUrl) {
        loadVirtualBrowser(state, step.browserUrl);
      }
      assert.equal(
        evaluateCheck(state, step.doneWhen),
        true,
        `${scenario.id} should complete step ${step.id}`
      );
    }
  }
});

test("virtual files and generated command output stay aligned with installed packages", () => {
  const state = createState("install-httpd");
  assert.equal(state.files["/etc/httpd/conf/httpd.conf"], undefined);

  runCommand(state, "sudo dnf install -y httpd");
  assert.match(state.files["/etc/httpd/conf/httpd.conf"], /Listen 80/);
  assert.match(runCommand(state, "cat /etc/httpd/conf/httpd.conf").output, /DocumentRoot/);
});

test("root operations require sudo and do not mutate state without it", () => {
  const installState = createState("install-httpd");

  const makecacheDenied = runCommand(installState, "dnf makecache");
  assert.match(makecacheDenied.output, /sudo dnf makecache/);
  assert.equal(installState.runtime.cacheFresh, false);
  assert.ok(installState.failures.includes("sudo:required:dnf:makecache"));

  runCommand(installState, "sudo dnf makecache");
  assert.equal(installState.runtime.cacheFresh, true);

  const installDenied = runCommand(installState, "dnf install -y httpd");
  assert.match(installDenied.output, /sudo dnf install/);
  assert.equal(installState.config.packages.httpd.installed, false);
  assert.ok(installState.failures.includes("sudo:required:dnf:install"));

  runCommand(installState, "sudo dnf install -y httpd");
  assert.equal(installState.config.packages.httpd.installed, true);

  const serviceState = createState("start-httpd");
  const startDenied = runCommand(serviceState, "systemctl start httpd");
  assert.match(startDenied.output, /sudo systemctl start/);
  assert.equal(serviceState.runtime.services.httpd.activeState, "inactive");
  assert.ok(serviceState.failures.includes("sudo:required:systemctl:start:httpd"));

  runCommand(serviceState, "sudo systemctl start httpd");
  assert.equal(serviceState.runtime.services.httpd.activeState, "active");

  const enableDenied = runCommand(serviceState, "systemctl enable httpd");
  assert.match(enableDenied.output, /sudo systemctl enable/);
  assert.equal(serviceState.config.services.httpd.enabled, false);

  runCommand(serviceState, "sudo systemctl enable httpd");
  assert.equal(serviceState.config.services.httpd.enabled, true);
});
