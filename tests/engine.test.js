import test from "node:test";
import assert from "node:assert/strict";
import { createState, evaluateCheck, getDerivedViews, loadVirtualBrowser, runCommand } from "../js/engine.js";
import { getScenario, scenarios } from "../js/scenarios.js";

test("dnf check-update reports candidates without installing them and exposes exit code 100", () => {
  const state = createState("install-httpd");
  const before = { ...state.config.packages.bash };

  const check = runCommand(state, "dnf check-update");

  assert.equal(check.exitCode, 100);
  assert.match(check.output, /bash\.x86_64/);
  assert.match(check.output, /5\.1\.8-9\.el9/);
  assert.deepEqual(state.config.packages.bash, before);
  assert.equal(state.shell.lastExitCode, 100);
  assert.ok(state.observations.includes("dnf:check-update:updates-available"));

  const status = runCommand(state, "echo $?");
  assert.equal(status.output, "100");
  assert.equal(status.exitCode, 0);
  assert.equal(state.shell.lastExitCode, 0);
  assert.ok(state.observations.includes("shell:exit-status:100"));
});

test("dnf check-update returns 0 with no candidates and 1 on repository failure", () => {
  const noUpdates = createState("install-httpd");
  noUpdates.config.packages.bash.installedRelease = noUpdates.config.packages.bash.release;
  const clean = runCommand(noUpdates, "dnf check-update");
  assert.equal(clean.exitCode, 0);
  assert.ok(noUpdates.observations.includes("dnf:check-update:no-updates"));

  const repoFailure = createState("install-httpd");
  repoFailure.runtime.dnfMetadata.reposReachable = false;
  const failed = runCommand(repoFailure, "dnf check-update");
  assert.equal(failed.exitCode, 1);
  assert.match(failed.output, /Failed to download metadata/);
});

test("httpd can be installed without makecache but is not verified until RPMDB is inspected", () => {
  const state = createState("install-httpd");

  runCommand(state, "dnf repolist");
  runCommand(state, "dnf check-update");
  runCommand(state, "echo $?");
  runCommand(state, "dnf info httpd");
  const install = runCommand(state, "sudo dnf install -y httpd");

  assert.equal(install.exitCode, 0);
  assert.equal(state.config.packages.httpd.installed, true);
  assert.equal(state.config.packages.httpd.installedVersion, "2.4.57");
  assert.equal(state.config.services.httpd.unitExists, true);
  assert.equal(state.commands.some((command) => command.normalized.includes("makecache")), false);
  assert.equal(getDerivedViews(state).goals.find((goal) => goal.id === "verified").done, false);

  const verify = runCommand(state, "rpm -q httpd");
  assert.match(verify.output, /^httpd-2\.4\.57-8\.el9\.x86_64$/);
  assert.equal(getDerivedViews(state).goals.every((goal) => goal.done), true);
});

test("makecache remains an accurate optional command and does not require sudo or change packages", () => {
  const state = createState("install-httpd");
  const packagesBefore = JSON.stringify(state.config.packages);

  const first = runCommand(state, "dnf makecache");
  const second = runCommand(state, "dnf makecache");

  assert.equal(first.exitCode, 0);
  assert.match(first.output, /Metadata cache created/);
  assert.match(second.output, /Last metadata expiration check/);
  assert.ok(state.observations.includes("dnf:makecache:downloaded"));
  assert.ok(state.observations.includes("dnf:makecache:reused"));
  assert.equal(JSON.stringify(state.config.packages), packagesBefore);
});

test("systemctl start and enable remain separate and require explicit verification", () => {
  const state = createState("start-httpd");

  runCommand(state, "sudo systemctl start httpd");
  assert.equal(state.runtime.services.httpd.activeState, "active");
  assert.equal(state.config.services.httpd.enabled, false);
  assert.equal(getDerivedViews(state).goals.find((goal) => goal.id === "active").done, false);

  runCommand(state, "systemctl is-active httpd");
  runCommand(state, "ss -lnt");
  assert.equal(getDerivedViews(state).goals.find((goal) => goal.id === "active").done, true);

  runCommand(state, "sudo systemctl enable httpd");
  assert.equal(state.config.services.httpd.enabled, true);
  assert.equal(getDerivedViews(state).goals.find((goal) => goal.id === "enabled").done, false);

  runCommand(state, "systemctl is-enabled httpd");
  assert.equal(getDerivedViews(state).goals.find((goal) => goal.id === "enabled").done, true);
});

test("httpd install leaves DocumentRoot empty and serves the virtual welcome page", () => {
  const state = createState("install-httpd");
  runCommand(state, "sudo dnf install -y httpd");

  assert.equal(state.files["/var/www/html/index.html"], undefined);
  assert.match(state.files["/etc/httpd/conf.d/welcome.conf"], /\.noindex\.html/);

  const running = createState("start-httpd");
  runCommand(running, "sudo systemctl start httpd");
  const curl = runCommand(running, "curl http://localhost/");
  const browser = loadVirtualBrowser(running, "http://localhost/");
  assert.match(curl.output, /Apache HTTP Server Test Page/);
  assert.equal(browser.kind, "httpd");
  assert.equal(browser.title, "Apache HTTP Server テストページ");
});

test("HTTP response follows the service that owns port 80", () => {
  const state = createState("troubleshoot-port");

  const nginxCurl = runCommand(state, "curl http://localhost/");
  const nginxBrowser = loadVirtualBrowser(state, "http://localhost/");
  assert.match(nginxCurl.output, /Welcome to nginx/);
  assert.equal(nginxBrowser.kind, "nginx");
  assert.ok(state.successes.includes("web:nginx:curl"));
  assert.equal(state.successes.includes("web:httpd:curl"), false);

  runCommand(state, "sudo systemctl stop nginx");
  runCommand(state, "sudo systemctl start httpd");
  const apacheCurl = runCommand(state, "curl http://localhost/");
  const apacheBrowser = loadVirtualBrowser(state, "http://localhost/");
  assert.match(apacheCurl.output, /Apache HTTP Server Test Page/);
  assert.equal(apacheBrowser.kind, "httpd");
});

test("diagnostic goals only complete when failed state and nginx ownership are observed before repair", () => {
  const state = createState("troubleshoot-port");

  runCommand(state, "sudo systemctl stop nginx");
  runCommand(state, "sudo systemctl start httpd");
  runCommand(state, "systemctl status httpd");
  runCommand(state, "sudo ss -lntp");

  assert.equal(state.observations.includes("systemctl:status:httpd:failed"), false);
  assert.equal(state.observations.includes("ss:port:80:nginx"), false);
  assert.equal(getDerivedViews(state).goals.find((goal) => goal.id === "status").done, false);
  assert.equal(getDerivedViews(state).goals.find((goal) => goal.id === "owner").done, false);
});

test("troubleshooting happy path records evidence, boot policy, and final verification", () => {
  const state = createState("troubleshoot-port");

  runCommand(state, "systemctl status httpd");
  runCommand(state, "journalctl -u httpd -n 20");
  runCommand(state, "ss -lnt");
  runCommand(state, "sudo ss -lntp");
  runCommand(state, "systemctl status nginx");
  runCommand(state, "sudo systemctl stop nginx");
  runCommand(state, "sudo systemctl start httpd");
  runCommand(state, "sudo systemctl disable nginx");
  runCommand(state, "sudo systemctl enable httpd");
  runCommand(state, "systemctl is-enabled nginx");
  runCommand(state, "systemctl is-enabled httpd");
  runCommand(state, "systemctl is-active httpd");
  runCommand(state, "sudo ss -lntp");
  runCommand(state, "curl http://localhost/");
  loadVirtualBrowser(state, "http://localhost/");

  assert.equal(state.runtime.services.nginx.activeState, "inactive");
  assert.equal(state.config.services.nginx.enabled, false);
  assert.equal(state.runtime.services.httpd.activeState, "active");
  assert.equal(state.config.services.httpd.enabled, true);
  assert.equal(getDerivedViews(state).goals.every((goal) => goal.done), true);
});

test("guide commands complete every required step, including browser actions", () => {
  for (const scenario of scenarios) {
    const state = createState(scenario.id);
    const steps = getScenario(scenario.id).guide.steps;

    for (const step of steps) {
      for (const command of step.commands) runCommand(state, command);
      if (step.browserUrl) loadVirtualBrowser(state, step.browserUrl);
      if (step.optional) continue;
      assert.equal(
        evaluateCheck(state, step.doneWhen),
        true,
        `${scenario.id} should complete step ${step.id}`
      );
    }
    assert.equal(getDerivedViews(state).goals.every((goal) => goal.done), true, `${scenario.id} goals`);
  }
});

test("privileged changes require sudo and do not mutate state when denied", () => {
  const installState = createState("install-httpd");
  const installDenied = runCommand(installState, "dnf install -y httpd");
  assert.equal(installDenied.exitCode, 1);
  assert.match(installDenied.output, /sudo dnf install/);
  assert.equal(installState.config.packages.httpd.installed, false);

  const serviceState = createState("start-httpd");
  const startDenied = runCommand(serviceState, "systemctl start httpd");
  assert.match(startDenied.output, /sudo systemctl start/);
  assert.equal(serviceState.runtime.services.httpd.activeState, "inactive");

  runCommand(serviceState, "sudo systemctl start httpd");
  const enableDenied = runCommand(serviceState, "systemctl enable httpd");
  assert.match(enableDenied.output, /sudo systemctl enable/);
  assert.equal(serviceState.config.services.httpd.enabled, false);
});
