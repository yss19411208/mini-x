// ミニX のサーバー。部屋ごとにポストを覚えておき、一覧を返したり、ポストやいいねを保存したりする
// 起動方法：このファイルのあるフォルダで bun --hot server.ts を実行し、http://localhost:8000/ を開く
// B6 で TypeScript にした。Bun は .ts をそのまま動かせるので、前もって JavaScript に直す手順は要らない
//
// 公開に向けて、攻撃に強くするしくみを入れている（feat/hardening。説明は docs/explain.md）
//   - 部屋の数の上限（古い部屋から消す）・IP ごとの回数の制限・送るデータの大きさの上限
//   - SSE の接続数の上限・長くつながったままの接続を切る
//   - エラーの中身を返さない・セキュリティ用のヘッダ
import type { BunFile, BunRequest, Server } from 'bun';
import { clientIp, ipKey } from './client-ip.ts';
import { createRateLimiter, type RateLimiter } from './rate-limit.ts';
import { isEggDelay, isSealed, toPublicPost } from './egg.ts';
import { checkShiritori, isShiritoriRoom } from './shiritori.ts';

// ポスト 1 件の形。画面（script.ts）の Post と同じ形にする
type Post = {
  id: string;
  name: string;
  text: string;
  likes: number;
  createdAt: string; // ISO の形の時刻（例: 2026-11-19T07:00:00.000Z）
  opensAt?: string; // 夢のたまご（オリジナル機能 2）がかえる時刻。ふつうのポストには無い
};

// 送られてきたポストの中身（checkPostBody で確かめたあとの形）。opensIn は夢のたまごの時間（分）
type PostInput = { name: string; text: string; opensIn?: number };

// SSE の接続 1 本分の記録
type Connection = {
  room: string; // つないでいる部屋
  key: string; // つないだ人（IP）
  openedAt: number; // つないだ時刻
  controller: ReadableStreamDefaultController<string> | null; // 文字を送る口（つないだ直後に入る）
};

// このサーバーの型。WebSocket は使わないので、WebSocket のデータの型は undefined
type MinixServer = Server<undefined>;

// 名前と本文の長さ、1 つの部屋に残すポストの数、部屋の名前に使える文字の決まり
const MAX_NAME_LENGTH = 20;
const MAX_TEXT_LENGTH = 140;
const MAX_POSTS_PER_ROOM = 200;
const ROOM_PATTERN = /^[A-Za-z0-9-]{1,32}$/;

// 環境変数で数を変えられるようにする（テストで小さい上限を試すため）。決めていなければ fallback を使う
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// 攻撃に備えた上限の一覧。数はふだんの使い方（10 秒ごとの取り直し・教室で同じ IP の人が何人もいる）より十分大きくした
const LIMITS = {
  maxRooms: envNumber('MINIX_MAX_ROOMS', 500), // 覚えておく部屋の数
  maxBodyBytes: envNumber('MINIX_MAX_BODY_BYTES', 4096), // ポストの JSON の大きさ（140 字の日本語でも 1KB 未満）
  postsPerMinute: envNumber('MINIX_POSTS_PER_MINUTE', 10), // 1 人（IP）が 1 分にポストできる数
  likesPerMinute: envNumber('MINIX_LIKES_PER_MINUTE', 60), // 1 人が 1 分にいいねできる数
  sameLikeIntervalMs: envNumber('MINIX_SAME_LIKE_INTERVAL_MS', 10 * 1000), // 同じポストへのいいねの間隔
  readsPerMinute: envNumber('MINIX_READS_PER_MINUTE', 300), // 1 人が 1 分に一覧を取れる数
  newRoomsPerMinute: envNumber('MINIX_NEW_ROOMS_PER_MINUTE', 10), // 1 人が 1 分に新しく作れる部屋の数
  sseConnectsPerMinute: envNumber('MINIX_SSE_CONNECTS_PER_MINUTE', 30), // 1 人が 1 分に SSE をつなげる回数
  maxSseTotal: envNumber('MINIX_MAX_SSE_TOTAL', 500), // サーバー全体の SSE の接続数
  maxSsePerIp: envNumber('MINIX_MAX_SSE_PER_IP', 20), // 1 人の SSE の接続数
  sseMaxLifetimeMs: envNumber('MINIX_SSE_MAX_LIFETIME_MS', 10 * 60 * 1000), // 1 本の SSE をつないでおく最長の時間
  eggsPerMinute: envNumber('MINIX_EGGS_PER_MINUTE', 3), // 1 人が 1 分に作れる夢のたまごの数
  maxEggsPerRoom: envNumber('MINIX_MAX_EGGS_PER_ROOM', 20), // 1 部屋の、まだかえっていないたまごの数
  eggMinuteMs: envNumber('MINIX_EGG_MINUTE_MS', 60 * 1000), // たまごの「1 分」の長さ（テストで短くして、かえるところを試すため）
  maxRequestBodyBytes: 64 * 1024, // Bun が受け取る本文の大きさ（どの URL でも）。超えると Bun が読む前に断る
};

// Cloudflare Tunnel や nginx を同じサーバーで中継に使うときだけ 1 にする（client-ip.js を参照）
const TRUST_LOCAL_PROXY = process.env.MINIX_TRUST_LOCAL_PROXY === '1';
// 公開するときは、自分の画面の URL（例: https://minix.example.com）だけにする。手元では * のまま
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// 新しい部屋ができたときに、はじめから入れておくポスト
const SAMPLE_POSTS = [
  { name: 'たろう', text: 'はじめまして！' },
  { name: 'はなこ', text: 'こんにちは〜' },
  { name: 'じろう', text: 'ミニX できた 🎉' },
];
// しりとり部屋（オリジナル機能 1）のはじめのポスト。しりとり → りんご → ごりら とつながっていて、次は「ら」から
const SHIRITORI_SAMPLE_POSTS = [
  { name: 'たろう', text: 'しりとり' },
  { name: 'はなこ', text: 'りんご' },
  { name: 'じろう', text: 'ごりら' },
];

// ほかの URL で開いた画面（bun run index.html）からの頼みごとにも答えてよい、とブラウザに伝える印（CORS）
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// すべての返事に付けるセキュリティ用のヘッダ
const SECURITY_HEADERS = {
  // ファイルの種類を、ブラウザに推測させない（JSON を HTML として動かされないように）
  'X-Content-Type-Options': 'nosniff',
  // ほかのサイトの枠（iframe）の中に表示させない（見えないボタンを押させる攻撃を防ぐ）
  'X-Frame-Options': 'DENY',
  // ほかのサイトへ移るときに、この画面の URL を伝えない
  'Referrer-Policy': 'no-referrer',
  // カメラ・マイク・位置情報は使わないので、はじめから禁止しておく
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // 画面が読み込んでよいものを、このサーバーのファイルだけにする（もし XSS があっても、よそのスクリプトは動かない）
  // fetch の行き先（connect-src）は、手元で API を http://localhost:8000 にしているので localhost も許す
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self' " + (process.env.CSP_CONNECT_SRC || 'http://localhost:*'),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

// 画面のファイル。URL ごとに、どのファイルをどの種類で配るかの表
// （Bun の HTML の読み込み〔import index from './index.html'〕ではヘッダを足せないので、自分で配る）
// script.ts はブラウザがそのまま読めないので、transpile: true の印を付け、配る前に JavaScript に直す（B6）
type StaticFile = { file: string; type: string; transpile?: boolean };
const STATIC_FILES: Record<string, StaticFile> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/script.ts': { file: 'script.ts', type: 'text/javascript; charset=utf-8', transpile: true },
  '/shiritori.ts': { file: 'shiritori.ts', type: 'text/javascript; charset=utf-8', transpile: true },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/icon.svg': { file: 'icon.svg', type: 'image/svg+xml' },
};

// rooms は部屋の名前ごとのポストの配列。listeners は部屋ごとの、SSE の知らせを待っている接続
// sseCountByIp は人（IP）ごとの SSE の接続数
// GET のたびに並べ替えずに済むよう、各部屋の配列は新しい順に持つ
// bun --hot は保存のたびにこのファイルを読み込み直す。const rooms = new Map() と書くと、そのたびにポストが消え、
// 開いている画面にも知らせが届かなくなる。読み込み直しても残る globalThis に置き、2 回目からは前のものを使う
// （TypeScript に「globalThis にこの名前のものを置く」と教えるのが declare global）
declare global {
  var rooms: Map<string, Post[]> | undefined;
  var listeners: Map<string, Set<Connection>> | undefined;
  var sseCountByIp: Map<string, number> | undefined;
  var heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  var sweepTimer: ReturnType<typeof setInterval> | undefined;
}
const rooms = (globalThis.rooms ??= new Map<string, Post[]>());
const listeners = (globalThis.listeners ??= new Map<string, Set<Connection>>());
const sseCountByIp = (globalThis.sseCountByIp ??= new Map<string, number>());

// 回数の制限。ポスト・いいね・一覧・新しい部屋・SSE のつなぎ直しを、人（IP）ごとに 1 分単位で数える
const MINUTE = 60 * 1000;
const limiters = {
  post: createRateLimiter({ limit: LIMITS.postsPerMinute, windowMs: MINUTE }),
  like: createRateLimiter({ limit: LIMITS.likesPerMinute, windowMs: MINUTE }),
  sameLike: createRateLimiter({ limit: 1, windowMs: LIMITS.sameLikeIntervalMs }),
  read: createRateLimiter({ limit: LIMITS.readsPerMinute, windowMs: MINUTE }),
  newRoom: createRateLimiter({ limit: LIMITS.newRoomsPerMinute, windowMs: MINUTE }),
  sseConnect: createRateLimiter({ limit: LIMITS.sseConnectsPerMinute, windowMs: MINUTE }),
  egg: createRateLimiter({ limit: LIMITS.eggsPerMinute, windowMs: MINUTE }),
};

// ポスト 1 件分のオブジェクトを作る。id には、ほかと重ならない文字を自動で付ける
function newPost(name: string, text: string, createdAt: Date): Post {
  return {
    id: crypto.randomUUID(),
    name: name,
    text: text,
    likes: 0,
    createdAt: createdAt.toISOString(),
  };
}

// はじめのポストから、1 分ずつ前に書いたことにしたポストを、新しい順に作る。しりとり部屋は、しりとりのポストにする
function createSamplePosts(room: string): Post[] {
  const samples = isShiritoriRoom(room) ? SHIRITORI_SAMPLE_POSTS : SAMPLE_POSTS;
  const posts: Post[] = [];
  const now = Date.now();
  for (let i = 0; i < samples.length; i++) {
    const minutesAgo = samples.length - i;
    const createdAt = new Date(now - minutesAgo * 60 * 1000);
    posts.unshift(newPost(samples[i]!.name, samples[i]!.text, createdAt));
  }
  return posts;
}

// 部屋を「今使った」ことにする。Map は入れた順を覚えているので、入れ直すと最後（新しい側）に移る
// こうしておくと、Map の先頭が「いちばん長く使われていない部屋」になる
// 呼ぶ前に、rooms にその部屋があることを確かめておく
function touchRoom(room: string): Post[] {
  const posts = rooms.get(room)!;
  rooms.delete(room);
  rooms.set(room, posts);
  return posts;
}

// その部屋のポストの配列を返す。はじめての部屋なら、サンプルのポストを入れて作る
// 部屋の数が上限に届いていたら、いちばん長く使われていない部屋を消してから作る
// 新しい部屋を作りすぎている人には null を返す（呼んだ側で 429 にする）
function openRoom(room: string, key: string): Post[] | null {
  if (rooms.has(room)) {
    return touchRoom(room);
  }
  if (!limiters.newRoom.hit(key).ok) {
    return null;
  }
  // （ここで毎回 console.log すると、攻撃のときに記録を書くだけで遅くなるので、書かない）
  while (rooms.size >= LIMITS.maxRooms) {
    rooms.delete(rooms.keys().next().value!);
  }
  const posts = createSamplePosts(room);
  rooms.set(room, posts);
  return posts;
}

// SSE の接続 1 本を listeners から取り除き、その人の接続数を 1 減らす。その部屋に誰もいなくなったら、部屋の記録ごと消す
// 同じ接続を 2 回取り除いても数がずれないよう、本当に取り除けたときだけ数を減らす
function removeListener(connection: Connection): void {
  const connections = listeners.get(connection.room);
  if (!connections || !connections.delete(connection)) {
    return;
  }
  if (connections.size === 0) {
    listeners.delete(connection.room);
  }
  const count = (sseCountByIp.get(connection.key) || 1) - 1;
  if (count <= 0) {
    sseCountByIp.delete(connection.key);
  } else {
    sseCountByIp.set(connection.key, count);
  }
}

// サーバーの側から接続を切る。もう切れていても困らないよう、例外は気にしない
function closeConnection(connection: Connection): void {
  removeListener(connection);
  try {
    connection.controller?.close();
  } catch {
    // すでに閉じている
  }
}

// 相手が読まずに、送る文字がこれ以上溜まったら、その接続を切る（読まない相手にメモリを使わせないため）
const MAX_QUEUED_EVENTS = 32;

// 1 つの接続に文字を送る。もう切れている接続に送ると例外になるので、そのときは取り除く（B9）
function sendEvent(connection: Connection, message: string): void {
  const controller = connection.controller;
  if (!controller) {
    return;
  }
  // desiredSize が null なのは、もう閉じた接続
  if ((controller.desiredSize ?? 0) < -MAX_QUEUED_EVENTS) {
    closeConnection(connection);
    return;
  }
  try {
    controller.enqueue(message);
  } catch {
    removeListener(connection);
  }
}

// その部屋で知らせを待っている画面に、ポストが変わったことを SSE で知らせる
// 送っている途中で取り除くこともあるので、Array.from で写してから回す
function notify(room: string): void {
  const connections = listeners.get(room);
  if (!connections) {
    return;
  }
  for (const connection of Array.from(connections)) {
    sendEvent(connection, 'data: changed\n\n');
  }
}

// サーバー全体の SSE の接続数
function sseTotal(): number {
  let total = 0;
  for (const connections of listeners.values()) {
    total += connections.size;
  }
  return total;
}

// 30 秒ごとに、全部の接続へ「生きているよ」のコメント行を送る（B9）
// Cloudflare などの中継は、しばらく何も流れない接続を切ってしまうため。: で始まる行は、ブラウザが知らせとして扱わない
// ついでに、つないでから sseMaxLifetimeMs を過ぎた接続を切る。ブラウザは retry: の 3 秒後につなぎ直すので、
// ふだんの人は困らない。相手が黙って消えた接続（PC の電源が切れたなど）が、いつまでも残らないようにする
const HEARTBEAT_MS = 30 * 1000;
function sendHeartbeats(): void {
  const now = Date.now();
  for (const connections of Array.from(listeners.values())) {
    for (const connection of Array.from(connections)) {
      if (now - connection.openedAt > LIMITS.sseMaxLifetimeMs) {
        closeConnection(connection);
      } else {
        sendEvent(connection, ': ping\n\n');
      }
    }
  }
}

// 1 分ごとに、回数の制限の古い記録を消す（覚えている人の数が増え続けないように）
function sweepLimiters(): void {
  const now = Date.now();
  for (const limiter of Object.values(limiters)) {
    limiter.sweep(now);
  }
}

// bun --hot で読み込み直すたびにタイマーが増えないよう、前のタイマーを止めてから作る
// 接続の寿命を短くして試すときは、見回りも速くする
clearInterval(globalThis.heartbeatTimer);
globalThis.heartbeatTimer = setInterval(sendHeartbeats, Math.min(HEARTBEAT_MS, LIMITS.sseMaxLifetimeMs));
clearInterval(globalThis.sweepTimer);
globalThis.sweepTimer = setInterval(sweepLimiters, MINUTE);

// 返事に CORS とセキュリティ用のヘッダを付ける
function withHeaders(res: Response): Response {
  for (const [name, value] of Object.entries({ ...CORS_HEADERS, ...SECURITY_HEADERS })) {
    res.headers.set(name, value);
  }
  return res;
}

// オブジェクトを JSON の文字にして返事を作る。status は 200（うまくいった）や 400（頼み方がおかしい）などの番号
function jsonResponse(status: number, body: unknown): Response {
  const res = new Response(JSON.stringify(body), { status: status });
  res.headers.set('Content-Type', 'application/json; charset=utf-8');
  return withHeaders(res);
}

// うまくいかなかったときの返事。何がだめだったかを message に入れて返す
function errorResponse(status: number, message: string): Response {
  return jsonResponse(status, { message: message });
}

// 回数の制限を超えたときの返事（429）。Retry-After に、何秒待てばよいかを入れる
function tooManyRequests(retryAfter: number, message: string): Response {
  const res = errorResponse(429, message);
  res.headers.set('Retry-After', String(retryAfter));
  return res;
}

// 人（IP）ごとに 1 回分を数え、使いすぎなら 429 の返事を、まだ使えるなら null を返す
function checkLimit(limiter: RateLimiter, key: string, message: string): Response | null {
  const result = limiter.hit(key);
  return result.ok ? null : tooManyRequests(result.retryAfter, message);
}

// 部屋の名前を確かめる。だめなら理由の文を、よければ null を返す
function checkRoom(room: string | null): string | null {
  if (!room) {
    return 'room を指定してください（例: /posts?room=sample）';
  }
  if (!ROOM_PATTERN.test(room)) {
    return 'room は英数字とハイフンで1〜32文字にしてください';
  }
  return null;
}

// URL の ?room= から部屋の名前を取り出して確かめる。よければ部屋の名前を、だめなら 400 の返事を返す
// （4 つの API で同じことをするので、ここにまとめた。呼んだ側は instanceof Response で見分ける）
function readRoom(req: Request): string | Response {
  const room = new URL(req.url).searchParams.get('room');
  const roomError = checkRoom(room);
  if (roomError || room === null) {
    return errorResponse(400, roomError ?? 'room を指定してください');
  }
  return room;
}

// 送られてきたポストの名前と本文を確かめる。だめなら理由の文を、よければ null を返す
// body は JSON.parse の結果なので、どんな形か分からない（unknown）。ここで 1 つずつ確かめる
function checkPostBody(body: unknown): string | null {
  // 配列や null ではない、ふつうのオブジェクトで、キーは name と text（夢のたまごなら opensIn も）だけ
  const isPlainObject = typeof body === 'object' && body !== null && !Array.isArray(body);
  const record = (isPlainObject ? body : {}) as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if ((keys !== 'name,text' && keys !== 'name,opensIn,text') || typeof record.name !== 'string' || typeof record.text !== 'string') {
    return 'name と text（夢のたまごなら opensIn も）だけを送ってください（例: {"name": "たろう", "text": "こんにちは"}）';
  }
  // 夢のたまごの時間は、決まった 4 つ（1・10・60・1440 分）のどれか
  if ('opensIn' in record && !isEggDelay(record.opensIn)) {
    return '夢のたまごの時間は 1・10・60・1440（分）から選んでください';
  }
  const name = record.name.trim();
  const text = record.text.trim();
  if (name === '') {
    return '名前を入れてください';
  }
  if (text === '') {
    return '本文を入れてください';
  }
  // string.length は UTF-16 単位で絵文字を 2 文字と数えるので、コードポイントで数える
  if (Array.from(name).length > MAX_NAME_LENGTH) {
    return '名前は' + MAX_NAME_LENGTH + '文字までです';
  }
  if (Array.from(text).length > MAX_TEXT_LENGTH) {
    return '本文は' + MAX_TEXT_LENGTH + '文字までです';
  }
  return null;
}

// 送られてきた本文を JSON として読む。うまくいけば { body }、だめなら { error: 返事 } を返す
// 大きすぎる本文は、全部読む前に断る（Content-Length を見る）。Content-Length を偽る人もいるので、読んだあとも測る
type JsonBodyResult = { body: unknown; error?: undefined } | { body?: undefined; error: Response };
async function readJsonBody(req: Request): Promise<JsonBodyResult> {
  const contentType = req.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return { error: errorResponse(415, 'Content-Type: application/json で送ってください') };
  }
  const tooLarge = errorResponse(413, '送るデータは ' + LIMITS.maxBodyBytes + ' バイトまでです');
  if (Number(req.headers.get('Content-Length')) > LIMITS.maxBodyBytes) {
    return { error: tooLarge };
  }
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > LIMITS.maxBodyBytes) {
    return { error: tooLarge };
  }
  try {
    return { body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { error: errorResponse(400, '送るデータを JSON の文字にしてください（JSON.stringify を使います）') };
  }
}

// ===== 夢のたまご（オリジナル機能 2）。決まりは egg.ts =====

// 夢のたまごを作ってよいかを確かめる。だめなら断る返事を、よければ null を返す
function checkEgg(room: string, posts: Post[], key: string): Response | null {
  // しりとり部屋では使えない（かえったときに先頭に上がると、しりとりのつながりが分からなくなる）
  if (isShiritoriRoom(room)) {
    return errorResponse(400, 'しりとり部屋では、夢のたまごは使えません');
  }
  const limited = checkLimit(limiters.egg, key, '夢のたまごは 1 分に ' + LIMITS.eggsPerMinute + ' 個までです');
  if (limited) {
    return limited;
  }
  const now = Date.now();
  if (posts.filter((post) => isSealed(post, now)).length >= LIMITS.maxEggsPerRoom) {
    return tooManyRequests(60, 'この部屋は、まだかえっていないたまごでいっぱいです。かえるまで待ってください');
  }
  return null;
}

// ポストを夢のたまごにする。かえる時刻を入れ、その時刻になったら hatchEgg を呼ぶタイマーを作る
function layEgg(room: string, post: Post, minutes: number): void {
  const delayMs = minutes * LIMITS.eggMinuteMs;
  post.opensAt = new Date(Date.now() + delayMs).toISOString();
  setTimeout(() => hatchEgg(room, post.id), delayMs);
}

// 夢のたまごがかえる時刻に呼ばれる。そのポストをタイムラインの先頭に動かし、画面に SSE で知らせる
// サーバーを止めると、ポストといっしょにタイマーも消える（メモリにしか無いため）
function hatchEgg(room: string, id: string): void {
  const posts = rooms.get(room);
  const index = posts ? posts.findIndex((post) => post.id === id) : -1;
  // 部屋が消えた・古いポストとして消えたときは、何もしない
  if (!posts || index === -1) {
    return;
  }
  const [egg] = posts.splice(index, 1);
  posts.unshift(egg!);
  notify(room);
}

// GET /posts?room=部屋の名前：その部屋のポストの一覧を、新しい順に返す
function getPosts(req: Request, server: MinixServer): Response {
  const key = ipKey(clientIp(req, server, TRUST_LOCAL_PROXY));
  const limited = checkLimit(limiters.read, key, '一覧の取得が多すぎます。少し待ってください');
  if (limited) {
    return limited;
  }
  const room = readRoom(req);
  if (room instanceof Response) {
    return room;
  }
  const posts = openRoom(room, key);
  if (!posts) {
    return tooManyRequests(60, '新しい部屋を作りすぎています。少し待ってください');
  }
  // まだかえっていない夢のたまごは、本文を送らない（オリジナル機能 2）
  const now = Date.now();
  return jsonResponse(200, posts.map((post) => toPublicPost(post, now)));
}

// POST /posts?room=部屋の名前：送られてきたポストを保存して、保存したポストを返す
async function createPost(req: Request, server: MinixServer): Promise<Response> {
  // 1. 回数の制限。断られたポストも 1 回と数える（間違ったデータの連打も防ぐため）
  const key = ipKey(clientIp(req, server, TRUST_LOCAL_PROXY));
  const limited = checkLimit(limiters.post, key, 'ポストが多すぎます。少し待ってください');
  if (limited) {
    return limited;
  }

  // 2. 部屋の名前を確かめる
  const room = readRoom(req);
  if (room instanceof Response) {
    return room;
  }

  // 3. 送られてきた中身を JSON として読む（大きすぎる・JSON でないなら断る）
  const { body, error } = await readJsonBody(req);
  if (error) {
    return error;
  }
  // 4. 名前と本文が入っているか、長すぎないかを確かめる
  const bodyError = checkPostBody(body);
  if (bodyError) {
    return errorResponse(400, bodyError);
  }
  const input = body as PostInput;

  // 5. 新しいポストを作って配列の先頭に入れる。多すぎたら、いちばん古いポストを消す
  const posts = openRoom(room, key);
  if (!posts) {
    return tooManyRequests(60, '新しい部屋を作りすぎています。少し待ってください');
  }
  const text = input.text.trim();
  // しりとり部屋なら、いちばん新しいポストの最後の字から始まっているかを確かめる（オリジナル機能 1）
  // ここから unshift までは await を挟まないので、2 人が同時に送っても、2 人目は 1 人目のことばにつながっているかで確かめられる
  if (isShiritoriRoom(room)) {
    const shiritoriError = checkShiritori(posts[0]?.text ?? null, text);
    if (shiritoriError) {
      return errorResponse(400, shiritoriError);
    }
  }
  // 夢のたまごなら、作ってよいかを確かめる（オリジナル機能 2）
  if (input.opensIn !== undefined) {
    const eggError = checkEgg(room, posts, key);
    if (eggError) {
      return eggError;
    }
  }
  const post = newPost(input.name.trim(), text, new Date());
  if (input.opensIn !== undefined) {
    layEgg(room, post, input.opensIn);
  }
  posts.unshift(post);
  if (posts.length > MAX_POSTS_PER_ROOM) {
    posts.pop();
  }
  // 6. 同じ部屋の画面に SSE で知らせ、作ったポストを 201（作った）で返す
  notify(room);
  return jsonResponse(201, toPublicPost(post, Date.now()));
}

// POST /posts/:id/like?room=部屋の名前：その id のポストのいいねを 1 増やして返す
function likePost(req: BunRequest<'/posts/:id/like'>, server: MinixServer): Response {
  const key = ipKey(clientIp(req, server, TRUST_LOCAL_PROXY));
  const limited = checkLimit(limiters.like, key, 'いいねが多すぎます。少し待ってください');
  if (limited) {
    return limited;
  }
  const room = readRoom(req);
  if (room instanceof Response) {
    return room;
  }

  // いいねでは部屋を作らない（無い部屋なら、そのポストも無い）
  if (!rooms.has(room)) {
    return errorResponse(404, 'その id の投稿は見つかりません');
  }
  // URL の :id の部分は req.params.id に入っている。同じ id のポストを探す
  const post = touchRoom(room).find((p) => p.id === req.params.id);
  if (!post) {
    return errorResponse(404, 'その id の投稿は見つかりません');
  }
  // まだかえっていない夢のたまごには、いいねできない（中身が見えないので）
  if (isSealed(post, Date.now())) {
    return errorResponse(400, 'まだかえっていない夢のたまごには、いいねできません');
  }
  // 同じ人が同じポストを続けて押したら断る（連打でいいねを増やせないように）
  const sameLimited = checkLimit(limiters.sameLike, key + ' ' + room + ' ' + post.id, '同じポストへのいいねは、少し待ってから押してください');
  if (sameLimited) {
    return sameLimited;
  }
  post.likes += 1;
  notify(room);
  return jsonResponse(200, post);
}

// GET /posts/events?room=部屋の名前：接続をつないだままにして、ポストが変わるたびに知らせる（SSE）
function getEvents(req: Request, server: MinixServer): Response {
  const key = ipKey(clientIp(req, server, TRUST_LOCAL_PROXY));
  const limited = checkLimit(limiters.sseConnect, key, 'つなぎ直しが多すぎます。少し待ってください');
  if (limited) {
    return limited;
  }
  const room = readRoom(req);
  if (room instanceof Response) {
    return room;
  }
  // 接続数の上限。全体があふれたら 503（今は混んでいる）、1 人が開きすぎたら 429
  if (sseTotal() >= LIMITS.maxSseTotal) {
    const res = errorResponse(503, '今は混んでいます。しばらくしてからつないでください');
    res.headers.set('Retry-After', '30');
    return res;
  }
  if ((sseCountByIp.get(key) || 0) >= LIMITS.maxSsePerIp) {
    return tooManyRequests(30, '同時につなげるのは ' + LIMITS.maxSsePerIp + ' 本までです');
  }

  // 知らせのない間が idleTimeout（10 秒）を超えると Bun.serve が接続を切るので、この接続だけ止める
  // 代わりに、sendHeartbeats が寿命（sseMaxLifetimeMs）を過ぎた接続を切る
  server.timeout(req, 0);
  // つないでいるあいだは listeners に入れておき、画面が閉じられたら取り除く
  const connection: Connection = { room: room, key: key, openedAt: Date.now(), controller: null };
  const stream = new ReadableStream<string>({
    start(controller) {
      connection.controller = controller;
      let connections = listeners.get(room);
      if (!connections) {
        connections = new Set();
        listeners.set(room, connections);
      }
      connections.add(connection);
      sseCountByIp.set(key, (sseCountByIp.get(key) || 0) + 1);
      // retry: は、切れたときにブラウザが何ミリ秒後につなぎ直すか（B9）
      controller.enqueue('retry: 3000\n: connected\n\n');
    },
    cancel() {
      removeListener(connection);
    },
  });

  // text/event-stream という種類の返事にすると、ブラウザは EventSource で受け取れる
  const res = new Response(stream);
  res.headers.set('Content-Type', 'text/event-stream');
  res.headers.set('Cache-Control', 'no-cache');
  return withHeaders(res);
}

// script.ts から型を取り除いて JavaScript にする道具（B6）。ファイルを 1 つにまとめる（バンドル）ことはしない
const transpiler = new Bun.Transpiler({ loader: 'ts' });
// 直した結果を、ファイルの更新時刻といっしょに覚えておく。頼まれるたびに直すと CPU を使うので、
// ファイルが書き換わった（更新時刻が変わった）ときだけ直し直す
const transpiledCache = new Map<string, { modified: number; code: string }>();

async function toJavaScript(file: BunFile, path: string): Promise<string> {
  const cached = transpiledCache.get(path);
  if (cached && cached.modified === file.lastModified) {
    return cached.code;
  }
  const code = await transpiler.transform(await file.text());
  transpiledCache.set(path, { modified: file.lastModified, code: code });
  return code;
}

// 画面のファイル（index.html など）を、セキュリティ用のヘッダを付けて配る
// 毎回ファイルを見るので、script.ts を書き換えたら、再読み込みだけで新しいものが届く
async function serveStatic(req: Request): Promise<Response> {
  const entry = STATIC_FILES[new URL(req.url).pathname]!;
  const file = Bun.file(import.meta.dir + '/' + entry.file);
  const res = new Response(entry.transpile ? await toJavaScript(file, entry.file) : file);
  res.headers.set('Content-Type', entry.type);
  res.headers.set('Cache-Control', 'no-cache');
  return withHeaders(res);
}

// React 版（B10・B11）のファイルを /react/ で配る。中身は react/dist（react フォルダで bun run build を実行して作る）
// ファイルの名前は英数字とハイフンと拡張子だけにする（../ などで、ほかの場所のファイルを読まれないように）
const REACT_DIST = import.meta.dir + '/react/dist/';
const REACT_FILE_PATTERN = /^[A-Za-z0-9-]+\.(html|js|css|svg)$/;
const REACT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
};

async function serveReact(req: Request): Promise<Response> {
  const name = new URL(req.url).pathname.slice('/react/'.length) || 'index.html';
  const match = REACT_FILE_PATTERN.exec(name);
  const file = Bun.file(REACT_DIST + name);
  if (!match || !(await file.exists())) {
    return errorResponse(404, 'その URL はありません');
  }
  const res = new Response(file);
  res.headers.set('Content-Type', REACT_TYPES[match[1]!]!);
  // index.html 以外は、中身が変わると名前（index-xxxx.js の xxxx）も変わるので、ブラウザに長く覚えさせてよい
  res.headers.set('Cache-Control', name === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
  return withHeaders(res);
}

// /react を開かれたら /react/ に移ってもらう（index.html の中の ./ で始まるファイルの場所が合うように）
function redirectToReact(): Response {
  return withHeaders(new Response(null, { status: 301, headers: { Location: '/react/' } }));
}

// ブラウザが POST の前に「送ってもいいか」を OPTIONS で聞いてくるので、いいよと返す
function preflight(): Response {
  return withHeaders(new Response(null, { status: 204 }));
}

// URL は合っているが、頼み方（GET や POST）が違うときの返事
function methodNotAllowed(methods: string): Response {
  const res = errorResponse(405, 'この URL には ' + methods + ' で送ってください');
  res.headers.set('Allow', methods + ', OPTIONS');
  return res;
}

// /posts/なにか/like の形の URL かどうかを確かめる
function isLikePath(pathname: string): boolean {
  const parts = pathname.split('/');
  return parts.length === 4 && parts[1] === 'posts' && parts[2] !== '' && parts[3] === 'like';
}

// routes のどれにも当てはまらない頼みごとに答える
// routes に無いメソッドもここに来るので、パスが合っていれば 404 ではなく 405 を返す
function notFound(req: Request): Response {
  const pathname = new URL(req.url).pathname;
  if (pathname === '/posts') {
    return methodNotAllowed('GET, POST');
  }
  if (pathname === '/posts/events') {
    return methodNotAllowed('GET');
  }
  if (isLikePath(pathname)) {
    return methodNotAllowed('POST');
  }
  return errorResponse(404, 'その URL はありません。/posts を使ってください');
}

// 思いがけない例外が起きたときの返事。中身（スタックトレースやファイルの場所）は返さず、サーバーの記録にだけ残す
function serverError(error: Error): Response {
  console.error('思いがけないエラー:', error);
  return errorResponse(500, 'サーバーで問題が起きました。しばらくしてからもう一度試してください');
}

// 画面のファイルの URL ごとに、serveStatic で答える表を作る
const staticRoutes: Record<string, { GET: typeof serveStatic }> = {};
for (const path of Object.keys(STATIC_FILES)) {
  staticRoutes[path] = { GET: serveStatic };
}

// サーバーを立てる。PORT を決めていなければ 8000 番で待つ
const server = Bun.serve({
  port: Number(process.env.PORT || 8000),
  // 公開するときは HOST=127.0.0.1 にして、同じサーバーの中継（Cloudflare Tunnel など）からだけ受ける
  hostname: process.env.HOST || '0.0.0.0',
  // 開発用のエラー画面（スタックトレース入り）を出さない
  development: false,
  // 本文の大きさの上限。これを超える本文は、Bun が読み込む前に 413 で断る
  maxRequestBodySize: LIMITS.maxRequestBodyBytes,
  // 何も送ってこない接続は 10 秒で切る（少しずつ送ってつなぎっぱなしにする攻撃〔Slowloris〕を防ぐ）
  idleTimeout: 10,
  // URL と頼み方（GET や POST）ごとに、どの関数で答えるかの表
  routes: {
    ...staticRoutes,
    '/react': { GET: redirectToReact },
    '/react/*': { GET: serveReact },
    '/posts': {
      GET: getPosts,
      POST: createPost,
      OPTIONS: preflight,
    },
    '/posts/events': {
      GET: getEvents,
    },
    '/posts/:id/like': {
      POST: likePost,
      OPTIONS: preflight,
    },
  },
  // 表にない URL や頼み方は notFound で答える
  fetch: notFound,
  // どこかで例外が起きたら serverError で答える
  error: serverError,
});

console.log('ミニX を http://localhost:' + server.port + '/ で起動しました');
