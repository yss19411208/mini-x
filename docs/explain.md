# 機能のしくみ（人間がレビューで説明するため）

機能ごとに「何をしているか・どのファイルのどこか・なぜこう書いたか」を短く書く。

## 土台：公式の completed/ をそのまま使う

- 出典: 公式資料 `jigintern/study_session_materials` の `2026/mini-x/completed/`（コピー時のコミット `dcdcd05`）。ここから自分たちで拡張する。
- ファイル: `index.html`（画面の部品）・`styles.css`（見た目）・`script.js`（画面の動き）・`server.js`（サーバー）・`icon.svg`（アイコン）。

### server.js：ポストを覚えて、頼まれたら返すサーバー

- `Bun.serve` でサーバーを 8000 番で立てる。`routes` は「URL と GET/POST の組み合わせ → どの関数が答えるか」の表。
  - `GET /` → `index.html` を配る（だから http://localhost:8000/ で画面が出る）
  - `GET /posts?room=部屋` → その部屋のポスト一覧を JSON で返す（`getPosts`）
  - `POST /posts?room=部屋` → 名前と本文を受け取り、新しいポストを作って保存（`createPost`）
  - `POST /posts/:id/like?room=部屋` → その id のポストの `likes` を 1 増やす（`likePost`）
  - `GET /posts/events?room=部屋` → つなぎっぱなしにして、変化を知らせる（SSE。B9 で使う）
- 保存場所は **メモリ**（`rooms` という Map。部屋の名前 → ポストの配列）。データベースは使っていないので、**サーバーを止めるとポストは消える**。
  - `globalThis.rooms` に置いているのは、`bun --hot` がファイル保存のたびに読み込み直しても、ポストを消さないため。
- 入力は必ず確かめる: 部屋名は `^[A-Za-z0-9-]{1,32}$`、名前 20 字・本文 140 字まで（絵文字を 1 字と数えるため `Array.from` で数える）、空は不可。だめなら 400 と理由を返す。1 部屋 200 件を超えたら古いものから消す（メモリを使いすぎないため）。
- `CORS_HEADERS` は、別の URL で開いた画面（`bun run index.html`）からの fetch も受け付けるための印。

### script.js：サーバーとやりとりして画面に並べる

- 先頭の `API`（サーバーの場所 `http://localhost:8000`）と `ROOM`（部屋の名前 `sample`）を、すべての fetch で使う。
- `showPosts()`: `GET /posts` で一覧を取り、`<template id="post-template">` の見本をコピーして 1 件ずつカードを作り、タイムラインに入れる。
  - 名前と本文は **`textContent`** で入れる（`innerHTML` だと、本文に書かれた HTML が動いてしまう＝XSS になるため）。
- `addPost()`: 名前と本文を `JSON.stringify` して `POST /posts` に送り、終わったら本文欄を空にして `showPosts()` で取り直す。
- `addLike(id)`: `POST /posts/{id}/like` を送って取り直す。
- 「ポストする」ボタン → `addPost`、更新ボタン → `showPosts`。ページを開いたときにも 1 回 `showPosts()`。
