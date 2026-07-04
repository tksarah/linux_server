export const scenarios = [
  {
    id: "install-httpd",
    title: "Apacheをdnfで導入する",
    level: "初級",
    duration: "15分",
    description:
      "Rocky/AlmaLinux 9 相当の仮想サーバーで、dnfのメタデータ更新、パッケージ情報確認、httpdのインストールを練習します。",
    start: {
      config: {
        packages: {
          httpd: {
            installed: false,
            version: "2.4.57-8.el9",
            repo: "appstream",
            summary: "Apache HTTP Server"
          },
          nginx: {
            installed: false,
            version: "1.20.1-16.el9",
            repo: "appstream",
            summary: "A high performance web server"
          }
        },
        services: {
          httpd: { unitExists: false, enabled: false, ports: [80], description: "The Apache HTTP Server" },
          nginx: { unitExists: false, enabled: false, ports: [80], description: "The nginx HTTP and reverse proxy server" }
        },
        repos: {
          baseos: { enabled: true, name: "Rocky Linux 9 - BaseOS" },
          appstream: { enabled: true, name: "Rocky Linux 9 - AppStream" }
        }
      },
      runtime: {
        cacheFresh: false,
        hostname: "web01.lab.local",
        network: {
          interface: "enp0s3",
          address: "192.168.56.20/24",
          gateway: "192.168.56.1",
          dns: "192.168.56.1"
        },
        services: {
          httpd: { activeState: "inactive", subState: "dead", result: "success", pid: null, ports: [], lastError: "" },
          nginx: { activeState: "inactive", subState: "dead", result: "success", pid: null, ports: [], lastError: "" }
        },
        nextPid: 1840,
        logIndex: 0
      },
      files: {},
      logs: []
    },
    guide: {
      summary: "リポジトリの情報を更新し、Apacheパッケージを確認してからインストールします。",
      steps: [
        {
          id: "metadata",
          phase: "準備",
          purpose: "dnfが利用するパッケージ情報を更新します。",
          commands: ["sudo dnf makecache"],
          expected: "metadata cache created と表示されます。",
          doneWhen: { type: "success", id: "dnf:makecache" }
        },
        {
          id: "inspect-package",
          phase: "確認",
          purpose: "httpdパッケージの概要とバージョンを確認します。",
          commands: ["dnf info httpd"],
          expected: "Apache HTTP Server と AppStream の情報が見えます。",
          doneWhen: { type: "observation", id: "dnf:info:httpd" }
        },
        {
          id: "install",
          phase: "導入",
          purpose: "Apache本体とsystemd unitをインストールします。",
          commands: ["sudo dnf install -y httpd", "dnf list installed httpd"],
          expected: "httpdがinstalledになり、httpd.serviceが利用可能になります。",
          doneWhen: {
            all: [
              { type: "success", id: "dnf:install:httpd" },
              { type: "packageInstalled", name: "httpd" }
            ]
          }
        }
      ]
    },
    goals: [
      { id: "cache", text: "dnfのパッケージ情報を更新した", check: { type: "success", id: "dnf:makecache" } },
      { id: "info", text: "httpdパッケージの情報を確認した", check: { type: "observation", id: "dnf:info:httpd" } },
      { id: "installed", text: "httpdをインストールした", check: { type: "packageInstalled", name: "httpd" } }
    ],
    commandTips: ["sudo dnf makecache", "dnf info httpd", "sudo dnf install -y httpd", "dnf list installed httpd", "systemctl status httpd"]
  },
  {
    id: "start-httpd",
    title: "systemctlでWebサーバーを起動する",
    level: "初級",
    duration: "20分",
    description:
      "インストール済みのhttpdをsystemctlで起動し、自動起動を有効化します。CLIのcurlと仮想ブラウザの両方でWeb表示を確認します。",
    start: {
      config: {
        packages: {
          httpd: {
            installed: true,
            version: "2.4.57-8.el9",
            repo: "appstream",
            summary: "Apache HTTP Server"
          },
          nginx: {
            installed: false,
            version: "1.20.1-16.el9",
            repo: "appstream",
            summary: "A high performance web server"
          }
        },
        services: {
          httpd: { unitExists: true, enabled: false, ports: [80], description: "The Apache HTTP Server" },
          nginx: { unitExists: false, enabled: false, ports: [80], description: "The nginx HTTP and reverse proxy server" }
        },
        repos: {
          baseos: { enabled: true, name: "Rocky Linux 9 - BaseOS" },
          appstream: { enabled: true, name: "Rocky Linux 9 - AppStream" }
        }
      },
      runtime: {
        cacheFresh: true,
        hostname: "web01.lab.local",
        network: {
          interface: "enp0s3",
          address: "192.168.56.20/24",
          gateway: "192.168.56.1",
          dns: "192.168.56.1"
        },
        services: {
          httpd: { activeState: "inactive", subState: "dead", result: "success", pid: null, ports: [], lastError: "" },
          nginx: { activeState: "inactive", subState: "dead", result: "success", pid: null, ports: [], lastError: "" }
        },
        nextPid: 1900,
        logIndex: 0
      },
      files: {},
      logs: [
        { time: "Jul 04 10:10:03", unit: "httpd", priority: "info", message: "httpd package installed; service is inactive until started." }
      ]
    },
    guide: {
      summary: "サービス状態を観察し、起動、永続化、CLI確認、GUI風確認の順で進めます。",
      steps: [
        {
          id: "status-before",
          phase: "観察",
          purpose: "起動前のhttpd.serviceの状態を確認します。",
          commands: ["systemctl status httpd"],
          expected: "Loadedはloaded、Activeはinactiveです。",
          doneWhen: { type: "observation", id: "systemctl:status:httpd" }
        },
        {
          id: "inspect-unit",
          phase: "設定確認",
          purpose: "systemdが読み込むhttpd.serviceのunit fileを端末で確認します。",
          commands: ["cat /usr/lib/systemd/system/httpd.service"],
          expected: "ExecStartと[Install]を確認し、systemctlがどの定義を使うかを見ます。",
          doneWhen: { type: "observation", id: "cat:/usr/lib/systemd/system/httpd.service" }
        },
        {
          id: "start-service",
          phase: "起動",
          purpose: "httpdを現在の実行環境で起動します。",
          commands: ["sudo systemctl start httpd", "systemctl is-active httpd", "ss -lntp"],
          expected: "activeになり、0.0.0.0:80をhttpdがLISTENします。",
          doneWhen: {
            all: [
              { type: "serviceActive", name: "httpd" },
              { type: "portListening", port: 80, service: "httpd" }
            ]
          }
        },
        {
          id: "enable-service",
          phase: "永続化",
          purpose: "再起動後にもhttpdが起動するようにenableします。",
          commands: ["sudo systemctl enable httpd", "systemctl is-enabled httpd"],
          expected: "enabled と表示されます。",
          doneWhen: { type: "serviceEnabled", name: "httpd" }
        },
        {
          id: "curl-verify",
          phase: "CLI確認",
          purpose: "curlでWebサーバーの応答を確認します。",
          commands: ["curl http://localhost/"],
          expected: "ApacheのテストページHTMLが返ります。",
          doneWhen: { type: "success", id: "web:httpd:curl" }
        },
        {
          id: "browser-verify",
          phase: "GUI確認",
          purpose: "仮想ブラウザで一般的なWeb表示確認を体験します。",
          commands: [],
          browserUrl: "http://localhost/",
          expected: "仮想ブラウザにApacheテストページが表示されます。",
          doneWhen: { type: "success", id: "web:httpd:browser" }
        }
      ]
    },
    goals: [
      { id: "status", text: "systemctl statusで起動前の状態を確認した", check: { type: "observation", id: "systemctl:status:httpd" } },
      { id: "unit", text: "httpd.serviceのunit fileをcatで確認した", check: { type: "observation", id: "cat:/usr/lib/systemd/system/httpd.service" } },
      { id: "active", text: "httpdがactiveになりport 80で待ち受けた", check: { type: "portListening", port: 80, service: "httpd" } },
      { id: "enabled", text: "httpdの自動起動を有効化した", check: { type: "serviceEnabled", name: "httpd" } },
      { id: "curl", text: "curlでApacheの応答を確認した", check: { type: "success", id: "web:httpd:curl" } },
      { id: "browser", text: "仮想ブラウザでApacheページを確認した", check: { type: "success", id: "web:httpd:browser" } }
    ],
    commandTips: [
      "systemctl status httpd",
      "cat /usr/lib/systemd/system/httpd.service",
      "sudo systemctl start httpd",
      "sudo systemctl enable httpd",
      "systemctl is-active httpd",
      "ss -lntp",
      "curl http://localhost/"
    ]
  },
  {
    id: "troubleshoot-port",
    title: "Apacheが起動しない原因を調査して直す",
    level: "初級+",
    duration: "25分",
    description:
      "httpdがfailedになっています。systemctlとjournalctlで証拠を集め、port 80を使っている別サービスを止めてApacheを復旧します。",
    start: {
      config: {
        packages: {
          httpd: {
            installed: true,
            version: "2.4.57-8.el9",
            repo: "appstream",
            summary: "Apache HTTP Server"
          },
          nginx: {
            installed: true,
            version: "1.20.1-16.el9",
            repo: "appstream",
            summary: "A high performance web server"
          }
        },
        services: {
          httpd: { unitExists: true, enabled: false, ports: [80], description: "The Apache HTTP Server" },
          nginx: { unitExists: true, enabled: true, ports: [80], description: "The nginx HTTP and reverse proxy server" }
        },
        repos: {
          baseos: { enabled: true, name: "Rocky Linux 9 - BaseOS" },
          appstream: { enabled: true, name: "Rocky Linux 9 - AppStream" }
        }
      },
      runtime: {
        cacheFresh: true,
        hostname: "web01.lab.local",
        network: {
          interface: "enp0s3",
          address: "192.168.56.20/24",
          gateway: "192.168.56.1",
          dns: "192.168.56.1"
        },
        services: {
          httpd: {
            activeState: "failed",
            subState: "failed",
            result: "exit-code",
            pid: null,
            ports: [],
            lastError: "Address already in use: AH00072: make_sock: could not bind to address 0.0.0.0:80"
          },
          nginx: { activeState: "active", subState: "running", result: "success", pid: 1722, ports: [80], lastError: "" }
        },
        nextPid: 2100,
        logIndex: 4
      },
      files: {},
      logs: [
        { time: "Jul 04 10:22:01", unit: "nginx", priority: "info", message: "Started The nginx HTTP and reverse proxy server." },
        { time: "Jul 04 10:23:14", unit: "httpd", priority: "error", message: "(98)Address already in use: AH00072: make_sock: could not bind to address [::]:80" },
        { time: "Jul 04 10:23:14", unit: "httpd", priority: "error", message: "(98)Address already in use: AH00072: make_sock: could not bind to address 0.0.0.0:80" },
        { time: "Jul 04 10:23:14", unit: "httpd", priority: "error", message: "no listening sockets available, shutting down" },
        { time: "Jul 04 10:23:14", unit: "httpd", priority: "info", message: "httpd.service: Failed with result 'exit-code'." }
      ]
    },
    guide: {
      summary: "修正コマンドに飛びつかず、status、journal、listen socketの順で証拠を集めてから復旧します。",
      steps: [
        {
          id: "status-failed",
          phase: "状態確認",
          purpose: "systemdがhttpdをどう見ているか確認します。",
          commands: ["systemctl status httpd"],
          expected: "Active: failed と Address already in use の手がかりが見えます。",
          doneWhen: { type: "observation", id: "systemctl:status:httpd" }
        },
        {
          id: "journal-evidence",
          phase: "ログ調査",
          purpose: "journalctlでhttpd起動失敗の直接原因を読みます。",
          commands: ["journalctl -u httpd -n 20"],
          expected: "port 80へbindできないエラーが見えます。",
          doneWhen: { type: "observation", id: "journalctl:httpd" }
        },
        {
          id: "find-owner",
          phase: "競合確認",
          purpose: "どのプロセスがport 80を使っているか確認します。",
          commands: ["ss -lntp", "systemctl status nginx"],
          expected: "nginxが0.0.0.0:80をLISTENしています。",
          doneWhen: { type: "observation", id: "ss:lntp" }
        },
        {
          id: "repair",
          phase: "復旧",
          purpose: "競合しているnginxを止め、httpdを起動します。",
          commands: ["sudo systemctl stop nginx", "sudo systemctl disable nginx", "sudo systemctl start httpd"],
          expected: "nginxはinactive/disabled、httpdはactiveになります。",
          doneWhen: {
            all: [
              { type: "serviceInactive", name: "nginx" },
              { type: "serviceDisabled", name: "nginx" },
              { type: "serviceActive", name: "httpd" }
            ]
          }
        },
        {
          id: "verify-repair",
          phase: "確認",
          purpose: "CLIと仮想ブラウザで復旧を確認します。",
          commands: ["systemctl status httpd", "curl http://localhost/"],
          browserUrl: "http://localhost/",
          expected: "curlと仮想ブラウザの両方でApacheテストページが確認できます。",
          doneWhen: {
            all: [
              { type: "success", id: "web:httpd:curl" },
              { type: "success", id: "web:httpd:browser" }
            ]
          }
        }
      ]
    },
    goals: [
      { id: "status", text: "systemctl statusでfailed状態を確認した", check: { type: "observation", id: "systemctl:status:httpd" } },
      { id: "journal", text: "journalctlでhttpdのbind失敗を確認した", check: { type: "observation", id: "journalctl:httpd" } },
      { id: "ss", text: "ss -lntpでport 80の使用者を確認した", check: { type: "observation", id: "ss:lntp" } },
      {
        id: "fixed",
        text: "nginxを止めてhttpdを復旧した",
        check: {
          all: [
            { type: "serviceInactive", name: "nginx" },
            { type: "serviceActive", name: "httpd" },
            { type: "portListening", port: 80, service: "httpd" }
          ]
        }
      },
      { id: "verified", text: "curlと仮想ブラウザで復旧を確認した", check: { all: [{ type: "success", id: "web:httpd:curl" }, { type: "success", id: "web:httpd:browser" }] } }
    ],
    commandTips: [
      "systemctl status httpd",
      "journalctl -u httpd -n 20",
      "ss -lntp",
      "systemctl status nginx",
      "sudo systemctl stop nginx",
      "sudo systemctl disable nginx",
      "sudo systemctl start httpd",
      "curl http://localhost/"
    ]
  }
];

export function getScenario(id) {
  return scenarios.find((scenario) => scenario.id === id) || scenarios[0];
}
