# 本番サーバーの下調べ（minix.dreamyard.cc の公開に向けて）

- 調べた日時: 2026-11-19（木）16:38〜 JST（締切 11/30 まで残り 11 日）
- 調べ方: `ssh yokochi-surver` で入り、**読むだけのコマンド**（`cat`・`ls`・`ss -tln`・`systemctl status / cat / list-units`・`sudo -n true`）だけを使った。サーバーの設定は何も変えていない。
- このファイルは公開リポジトリに入るので、IP アドレス・ユーザー名・トンネルの ID・鍵は書かない。

## 1. 調べた結果

### 1.1 機械と OS

| 項目 | 結果 |
| --- | --- |
| OS | Ubuntu 26.04.1 LTS（カーネルは Raspberry Pi 用） |
| CPU | Cortex-A76 × 4 コア（**arm64 / aarch64**。Raspberry Pi 5 と思われる） |
| メモリ | 7.7 GiB（使える分 約 5.1 GiB）、スワップ 6 GiB（約 1 GiB 使用中） |
| ディスク | `/` 63 GB 中 39 GB 空き、`/mnt/data` 852 GB 中 828 GB 空き |
| 負荷 | load average 0.1〜0.4（余裕あり） |
| ネットワーク | Wi-Fi で家のルーターの内側（プライベート IP）。Tailscale も入っている |
| Bun | **入っていない**（`which bun` なし、`~/.bun` なし）。Node.js と Docker はある |

### 1.2 動いているサービス

systemd のサービスがたくさん動いている（Discord ボット多数、`draftrix-license`、`danjiri`、`job-hunting-backend`、`tsukena-api`、`kancolle-admin`、`shuukatu-app-back` など）。

公開しているものは、すべて **Cloudflare Tunnel**（cloudflared）経由だった。トンネルは**サービスごとに別**になっている。

| systemd のサービス | 設定ファイル | 公開している名前 → 中の行き先 |
| --- | --- | --- |
| `cloudflared.service` | `/etc/cloudflared/config.yml` | `shuukatsu-back.dreamyard.cc` → `localhost:8000`、`kancolle-admin.dreamyard.cc` → `127.0.0.1:8791` |
| `cloudflared-draftrix.service` | `/etc/cloudflared/draftrix.yml` | `draftrix.dreamyard.cc` → `localhost:8090`（nginx） |
| `cloudflared-danjiri.service` | `/etc/cloudflared/danjiri.yml` | `danjiri.dreamyard.cc` → `localhost:3180` |
| ほか | `othello.yml`・`switchbot.yml`・`tsukena.yml`・`~/.cloudflared/shogi-activity.yml` など | （中身は今回の判断に要らないので見ていない） |

- トンネルは「手元の設定ファイルで管理する型」（`config.yml` に `ingress:` を書く）。Cloudflare の画面で管理する型ではない。
- `~/.cloudflared/cert.pem` がある → このユーザーで `cloudflared tunnel create` と `cloudflared tunnel route dns` が使える（sudo なしで、トンネルと DNS を作れる）。
- cloudflared の版は 2026.11.0（`/usr/bin` と `/usr/local/bin` の 2 か所にある）。

### 1.3 80 / 443 番と、ほかの待ち受け

| 番号 | 待ち受け | 使っているもの |
| --- | --- | --- |
| 80 | 0.0.0.0 と [::] | **nginx**（`sites-enabled/default`。中身は Ubuntu の初期ページだけ） |
| 443 | なし | — |
| 8090 | 127.0.0.1 | nginx（`sites-enabled/draftrix`。draftrix のホームページ） |
| **8000** | **0.0.0.0** | **uvicorn（shuukatsu-back）← ミニX の初期の番号とぶつかる** |
| 3000 | すべて | Node.js |
| 22 / 139・445 / 3389 | すべて | ssh / Samba / xrdp |

- nginx の設定の場所: `/etc/nginx/sites-available/`（有効なのは `default` と `draftrix`）、`/etc/nginx/conf.d/` は空。`limit_req` などの回数制限の設定はない。
- **大事: ミニX をそのまま `bun server.js` で起動すると 8000 番が使えずに失敗する。** 本番では `PORT` を別の番号にする。空いていたのは 8100・8010・8400・3200（調べた時点）。

### 1.4 ファイアウォールと sudo

- ufw: **有効**（`active`・`enabled`、`ENABLED=yes`）。ルールの中身は sudo がないと読めないので**分からない**。
- nftables のサービスは止まっている（ufw が iptables / nft を使っている）。fail2ban は動いている（ssh 用の設定あり）。
- `sudo -n true` の結果: **失敗（パスワードなしの sudo は使えない）**。→ `/etc` を変えるコマンドは、人間に渡して実行してもらう。

### 1.5 Cloudflare とのつなぎ方

**Cloudflare Tunnel** でつないでいる（プロキシ＋オリジンの公開ではない）。

- 443 番で待っているものがなく、サーバーは家のルーターの内側（Wi-Fi・プライベート IP）にある。外から入ってくる口を開けずに、cloudflared が中から Cloudflare へつなぎに行く形。
- そのため、**オリジンの IP を直接たたかれる心配が小さい**（ルーターでポートを開けていない限り）。ルーターの設定はサーバーからは見えないので、**分からない**。

### 1.6 ミニX 側の準備の状態（このリポジトリ）

- `server.js` は `PORT`・`HOST` を環境変数で変えられる。
- `MINIX_TRUST_LOCAL_PROXY=1` にすると、同じ PC の中継（cloudflared / nginx）から来た `CF-Connecting-IP` を信じて、相手ごとの回数制限が効く（`client-ip.js`）。**トンネルで公開するなら必ず `1` にする**（しないと全員が 127.0.0.1 に見え、1 人の連打で全員が 429 になる）。
- `CSP_CONNECT_SRC` の初期値は `http://localhost:*`。本番では `https://minix.dreamyard.cc` を入れるかを、公開前に画面で確かめる。

## 2. 公開する方法の案

どちらも「ミニX 専用の新しいトンネル」を作り、**既存のトンネルの設定ファイル（`config.yml` など）には触らない**。既存の `config.yml` に 1 行足す方法もあるが、その再起動で shuukatsu-back と kancolle-admin が一瞬止まるので選ばない。ルーターで 443 番を開けて「プロキシ＋オリジン公開」にする方法も、今の構成（すべてトンネル）と合わず、家の IP が攻撃先になるので選ばない。

### 案 A（推奨）: 専用トンネル → Bun に直接

```
利用者 ─HTTPS→ Cloudflare ─(トンネル)→ cloudflared-minix ─→ Bun（127.0.0.1:8100）
```

**作るもの（すべて新しく足すだけ）**
1. Bun を `~/.bun` に入れる（sudo 不要。arm64 版）
2. ミニX のコードを置く（例: `~/apps/mini-x` に `git clone`）
3. `minix.service`（systemd）: `HOST=127.0.0.1 PORT=8100 MINIX_TRUST_LOCAL_PROXY=1` で `bun server.js` を動かす。`MemoryMax=512M` などで使いすぎを止める
4. トンネル: `cloudflared tunnel create minix` と `cloudflared tunnel route dns minix minix.dreamyard.cc`（cert.pem があるので sudo 不要）
5. `/etc/cloudflared/minix.yml`（`minix.dreamyard.cc` → `http://127.0.0.1:8100`、最後に `http_status:404`）と `cloudflared-minix.service`（`danjiri` と同じ形）
6. 3・5 の `/etc` へのファイル置きと `systemctl enable --now` は sudo が要るので、**人間が実行する**

**既存のサービスへの影響**: 新しいファイルと新しいサービスを足すだけ。nginx・既存のトンネル・ufw は触らない。待ち受けは 127.0.0.1 だけなので LAN にも出ない。

**DoS 対策の 3 層**
| 層 | やること | 防げないもの |
| --- | --- | --- |
| 1. Cloudflare | プロキシ有効（トンネルなら自動）。WAF のレート制限ルール 1 本（例: `/posts` への POST を 10 秒に 20 回まで）。Bot Fight Mode | 制限を下回るゆっくりした大量の攻撃、Cloudflare の無料枠を超える設定 |
| 2. オリジン | 外からの口を開けない（トンネルだけ）。Bun は 127.0.0.1 だけで待つ | ルーターでポートが開いていた場合（未確認） |
| 3. アプリ | 実装済み: 本文 140 字・1 部屋 200 件・部屋数の上限・IP ごとの回数制限（429）・本文の大きさ（413）・SSE の上限（503）。加えて systemd の `MemoryMax` | 正しいリクエストを多数の IP から送る分散攻撃（最後は Cloudflare 頼み） |

「絶対に落ちない」わけではない。家の回線と Raspberry Pi 1 台なので、大きな分散攻撃では落ちうる。落ちても**ほかのサービスを巻きこまない**ように、メモリの上限と別トンネルにしている。

**元に戻す手順**
1. `sudo systemctl disable --now cloudflared-minix minix`
2. `sudo rm /etc/systemd/system/cloudflared-minix.service /etc/systemd/system/minix.service /etc/cloudflared/minix.yml` → `sudo systemctl daemon-reload`
3. `cloudflared tunnel delete minix`（Cloudflare の DNS の `minix` の CNAME も画面で消す）
4. 既存のファイルは変えていないので、ほかに戻すものはない

**人間が Cloudflare の画面でやること**
1. DNS に `minix`（CNAME → `<トンネルID>.cfargotunnel.com`、プロキシ＝オレンジの雲）ができていることを確かめる（CLI で作った場合）
2. Security → WAF → Rate limiting rules に 1 本足す（`minix.dreamyard.cc` の POST を対象）
3. Security → Bots → Bot Fight Mode を確かめる（ドメイン全体に効くので、draftrix などへの影響も考えてから）
4. 公開後、Analytics でリクエスト数を見られることを確かめる

### 案 B: 専用トンネル → nginx（回数制限）→ Bun

```
利用者 ─HTTPS→ Cloudflare ─(トンネル)→ cloudflared-minix ─→ nginx（127.0.0.1:8095）─→ Bun（127.0.0.1:8100）
```

案 A に加えて、`/etc/nginx/sites-available/minix` を作り、nginx で `limit_req`（1 秒あたりの回数）・`limit_conn`（同時接続数）・`client_max_body_size`・静的ファイルの配信をする。SSE（`/events`）は `proxy_buffering off` と長いタイムアウトが要る。

- **よい点**: 回数制限の層が 1 つ増え、Bun に届く前に止められる。nginx の書き方はエンジニアに説明しやすい。
- **悪い点**: **draftrix と同じ nginx を再読み込みする**（`nginx -t` で検査してから `reload` すれば普通は止まらないが、書き間違えると draftrix も巻きこむ）。設定と、確かめることが増える。アプリ側にすでに同じ制限があるので、得るものは小さい。
- **DoS の 3 層**: 案 A と同じ＋第 3 層の前に nginx の制限が入る。nginx は `CF-Connecting-IP` を `real_ip` で読み直す設定が要る（しないと全員が 127.0.0.1 に見える）。
- **元に戻す手順**: 案 A の手順に加えて、`sudo rm /etc/nginx/sites-enabled/minix` → `sudo nginx -t` → `sudo systemctl reload nginx`（`sites-available/minix` は残してよい。既存の `default`・`draftrix` は変えないのでバックアップは不要だが、念のため `sudo cp -a /etc/nginx /etc/nginx.bak-20261119` を取る）。
- **人間が Cloudflare の画面でやること**: 案 A と同じ。

### 推奨

**案 A**。理由:
1. 既存のサービスに触る所がない（nginx も既存のトンネルも変えない）。今のサーバーの形（サービスごとに別トンネル）とそろう。
2. 回数制限はアプリにすでに実装・テスト済みで、Cloudflare の WAF とあわせて 3 層になる。
3. 残り 11 日で、確かめる所が少ない方がよい。

## 3. 分からないこと（確かめていない）

- ufw のルールの中身（sudo が要る）
- 家のルーターでポートを開けているか（サーバーからは見えない）
- Cloudflare のプラン（無料か）と、WAF のレート制限ルールがすでに使われているか（無料プランは 1 本まで）
- port 3000 の Node.js と 80 番の nginx が LAN の外から見えるか（ルーター次第。ミニX とは関係ないが、気づいたので書いておく）
