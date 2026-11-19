// サーバー（本体の server.ts）とのやりとりをまとめたファイル。API は本体と共通
// bun run index.html（Bun の開発用サーバー。3000 番）で開いたときは、localhost:8000 で動かしている本体のサーバーを使う
export const API = location.port === '3000' ? 'http://localhost:8000' : location.origin;
export const ROOM = 'sample';

// サーバーから届くポスト 1 件の形（B11）。本体の server.ts・script.ts の Post と同じ
export type Post = {
  id: string;
  name: string;
  text: string;
  likes: number;
  createdAt: string; // ISO の形の時刻
  opensAt?: string; // 夢のたまご（本体のオリジナル機能 2）がかえる時刻
  sealed?: boolean; // まだかえっていないたまご（text は空で届く）
};

// sendPost の答え。うまくいったか、断られたら理由
export type SendResult = { ok: true } | { ok: false; message: string };

// その部屋のポストの一覧を、新しい順にもらう
export async function fetchPosts(): Promise<Post[]> {
  const res = await fetch(API + '/posts?room=' + ROOM);
  if (!res.ok) {
    throw new Error('サーバーの返事が ' + res.status + ' でした');
  }
  return res.json();
}

// ポストを送る。うまくいけば { ok: true }、断られたら { ok: false, message: 理由 } を返す
export async function sendPost(name: string, text: string): Promise<SendResult> {
  const res = await fetch(API + '/posts?room=' + ROOM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, text: text }),
  });
  if (!res.ok) {
    const error: { message: string } = await res.json();
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

// その id のポストにいいねを 1 つ送る。断られたら例外にする
export async function sendLike(id: string): Promise<void> {
  const res = await fetch(API + '/posts/' + id + '/like?room=' + ROOM, { method: 'POST' });
  if (!res.ok) {
    throw new Error('サーバーの返事が ' + res.status + ' でした');
  }
}

// サーバーの知らせ（SSE）の口の URL
export function eventsUrl(): string {
  return API + '/posts/events?room=' + ROOM;
}
