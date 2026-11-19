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

## 応用ミッション A 組：見た目を「ユメバ」にする（HTML・CSS・SVG だけ。JavaScript は触っていない）

名前・話題・色・形は、AI が出した案（各 3 つ）から人間が選んだ。公式の答え（`advanced/`）は見ていない。手元資料 DOCS.md のヒントだけを使った。

| ミッション | 変えたファイルと場所 | 何をしたか |
|---|---|---|
| A1 名前 | `index.html` の `<title>` と `.wordmark` | 「ミニX」→「ユメバ」。公開先のドメイン dreamyard（夢の庭）にちなむ |
| A2 投稿欄の言葉 | `index.html` の `placeholder` | 「名前」→「ニックネーム」、「いまどうしてる？」→「今日なにつくった？」 |
| A3 アイコンの色 | `icon.svg` の 2 つの `fill`、`styles.css` の `--accent` | 背景 `#e5dcff`（薄い紫）と人の形 `#7856ff`（紫）。ボタンなどの色 `--accent` も同じ紫にそろえた |
| A4 投稿カード | `styles.css` のいちばん下の `.post` | `margin` ですき間、`border-radius: 16px` で角丸、`box-shadow` で影。カードが浮いて見えるよう、タイムラインの下地を薄い灰色（`--bg-sub`）にした |
| A5 トレンド | `index.html` の `.trend-name`・`.trend-meta` | #プロコン・#高専・#Bun・#締切まであと11日。件数は決め打ちの飾り |
| A6 形 | `styles.css` のいちばん下の `.avatar`・ボタン | アイコンを円（50%）から角丸 12px の四角、ボタンを丸い端（9999px）から角丸 8px に |

### なぜ「いちばん下に足す」のか
- CSS は、同じ強さの指定が 2 つあると **後に書いたほうが勝つ**。もとの `.post` や `.avatar` を消さずに、いちばん下に上書きを足したので、「何を変えたか」が 1 か所にまとまって読みやすい。
- 例外: マウスを乗せたときの `.post:hover` は `.post` より強い（クラス＋`:hover`）ので、下に足した `.post` の白い背景を上書きしてしまう。もとの色は透明なので、灰色の下地が透けてカードが灰色になった。そこで `.post:hover` も下に足し、`color-mix` で「白に紫を 4% 混ぜた色」にした。

### `--accent`（CSS 変数）を変えると何が変わるか
- `var(--accent)` を使っている所（ポストするボタン・更新ボタンの文字・名前の入力欄・「さらに表示」・投稿欄のアイコン）が、1 行の変更で全部紫になる。色を 1 か所で決めておく利点。
