# EL9 Apache 初級ラボ

GitHub Pages で公開できる静的な Linux CLI 学習シミュレータです。EL9系の共通操作を再現した固定の仮想教材環境で、`dnf`、`systemctl`、`journalctl`、`ss`、`curl` を使った Apache 構築とトラブルシューティングを練習できます。特定ディストリビューションの最新状態を再現するものではなく、学習用に決定的な状態と出力を提供します。

## 内容

- 演習1: `dnf check-update` と `echo $?` で更新候補と終了コード100を確認し、`sudo dnf install -y httpd` 後にRPMDBで検証
- 演習2: `systemctl start` と `systemctl enable` の違いを学び、`is-active`、`is-enabled`、`ss -lnt`、`curl` で検証
- 演習3: `systemctl status`、`journalctl`、`ss` で port 80 競合を調査し、現在状態と次回起動設定を分けて Apache を復旧
- CLI の `curl` に加え、画面内の仮想ブラウザで `http://localhost/` の表示確認をシミュレート
- 手順ごとの問い、段階ヒント、コマンド例、完了後の解説により、一人でも考えながら進行可能

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
