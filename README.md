# systemd / Apache 初級ラボ

GitHub Pages で公開できる静的な Linux CLI 学習シミュレータです。Rocky/AlmaLinux 9 相当の仮想サーバーで、`dnf`、`systemctl`、`journalctl`、`curl` を使った Apache 構築とトラブルシューティングを練習できます。

## 内容

- 演習1: `sudo dnf makecache`、`dnf info httpd`、`sudo dnf install -y httpd`
- 演習2: `cat /usr/lib/systemd/system/httpd.service`、`sudo systemctl start httpd`、`sudo systemctl enable httpd`、`curl http://localhost/`
- 演習3: `systemctl status httpd` と `journalctl -u httpd -n 20` で port 80 競合を調査し、`sudo systemctl stop nginx` などで Apache を復旧
- CLI の `curl` に加え、画面内の仮想ブラウザで `http://localhost/` の表示確認をシミュレート

このアプリは実ホストのシェルやネットワークへ接続しません。すべての状態変化はブラウザ内の仮想状態だけで再現します。

## ローカル確認

```powershell
npm.cmd test
npm.cmd run check
npm.cmd start
```

起動後、ブラウザで `http://127.0.0.1:4173/` を開きます。

## GitHub Pages

リポジトリのルートにある静的ファイルだけで動作します。Pages の Source は `main` branch の `/` を想定しています。
