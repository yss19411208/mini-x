#!/usr/bin/env bash
# ミニX を本番サーバーに初めて置くときのスクリプト（人間が sudo で 1 回だけ実行する）
#   使い方: sudo bash install.sh <トンネルの認証ファイル.json> <bun の実行ファイル>
# 新しいユーザー・新しいファイル・新しいサービスを足すだけ。既にあるファイルは上書きせず、そこで止まる。
# 元に戻す手順は docs/deploy.md
set -euo pipefail

CREDENTIALS="$1"   # cloudflared tunnel create minix で作られた <ID>.json
BUN_BINARY="$2"    # 公式の bun-linux-aarch64.zip から取り出し、SHA256 を確かめた bun
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_URL="https://github.com/yss19411208/mini-x.git"

# 上書きしないために、置く先にもう何かあれば止める
for path in /opt/minix /etc/cloudflared/minix.yml /etc/cloudflared/minix-credentials.json \
            /etc/systemd/system/minix.service /etc/systemd/system/cloudflared-minix.service; do
  if [ -e "$path" ]; then
    echo "すでにあるので止めます: $path" >&2
    exit 1
  fi
done

# 1. 専用のユーザー（ログインできない・ホームなし）。アプリ用とトンネル用で分ける
id minix >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin minix
id minix-tunnel >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin minix-tunnel

# 2. Bun とコード。持ち主は root（アプリは読むだけ）
install -d -m 755 /opt/minix /opt/minix/bun
install -m 755 "$BUN_BINARY" /opt/minix/bun/bun
git clone --quiet --branch main "$REPO_URL" /opt/minix/app

# 3. トンネルの設定。認証ファイルはトンネル用のユーザーだけが読める
TUNNEL_ID="$(basename "$CREDENTIALS" .json)"
install -m 440 -o root -g minix-tunnel "$CREDENTIALS" /etc/cloudflared/minix-credentials.json
sed "s/<TUNNEL-ID>/$TUNNEL_ID/" "$HERE/minix.yml.example" > /etc/cloudflared/minix.yml
chmod 644 /etc/cloudflared/minix.yml

# 4. systemd に登録して起動（アプリ → トンネルの順）
install -m 644 "$HERE/minix.service" /etc/systemd/system/minix.service
install -m 644 "$HERE/cloudflared-minix.service" /etc/systemd/system/cloudflared-minix.service
systemctl daemon-reload
systemctl enable --now minix.service
systemctl enable --now cloudflared-minix.service

systemctl --no-pager --lines=5 status minix.service cloudflared-minix.service
echo "おわり。https://minix.dreamyard.cc/ を開いて確かめてください"
