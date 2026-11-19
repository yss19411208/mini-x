// 夢のたまご（オリジナル機能 2）の決まり。ポストするときに時間を選ぶと、その時間になるまで中身が見えない
// サーバー（server.ts）が使う。かえる（開く）時刻は、ポストの opensAt に入れておく

// 選べる時間（分）。1 分後・10 分後・1 時間後・明日（24 時間後）。これ以外は断る
export const EGG_DELAYS_MINUTES = [1, 10, 60, 24 * 60];

// たまごにできるポストの形（server.ts の Post）。opensAt はかえる時刻。ふつうのポストには無い
type EggPost = { text: string; opensAt?: string };

// 送られてきた時間が、選べる時間のどれかか
export function isEggDelay(value: unknown): value is number {
  return typeof value === 'number' && EGG_DELAYS_MINUTES.includes(value);
}

// まだかえっていない（開く時刻になっていない）たまごか
export function isSealed(post: EggPost, now: number): boolean {
  return post.opensAt !== undefined && Date.parse(post.opensAt) > now;
}

// 画面に送るときの形。まだかえっていないたまごは、本文を空にして sealed: true を付ける
// 画面で隠すだけだと、開発者ツールで通信の中身を見れば読めてしまうので、サーバーが送らない
export function toPublicPost<T extends EggPost>(post: T, now: number): T & { sealed?: true } {
  return isSealed(post, now) ? { ...post, text: '', sealed: true } : post;
}
