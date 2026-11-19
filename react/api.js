// サーバー（本体の server.ts）とのやりとりをまとめたファイル。API は本体と共通
// bun run index.html（Bun の開発用サーバー。3000 番）で開いたときは、localhost:8000 で動かしている本体のサーバーを使う
export const API = location.port === '3000' ? 'http://localhost:8000' : location.origin;
export const ROOM = 'sample';

// その部屋のポストの一覧を、新しい順にもらう
export async function fetchPosts() {
  const res = await fetch(API + '/posts?room=' + ROOM);
  if (!res.ok) {
    throw new Error('サーバーの返事が ' + res.status + ' でした');
  }
  return res.json();
}

// ポストを送る。うまくいけば { ok: true }、断られたら { ok: false, message: 理由 } を返す
export async function sendPost(name, text) {
  const res = await fetch(API + '/posts?room=' + ROOM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, text: text }),
  });
  if (!res.ok) {
    const error = await res.json();
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

// その id のポストにいいねを 1 つ送る。断られたら例外にする
export async function sendLike(id) {
  const res = await fetch(API + '/posts/' + id + '/like?room=' + ROOM, { method: 'POST' });
  if (!res.ok) {
    throw new Error('サーバーの返事が ' + res.status + ' でした');
  }
}

// サーバーの知らせ（SSE）の口の URL
export function eventsUrl() {
  return API + '/posts/events?room=' + ROOM;
}
