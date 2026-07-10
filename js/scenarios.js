const commonPackages = () => ({
  bash: {
    installed: true,
    installedVersion: "5.1.8",
    installedRelease: "6.el9",
    availableVersion: "5.1.8",
    release: "9.el9",
    arch: "x86_64",
    repo: "baseos",
    summary: "The GNU Bourne Again shell"
  },
  httpd: {
    installed: false,
    installedVersion: null,
    installedRelease: null,
    availableVersion: "2.4.57",
    release: "8.el9",
    arch: "x86_64",
    repo: "appstream",
    summary: "Apache HTTP Server"
  },
  nginx: {
    installed: false,
    installedVersion: null,
    installedRelease: null,
    availableVersion: "1.20.1",
    release: "16.el9",
    arch: "x86_64",
    repo: "appstream",
    summary: "A high performance web server"
  }
});

const commonRepos = () => ({
  baseos: { enabled: true, name: "EL9 Lab - BaseOS" },
  appstream: { enabled: true, name: "EL9 Lab - AppStream" }
});

function packagesWith(...installedNames) {
  const packages = commonPackages();
  for (const name of installedNames) {
    const pkg = packages[name];
    if (!pkg) continue;
    pkg.installed = true;
    pkg.installedVersion = pkg.availableVersion;
    pkg.installedRelease = pkg.release;
  }
  return packages;
}

const commonRuntime = (services, nextPid, logIndex = 0) => ({
  dnfMetadata: { status: "expired", lastCheck: "", syncCount: 0, reposReachable: true },
  hostname: "web01.lab.local",
  network: {
    interface: "enp0s3",
    address: "192.168.56.20/24",
    gateway: "192.168.56.1",
    dns: "192.168.56.1"
  },
  services,
  nextPid,
  logIndex
});

export const scenarios = [
  {
    id: "install-httpd",
    title: "DNFで更新候補を確認しApacheを導入する",
    level: "初級",
    duration: "20分",
    description:
      "EL9系の共通操作を再現した仮想環境で、更新候補の確認、終了コード、パッケージ情報確認、httpdのインストールと検証を練習します。",
    start: {
      config: {
        packages: commonPackages(),
        services: {
          httpd: { unitExists: false, enabled: false, ports: [80], description: "The Apache HTTP Server" },
          nginx: { unitExists: false, enabled: false, ports: [80], description: "The nginx HTTP and reverse proxy server" }
        },
        repos: commonRepos()
      },
      runtime: commonRuntime({
        httpd: { activeState: "inactive", subState: "dead", result: "success", pid: null, ports: [], lastError: "" },
        nginx: { activeState: "inactive", subState: "dead", result: "success", pid: null, ports: [], lastError: "" }
      }, 1840),
      files: {},
      logs: []
    },
    guide: {
      summary: "リポジトリと更新候補を観察し、終了コードを読み、Apacheを導入してRPMDBで確認します。",
      steps: [
        {
          id: "repolist",
          phase: "リポジトリ確認",
          purpose: "利用可能なパッケージの取得元を確認します。",
          prompt: "現在有効なリポジトリはどれでしょうか。",
          hints: ["DNFには、有効なリポジトリだけを一覧表示するサブコマンドがあります。"],
          commands: ["dnf repolist"],
          expected: "baseos と appstream が enabled のリポジトリとして表示されます。",
          explanation: "BaseOSはOSの基盤、AppStreamはアプリケーションや実行環境を主に提供します。",
          doneWhen: { type: "observation", id: "dnf:repolist" }
        },
        {
          id: "check-updates",
          phase: "更新確認",
          purpose: "インストール済みパッケージに更新候補があるか確認します。",
          prompt: "パッケージを変更せず、利用可能な更新だけを調べるには何を実行しますか。",
          hints: ["check-updateは非対話で更新候補を確認し、更新そのものは適用しません。"],
          commands: ["dnf check-update"],
          expected: "bashの更新候補が表示されますが、インストール済みバージョンは変わりません。",
          explanation: "check-updateは候補を表示しただけです。更新候補があるため、このコマンドの終了コードは100です。",
          doneWhen: { type: "observation", id: "dnf:check-update:updates-available" }
        },
        {
          id: "check-exit-status",
          phase: "終了コード",
          purpose: "直前のDNFコマンドが返した終了コードを確認します。",
          prompt: "シェルで直前のコマンドの終了コードを表示する特殊変数は何でしょうか。",
          hints: ["シェルは直前の終了コードを $? に保持します。echoで値を表示できます。"],
          commands: ["echo $?"],
          expected: "100 と表示されます。",
          explanation: "一般には0が成功ですが、dnf check-updateの100は「更新候補あり」を表す正常な結果です。1はエラーです。",
          doneWhen: { type: "observation", id: "shell:exit-status:100" }
        },
        {
          id: "inspect-package",
          phase: "パッケージ確認",
          purpose: "httpdの概要、バージョン、提供リポジトリを確認します。",
          prompt: "未インストールのhttpdについて、説明と提供元を調べてください。",
          hints: ["DNFのinfoサブコマンドは、インストール済み・利用可能なパッケージの詳細を表示します。"],
          commands: ["dnf info httpd"],
          expected: "Apache HTTP Server、Version、Release、AppStreamの情報が表示されます。",
          explanation: "VersionとReleaseを分けて読むと、ソフトウェア本体の版とディストリビューション側のビルドを区別できます。",
          doneWhen: { type: "observation", id: "dnf:info:httpd" }
        },
        {
          id: "install",
          phase: "導入",
          purpose: "httpdパッケージとsystemd unitをインストールします。",
          prompt: "パッケージデータベースを変更するために必要な権限を付けてhttpdを導入してください。",
          hints: ["installはシステムを変更するためsudoが必要です。-yは確認へ自動的にyesと答えます。"],
          commands: ["sudo dnf install -y httpd"],
          expected: "トランザクションが完了し、httpd.serviceが利用可能になります。",
          explanation: "インストールは完了しましたが、サービスはまだ起動も自動起動設定もされていません。",
          doneWhen: {
            all: [
              { type: "success", id: "dnf:install:httpd" },
              { type: "packageInstalled", name: "httpd" }
            ]
          }
        },
        {
          id: "verify-install",
          phase: "導入確認",
          purpose: "RPMDBを参照してhttpdが導入済みであることを確認します。",
          prompt: "操作の成功表示だけでなく、現在のパッケージ状態を別のコマンドで検証してください。",
          hints: ["dnf list installed または rpm -q で、RPMDBに登録されたパッケージを確認できます。"],
          commands: ["dnf list installed httpd", "rpm -q httpd"],
          expected: "httpdのインストール済みバージョンが表示されます。",
          explanation: "変更操作の後に状態を再確認することで、期待した結果になったことを証拠として残せます。",
          doneWhen: {
            any: [
              { type: "observation", id: "dnf:list:installed:httpd" },
              { type: "observation", id: "rpm:q:httpd:installed" }
            ]
          }
        }
      ]
    },
    goals: [
      { id: "repos", text: "有効なリポジトリを確認した", check: { type: "observation", id: "dnf:repolist" } },
      { id: "updates", text: "更新を適用せず更新候補を確認した", check: { type: "observation", id: "dnf:check-update:updates-available" } },
      { id: "exit", text: "終了コード100の意味を確認した", check: { type: "observation", id: "shell:exit-status:100" } },
      { id: "info", text: "httpdパッケージの情報を確認した", check: { type: "observation", id: "dnf:info:httpd" } },
      { id: "installed", text: "httpdをインストールした", check: { type: "packageInstalled", name: "httpd" } },
      {
        id: "verified",
        text: "RPMDBでhttpdの導入結果を検証した",
        check: {
          any: [
            { type: "observation", id: "dnf:list:installed:httpd" },
            { type: "observation", id: "rpm:q:httpd:installed" }
          ]
        }
      }
    ]
  },
  {
    id: "start-httpd",
    title: "systemctlでWebサーバーを起動する",
    level: "初級",
    duration: "20分",
    description:
      "インストール済みのhttpdについて、現在の起動状態と次回起動時の設定を区別し、CLIと仮想ブラウザで応答を確認します。",
    start: {
      config: {
        packages: packagesWith("httpd"),
        services: {
          httpd: { unitExists: true, enabled: false, ports: [80], description: "The Apache HTTP Server" },
          nginx: { unitExists: false, enabled: false, ports: [80], description: "The nginx HTTP and reverse proxy server" }
        },
        repos: commonRepos()
      },
      runtime: commonRuntime({
        httpd: { activeState: "inactive", subState: "dead", result: "success", pid: null, ports: [], lastError: "" },
        nginx: { activeState: "inactive", subState: "dead", result: "success", pid: null, ports: [], lastError: "" }
      }, 1900),
      files: {},
      logs: [
        { time: "Jul 04 10:10:03", unit: "httpd", priority: "info", message: "httpd package installed; service is inactive until started." }
      ]
    },
    guide: {
      summary: "unitと現在状態を観察し、起動、実行状態確認、自動起動設定、設定確認、HTTP確認の順で進めます。",
      steps: [
        {
          id: "status-before",
          phase: "状態確認",
          purpose: "起動前のhttpd.serviceの状態を確認します。",
          prompt: "unitが存在することと、現在動作していることは同じでしょうか。statusで確かめてください。",
          hints: ["Loadedはunitの読み込み状態、Activeは現在の実行状態を示します。"],
          commands: ["systemctl status httpd"],
          expected: "Loadedはloaded、Activeはinactiveです。",
          explanation: "httpdはインストール済みですが、現在は動いていません。",
          doneWhen: { type: "observation", id: "systemctl:status:httpd:inactive" }
        },
        {
          id: "inspect-unit",
          phase: "定義確認",
          purpose: "systemdが読み込むhttpd.serviceのunit fileを確認します。",
          prompt: "systemctlがhttpdをどのコマンドで起動するか、unit fileから探してください。",
          hints: ["EL9系のパッケージ提供unitは通常 /usr/lib/systemd/system 以下にあります。"],
          commands: ["cat /usr/lib/systemd/system/httpd.service"],
          expected: "ExecStartと[Install]セクションが見えます。",
          explanation: "ExecStartは起動コマンド、WantedByはenable時に関連付ける起動ターゲットを示します。",
          doneWhen: { type: "observation", id: "cat:/usr/lib/systemd/system/httpd.service" }
        },
        {
          id: "start-service",
          phase: "現在の起動",
          purpose: "httpdを現在の実行環境で起動します。",
          prompt: "再起動後の設定はまだ変えず、現在のhttpdだけを起動してください。",
          hints: ["systemctl startは現在のunitを起動しますが、自動起動設定は変更しません。"],
          commands: ["sudo systemctl start httpd"],
          expected: "成功時は通常何も表示されず、httpdがactiveになります。",
          explanation: "startは現在の実行状態を変更する操作です。enabledはまだfalseのままです。",
          doneWhen: { type: "serviceActive", name: "httpd" }
        },
        {
          id: "verify-running",
          phase: "実行確認",
          purpose: "httpdの実行状態とport 80の待ち受けを確認します。",
          prompt: "起動要求が成功したことを、service状態とsocketの両方から検証してください。",
          hints: ["is-activeは実行状態、ss -lntはLISTEN中のTCP socketを表示します。"],
          commands: ["systemctl is-active httpd", "ss -lnt"],
          expected: "active と 0.0.0.0:80 のLISTENが確認できます。",
          explanation: "systemdの状態と実際の待ち受けを組み合わせて確認すると、より確実です。",
          doneWhen: {
            all: [
              { type: "observation", id: "systemctl:is-active:httpd:active" },
              { type: "observation", id: "ss:port:80:listening" }
            ]
          }
        },
        {
          id: "enable-service",
          phase: "次回起動設定",
          purpose: "再起動後にもhttpdが起動するようにenableします。",
          prompt: "現在のサービスを止めず、次回のOS起動時に自動起動する設定を追加してください。",
          hints: ["systemctl enableは起動時の依存関係を設定します。現在の起動はstartの役割です。"],
          commands: ["sudo systemctl enable httpd"],
          expected: "multi-user.target.wantsへのsymlink作成が表示されます。",
          explanation: "enableは次回起動時の設定です。現在のhttpdはstart済みなので、そのままactiveです。",
          doneWhen: { type: "serviceEnabled", name: "httpd" }
        },
        {
          id: "verify-enabled",
          phase: "設定確認",
          purpose: "自動起動設定を確認します。",
          prompt: "設定操作の出力だけに頼らず、現在のenable状態を問い合わせてください。",
          hints: ["is-enabledは起動中かどうかではなく、起動時設定を確認します。"],
          commands: ["systemctl is-enabled httpd"],
          expected: "enabled と表示されます。",
          explanation: "is-activeとis-enabledは別の質問です。active/disabledやinactive/enabledもあり得ます。",
          doneWhen: { type: "observation", id: "systemctl:is-enabled:httpd:enabled" }
        },
        {
          id: "curl-verify",
          phase: "HTTP確認",
          purpose: "localhostへのHTTP応答をCLIで確認します。",
          prompt: "WebサーバーがHTTPリクエストへ応答することを確認してください。",
          hints: ["curlにURLを渡すと、HTTPレスポンスの本文を端末で確認できます。"],
          commands: ["curl http://localhost/"],
          expected: "ApacheのテストページHTMLが返ります。",
          explanation: "この応答は空のDocumentRootに対する仮想welcome設定から返されています。",
          doneWhen: { type: "success", id: "web:httpd:curl" }
        },
        {
          id: "browser-verify",
          phase: "表示確認",
          purpose: "同じ仮想環境からlocalhostをブラウザ形式で確認します。",
          prompt: "端末以外のクライアント表示でも同じApache応答になるか確認してください。",
          hints: ["仮想ブラウザの操作ボタンを使うと、同じ仮想HTTP応答を表示できます。"],
          commands: [],
          browserUrl: "http://localhost/",
          expected: "仮想ブラウザにApacheテストページが表示されます。",
          explanation: "curlと仮想ブラウザは同じlistenerとHTTP応答を参照しています。",
          doneWhen: { type: "success", id: "web:httpd:browser" }
        }
      ]
    },
    goals: [
      { id: "status", text: "inactive状態を確認した", check: { type: "observation", id: "systemctl:status:httpd:inactive" } },
      { id: "unit", text: "httpd.serviceの定義を確認した", check: { type: "observation", id: "cat:/usr/lib/systemd/system/httpd.service" } },
      { id: "active", text: "activeとport 80の待ち受けを検証した", check: { all: [{ type: "observation", id: "systemctl:is-active:httpd:active" }, { type: "observation", id: "ss:port:80:listening" }] } },
      { id: "enabled", text: "自動起動設定を検証した", check: { type: "observation", id: "systemctl:is-enabled:httpd:enabled" } },
      { id: "curl", text: "curlでApacheの応答を確認した", check: { type: "success", id: "web:httpd:curl" } },
      { id: "browser", text: "仮想ブラウザでApacheページを確認した", check: { type: "success", id: "web:httpd:browser" } }
    ]
  },
  {
    id: "troubleshoot-port",
    title: "Apacheが起動しない原因を調査して直す",
    level: "初級+",
    duration: "30分",
    description:
      "httpdがfailedになっています。状態、journal、socketから証拠を集め、port 80の競合を現在状態と次回起動設定の両方で解消します。",
    start: {
      config: {
        packages: packagesWith("httpd", "nginx"),
        services: {
          httpd: { unitExists: true, enabled: false, ports: [80], description: "The Apache HTTP Server" },
          nginx: { unitExists: true, enabled: true, ports: [80], description: "The nginx HTTP and reverse proxy server" }
        },
        repos: commonRepos()
      },
      runtime: commonRuntime({
        httpd: {
          activeState: "failed",
          subState: "failed",
          result: "exit-code",
          pid: null,
          ports: [],
          lastError: "Address already in use: AH00072: make_sock: could not bind to address 0.0.0.0:80"
        },
        nginx: { activeState: "active", subState: "running", result: "success", pid: 1722, ports: [80], lastError: "" }
      }, 2100, 4),
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
      summary: "修正前の証拠を集め、現在の競合と次回起動設定を分けて直し、Apacheの応答まで確認します。",
      steps: [
        {
          id: "status-failed",
          phase: "状態確認",
          purpose: "systemdがhttpdをどう見ているか確認します。",
          prompt: "最初に、httpdの現在状態と直近の失敗理由を確認してください。",
          hints: ["systemctl statusはActive、Result、直近のjournalをまとめて表示します。"],
          commands: ["systemctl status httpd"],
          expected: "Active: failed と Address already in use が見えます。",
          explanation: "failedを修復前に観察したため、障害の初期状態を証拠として記録できます。",
          doneWhen: { type: "observation", id: "systemctl:status:httpd:failed" }
        },
        {
          id: "journal-evidence",
          phase: "ログ調査",
          purpose: "httpd起動失敗の詳細をjournalから確認します。",
          prompt: "httpd unitに絞り、直近20件のログから直接原因を探してください。",
          hints: ["journalctlの-uはunit、-nは表示件数を指定します。"],
          commands: ["journalctl -u httpd -n 20"],
          expected: "port 80へbindできず、listening socketを作れなかったことが分かります。",
          explanation: "ログはAddress already in useを示しており、設定構文ではなくsocket競合を疑えます。",
          doneWhen: { type: "observation", id: "journalctl:httpd:bind-failed" }
        },
        {
          id: "find-listener",
          phase: "socket確認",
          purpose: "port 80がすでに待ち受けられていることを確認します。",
          prompt: "まずプロセス名を求めず、LISTEN中のTCP socketを確認してください。",
          hints: ["ssの-lはLISTEN、-nは数値表示、-tはTCPを意味します。"],
          commands: ["ss -lnt"],
          expected: "0.0.0.0:80がLISTEN中であることが分かります。",
          explanation: "port 80は空いていません。次に、そのsocketを所有するプロセスを特定します。",
          doneWhen: { type: "observation", id: "ss:port:80:listening" }
        },
        {
          id: "find-owner",
          phase: "所有者確認",
          purpose: "port 80を所有するプロセスとservice状態を特定します。",
          prompt: "プロセス情報を表示し、見つかったserviceの状態も確認してください。",
          hints: ["ssの-pはプロセス情報を表示します。システムserviceの情報を見るためsudoを付けます。"],
          commands: ["sudo ss -lntp", "systemctl status nginx"],
          expected: "nginxがport 80をLISTENし、nginx.serviceがactiveであると分かります。",
          explanation: "httpdではなくnginxが先にport 80を確保していることが、socketとserviceの両方から確認できました。",
          doneWhen: {
            all: [
              { type: "observation", id: "ss:port:80:nginx" },
              { type: "observation", id: "systemctl:status:nginx:active" }
            ]
          }
        },
        {
          id: "repair-runtime",
          phase: "現在状態の復旧",
          purpose: "nginxを停止してportを解放し、httpdを起動します。",
          prompt: "現在の競合だけを解消して、httpdを起動してください。",
          hints: ["stopは現在動いているnginxを停止します。portが空いた後にhttpdをstartします。"],
          commands: ["sudo systemctl stop nginx", "sudo systemctl start httpd"],
          expected: "nginxはinactive、httpdはactiveになります。",
          explanation: "現在の競合は解消しましたが、次回起動時のenable設定はまだnginx側に残っています。",
          doneWhen: {
            all: [
              { type: "serviceInactive", name: "nginx" },
              { type: "serviceActive", name: "httpd" }
            ]
          }
        },
        {
          id: "repair-boot-policy",
          phase: "次回起動設定",
          purpose: "次回起動時はhttpdが起動し、nginxは自動起動しないようにします。",
          prompt: "現在のactive状態を変えず、次回起動時のservice選択を修正して検証してください。",
          hints: ["disableは自動起動を外し、enableは自動起動を設定します。最後にis-enabledで両方を確認します。"],
          commands: [
            "sudo systemctl disable nginx",
            "sudo systemctl enable httpd",
            "systemctl is-enabled nginx",
            "systemctl is-enabled httpd"
          ],
          expected: "nginxはdisabled、httpdはenabledと表示されます。",
          explanation: "stop/startは現在、disable/enableは次回起動時の状態を扱います。",
          doneWhen: {
            all: [
              { type: "observation", id: "systemctl:is-enabled:nginx:disabled" },
              { type: "observation", id: "systemctl:is-enabled:httpd:enabled" }
            ]
          }
        },
        {
          id: "verify-repair",
          phase: "復旧確認",
          purpose: "service、socket、HTTP応答からApacheの復旧を検証します。",
          prompt: "最終状態を複数の観点から確認し、仮想ブラウザでも表示してください。",
          hints: ["is-active、sudo ss -lntp、curlは、それぞれservice・socket・HTTPを検証します。"],
          commands: ["systemctl is-active httpd", "sudo ss -lntp", "curl http://localhost/"],
          browserUrl: "http://localhost/",
          expected: "httpdがactiveでport 80を所有し、curlと仮想ブラウザにApacheページが表示されます。",
          explanation: "原因調査、現在状態の修復、次回起動設定、外形的なHTTP確認まで完了しました。",
          doneWhen: {
            all: [
              { type: "observation", id: "systemctl:is-active:httpd:active" },
              { type: "observation", id: "ss:port:80:httpd" },
              { type: "success", id: "web:httpd:curl" },
              { type: "success", id: "web:httpd:browser" }
            ]
          }
        }
      ]
    },
    goals: [
      { id: "status", text: "修復前のfailed状態を確認した", check: { type: "observation", id: "systemctl:status:httpd:failed" } },
      { id: "journal", text: "journalでbind失敗を確認した", check: { type: "observation", id: "journalctl:httpd:bind-failed" } },
      { id: "owner", text: "nginxがport 80を所有していると特定した", check: { all: [{ type: "observation", id: "ss:port:80:nginx" }, { type: "observation", id: "systemctl:status:nginx:active" }] } },
      { id: "runtime", text: "現在の競合を解消してhttpdを起動した", check: { all: [{ type: "serviceInactive", name: "nginx" }, { type: "serviceActive", name: "httpd" }] } },
      { id: "boot", text: "次回起動時のservice設定を検証した", check: { all: [{ type: "observation", id: "systemctl:is-enabled:nginx:disabled" }, { type: "observation", id: "systemctl:is-enabled:httpd:enabled" }] } },
      { id: "verified", text: "service・socket・HTTP応答で復旧を検証した", check: { all: [{ type: "observation", id: "systemctl:is-active:httpd:active" }, { type: "observation", id: "ss:port:80:httpd" }, { type: "success", id: "web:httpd:curl" }, { type: "success", id: "web:httpd:browser" }] } }
    ]
  }
];

export function getScenario(id) {
  return scenarios.find((scenario) => scenario.id === id) || scenarios[0];
}
