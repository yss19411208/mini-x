# 本番への公開・更新・元に戻す手順（minix.dreamyard.cc）

下調べは `docs/deploy-survey.md`、選んだのは **案 A（ミニX 専用の Cloudflare Tunnel → Bun に直接）**。
このファイルは公開リポジトリに入るので、IP アドレス・ユーザー名・トンネルの ID・鍵は書かない。

## 1. 全体の形

```
利用者 ─HTTPS→ Cloudflare（WAF・レート制限）─(トンネル)→ cloudflared-minix ─→ Bun（127.0.0.1:8100）
```

| もの | 場所 | 持ち主・動かすユーザー |
| --- | --- | --- |
| コード | `/opt/minix/app`（GitHub の main を clone） | root の持ち物。アプリは読むだけ |
| Bun | `/opt/minix/bun/bun`（公式の arm64 版。SHA256 を確かめて入れた） | root の持ち物 |
| アプリのサービス | `/etc/systemd/system/minix.service`（見本: `deploy/minix.service`） | `minix` ユーザーで動く |
| トンネルのサービス | `/etc/systemd/system/cloudflared-minix.service`（見本: `deploy/cloudflared-minix.service`） | `minix-tunnel` ユーザーで動く |
| トンネルの設定 | `/etc/cloudflared/minix.yml`（見本: `deploy/minix.yml.example`） | — |
| トンネルの認証ファイル | `/etc/cloudflared/minix-credentials.json`（秘密。リポジトリに入れない） | `minix-tunnel` だけが読める |

**既存のサービス・設定には触らない。** 新しいユーザー・新しいファイル・新しいサービスを足すだけ（`install.sh` は、置き先にもう何かあれば止まる）。nginx・既存のトンネル・ufw は変えない。

## 2. DoS 対策の 3 層

| 層 | やっていること | 防げないもの |
| --- | --- | --- |
| 1. Cloudflare | プロキシ（トンネルなので必ず通る）・WAF のレート制限・Bot 対策（4 章） | 制限より少しずつの攻撃、とても大きな分散攻撃 |
| 2. オリジン | Bun は `127.0.0.1` だけで待つ。外から入る口（ポート）を開けない。届く道は cloudflared（中から Cloudflare へつなぎに行く）だけ | サーバーの中のほかのプログラムからは届く |
| 3. アプリ | 本文 140 字・1 部屋 200 件・部屋数の上限・IP ごとの回数制限（429）・本文の大きさ（413）・SSE の数（503）。systemd でメモリ 512MB・CPU 1 コア分までに制限、落ちたら 3 秒後に再起動 | 正しいリクエストを多くの IP から送る攻撃 |

家の回線と Raspberry Pi 1 台なので、**絶対に落ちないわけではない**。落ちても、メモリ・CPU の上限と別トンネルで、ほかのサービスを巻きこまないようにしている。

## 3. はじめて公開する手順（2026-11-19）

AI が済ませたこと（sudo なし）:
1. `cloudflared tunnel create minix`（認証ファイルは `~/.cloudflared/<ID>.json`）
2. `cloudflared tunnel route dns minix minix.dreamyard.cc`（DNS に CNAME ができる）
3. `~/minix-deploy/` に Bun（公式の `bun-linux-aarch64.zip`、`SHASUMS256.txt` で確かめた）と `deploy/` のファイルを置く
4. サーバーで `127.0.0.1:8101` に一時的に起動し、`GET /`＝200・ポスト＝201 を確かめて止めた

人間がやること（sudo が要る）:
1. この変更（`feat/deploy`）の PR を main にマージする（`install.sh` は main を clone する）
2. サーバーで:
   ```
   sudo bash ~/minix-deploy/install.sh ~/.cloudflared/<ID>.json ~/minix-deploy/bun-linux-aarch64/bun
   ```
3. 4 章の Cloudflare の画面の設定をする

## 4. 人間が Cloudflare の画面でやること

ゾーン（`dreamyard.cc`）全体に効く設定は、draftrix など**ほかのサブドメインにも効く**。全体の設定は今のままにして、ミニX だけに効くルールで足す。

1. **DNS**（DNS → Records）
   - `minix` の CNAME（行き先 `<ID>.cfargotunnel.com`）があり、**Proxied（オレンジの雲）** になっていることを確かめる。
2. **SSL/TLS**
   - トンネルなので、オリジンの証明書は要らない（Cloudflare と cloudflared の間は暗号化されている）。
   - SSL/TLS → Edge Certificates で「Always Use HTTPS」が On か確かめる。Off なら、全体を変えずに Rules → Redirect Rules で「`http.host eq "minix.dreamyard.cc"` かつ `ssl` でない → `https://` へ 301」を 1 本足す。
3. **レート制限**（Security → WAF → Rate limiting rules → Create rule）
   - 名前: `minix-post`
   - 条件: `http.host eq "minix.dreamyard.cc" and http.request.method eq "POST"`
   - 数え方: IP ごと、**10 秒に 20 回**を超えたら **Block**、時間は 10 秒（無料プランで選べる値）
   - 無料プランはルールが 1 本までなので、もう使っていたら、そのルールを消さずに相談する。
4. **変なメソッドを止める**（Security → WAF → Custom rules → Create rule）
   - 名前: `minix-methods`
   - 条件: `http.host eq "minix.dreamyard.cc" and not http.request.method in {"GET" "POST" "OPTIONS" "HEAD"}` → **Block**
5. **Bot Fight Mode**（Security → Bots）はゾーン全体に効く。draftrix のアプリの通信を止めないか分からないので、**今は変えない**。
6. 公開のあと、Analytics → Traffic で `minix.dreamyard.cc` のリクエストが見えることを確かめる。

## 5. 更新のしかた（git pull から再起動まで）

main にマージしたあと、サーバーで:

```
cd /opt/minix/app
sudo git pull --ff-only            # main の新しい版をとる
sudo systemctl restart minix       # アプリを起動し直す（ポストはメモリにあるので消える）
systemctl status minix --no-pager  # active (running) を確かめる
curl -s -o /dev/null -w '%{http_code}\n' https://minix.dreamyard.cc/   # 200 なら OK
```

うまく動かないときは、1 つ前の版に戻す:

```
cd /opt/minix/app
sudo git log --oneline -3          # 戻したい版を選ぶ
sudo git checkout <前の版>          # 戻す（直したら sudo git checkout main で main に戻す）
sudo systemctl restart minix
```

ログを見る: `journalctl -u minix -n 50 --no-pager`、`journalctl -u cloudflared-minix -n 50 --no-pager`

## 6. 元に戻す手順（公開をやめる）

```
sudo systemctl disable --now cloudflared-minix minix
sudo rm /etc/systemd/system/cloudflared-minix.service /etc/systemd/system/minix.service
sudo rm /etc/cloudflared/minix.yml /etc/cloudflared/minix-credentials.json
sudo systemctl daemon-reload
sudo rm -r /opt/minix
sudo userdel minix; sudo userdel minix-tunnel
cloudflared tunnel delete minix    # トンネルを消す（sudo 不要）
```

そのあと Cloudflare の画面で、DNS の `minix` の CNAME と、4 章で足したルールを消す。既存のファイルは変えていないので、ほかに戻すものはない。

## 7. 公開したあとに確かめること

1. `systemctl is-active minix cloudflared-minix` が 2 つとも `active`
2. `ss -tlnp | grep 8100` が `127.0.0.1:8100` だけ（`0.0.0.0` でない）
3. https://minix.dreamyard.cc/ でポスト・いいねができる。SSE で別のタブにすぐ届く
4. LAN の別の PC から `http://<サーバー>:8100/` につながらない（127.0.0.1 だけで待っているため）
5. **draftrix が今までどおり**: `systemctl is-active draftrix-license cloudflared-draftrix nginx` が `active`、https://draftrix.dreamyard.cc/ が 200（公開前も 200 だった）
