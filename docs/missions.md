# ミッションのチェックリスト

出典: 手元資料 DOCS.md（応用ミッション）。済んだら `[x]` にし、PR 番号を書く。

## 土台
- [x] ミッション 0〜4 が済んだ状態のコード（completed/ 相当）を用意（公式 `2026/mini-x/completed/` をコピー）
- [x] **B5. 自分の PC でサーバーを動かす**（`server.js`、`script.js` の `API` を `http://localhost:8000`、`bun --hot server.js`）

## A 組：HTML と CSS だけで見た目を変える
- [x] A1. アプリの名前を自分で決める（`feat/a-group`）
- [x] A2. 投稿欄の言葉を変える（`feat/a-group`）
- [x] A3. デフォルトアイコンの色を変える（`feat/a-group`）
- [x] A4. 投稿カードの見た目を変える（`feat/a-group`）
- [x] A5. 右のトレンド欄を自分の話題にする（`feat/a-group`）
- [x] A6. アイコンとボタンの形を変える（`feat/a-group`）

## B 組：JavaScript で動きを足す（目標は B11 まで全部）
- [x] B1. 本文の残りの文字数を表示する（140字を超えたら赤）（`feat/b1-b4`）
- [x] B2. ポストした時刻を表示する（`createdAt`）（`feat/b1-b4`）
- [x] B3. `Ctrl + Enter` でポストできるようにする（`feat/b1-b4`）
- [x] B4. 10 秒ごとに自動で更新する（`feat/b1-b4`）
- [x] （おまけ）`bun test` でサーバーの入力チェックを確かめる（`server.test.js`、`feat/b1-b4`）
- [x] B7. 人ごとに違うアイコンにする（`feat/b7-b9`）
- [x] B8. 自分がいいねしたハートをピンクにする（`feat/b7-b9`。localStorage に保存）
- [x] B9. 更新ボタンなしで、すぐに届くようにする（SSE）（`feat/b7-b9`。切れたらつなぎ直す）

## 最後に：大きな書き換え
- [x] B6. TypeScript に書き換える（全機能のあとに、本体を TS 化）（`feat/b6-typescript`）
- [x] B10・B11. React で書き直す（`react/` フォルダに別に作る。本体は置き換えない）（`feat/b10-b11-react`。JSX 版はコミット `e5ccf0c`、今は TSX。`/react/` で配る）

## オリジナルの拡張機能
- [x] 1. しりとり部屋（`feat/original-shiritori`。案と選んだ理由は `docs/journal/2026-11-19-オリジナル機能の案.md`）
- [ ] 2. 夢のたまご（時間で開くポスト）

## 公開（AGENTS.md「2.5 本番サーバーの決まり」に従う）
- [x] サーバーを読むだけで調べて報告し、承認を得る（既存サービスを壊さない）（`docs/deploy-survey.md`）
- [x] `minix.dreamyard.cc` で公開する（Cloudflare Tunnel 経由。`feat/deploy`）
- [ ] DoS 対策の3層（Cloudflare の保護・オリジンは Cloudflare 経由だけ・アプリの制限）
  - [x] 3 層目: アプリの制限（部屋の上限・IP ごとの回数制限・大きさの上限・SSE の上限・エラーの中身を返さない・ヘッダ）（`feat/hardening`）
