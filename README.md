# ユメバ（ミニX の拡張）

jig.jp 11月の開発お題「ミニXの拡張機能」の作品です。部屋ごとにポストといいねができる小さな SNS を、Bun で動かしています。

- 公開 URL: https://minix.dreamyard.cc （React 版: https://minix.dreamyard.cc/react/ 、しりとり部屋: https://minix.dreamyard.cc/?room=shiritori ）
- しくみの説明: [docs/explain.md](docs/explain.md)／作業の記録: [docs/journal/](docs/journal/)／公開の手順: [docs/deploy.md](docs/deploy.md)

## できること（応用ミッション）

| 番号 | 内容 |
| --- | --- |
| A1〜A6 | 名前「ユメバ」・投稿欄の言葉・アイコンの色・浮いたカード・トレンド欄・角丸のアイコンとボタン |
| B1 | 本文の残りの文字数（140 字を超えたら赤くし、ポストできない） |
| B2 | ポストした時刻（「3分前」など） |
| B3 | Ctrl + Enter（Mac は ⌘ + Enter）でポスト |
| B4 | 10 秒ごとの自動更新（SSE が切れているあいだの予備） |
| B5 | 自分の PC でサーバー（`server.ts`） |
| B6 | 本体を TypeScript に（`bunx tsc` でエラー 0） |
| B7 | 名前ごとに違う色と頭文字のアイコン |
| B8 | 自分がいいねしたハートをピンクに（1 人 1 回、ブラウザに保存） |
| B9 | SSE で、更新ボタンなしにすぐ届く（切れたら自動でつなぎ直す） |
| B10・B11 | React 版（JSX → TSX）を `react/` に。`/react/` で動く |

公開に向けて、攻撃への備え（IP ごとの回数制限・本文の大きさ・部屋の数・SSE の接続数の上限・エラーの中身を返さない・セキュリティ用のヘッダ）も入れています。

## オリジナル機能

1. **しりとり部屋**（`/?room=shiritori`）: 前のポストの最後の字から始まる、かなのことばだけポストできる部屋。サーバーが判定し、「ん」で終わったら次は好きな字から。
2. **夢のたまご**: ポストするときに「1分後・10分後・1時間後・明日」を選ぶと、その時間になるまで中身がだれにも見えない（サーバーが本文を送らない）。時間になるとタイムラインの先頭にかえる 🐣。

## 手元での動かし方

```
bun install              # 型の検査の道具（typescript など）を入れる。動かすだけなら不要
bun --hot server.ts      # http://localhost:8000/ を開く
bun test                 # テスト
bunx tsc                 # 型の検査
```

React 版を作り直すとき: `cd react && bun install && bun run build`（`react/dist` を作り、`server.ts` が `/react/` で配る）。開発中は `bun run dev`（3000 番。API は localhost:8000）。

## スクショ

`docs/images/` に置きます（例: `home.png`・`shiritori.png`・`egg.png`・`react.png`）。
