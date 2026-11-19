# はじめかた（ミニX の拡張機能・jig.jp 11月のお題）

締切は **2026-11-30（月）**。提出には **公開の GitHub リポジトリの URL** が必要です。
Git・GitHub CLI・Claude のアプリは procon38 の準備で入っているので、**Bun を入れてリポジトリを作るだけ**です。所要 15〜20 分。

## 1. Bun を入れる

PowerShell で（手元資料の「準備」と同じ方法）:

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

PowerShell を開き直して `bun --version` で数字が出れば OK。

## 2. リポジトリを作る（公開）

エンジニアにコードを読んでもらうので **Public** で作ります。

```powershell
gh auth status          # yss19411208 でログインしているか
cd ~\Documents\GitHub
gh repo create mini-x --public --clone
cd mini-x
```

（名前は自由。GitHub Desktop なら「File → New repository」→ Publish のときに「Keep this code private」のチェックを外す）

## 3. 一式を入れて push する

`minix-ai-kit.zip` を展開し、`minix-ai-kit` フォルダの **中身を全部**（`.claude` も）`mini-x` にコピーして:

```powershell
git add -A
git commit -m "chore: AI 開発の規約と依頼文を追加"
git branch -M main
git push -u origin main
```

## 4. Code タブで始める

1. Claude アプリ → **Code** → **Local** → **Open folder…** で `Documents\GitHub\mini-x` を開く
2. `今何時？` と送り、日本時間が返ればフックが動いています
3. **新しいチャット**で `PROMPTS.md` の「1. 土台づくり」を貼る
4. 終わったら、Claude が書いた手順で画面を確かめる（`bun --hot server.ts` → Chrome で http://localhost:8000/ ）
5. 以後、「2. A 組」→「3. B1〜B4」→「4. 案」→「5. 作る」→「6. 点検」→「7. README と提出文」の順に、それぞれ新しいチャットで

PR が来たら、画面で動きを確かめてからマージします。

## 5. 提出

`docs/submission.md` の下書きを読み、**自分の言葉で直してから**「作品提出」チャンネルに投稿します。
エンジニアからの質問に答えられるように、`docs/explain.md` に一度目を通しておきましょう。

## 使用量の節約

週の上限が近いときは、1 回の依頼で終わりまで進めてもらい、報告は短く（PROMPTS はそうなっています）。
軽い作業（README の手直しなど）は、Code のモデルを軽いものに切り替えるのも手です。
