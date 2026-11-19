// server.ts の入力チェックを確かめるテスト。bun test で動かす
// 本物のサーバーを別のポートで立て、fetch で頼みごとを送って、返事を確かめる
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

// ふだんの 8000 番と重ならないポートでテスト用のサーバーを立てる
const PORT = 8765;
const BASE = 'http://localhost:' + PORT;
// テストのたびに新しい部屋を使い、ほかのテストのポストと混ざらないようにする
const ROOM = 'test-' + Date.now();

let serverProcess: ReturnType<typeof Bun.spawn>;

// サーバーが返事をするようになるまで、少しずつ待つ
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(BASE + '/posts?room=' + ROOM);
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error('テスト用のサーバーが起動しませんでした');
}

// ポストを 1 件送り、返事を返す
function sendPost(name: string, text: string, room = ROOM): Promise<Response> {
  return fetch(BASE + '/posts?room=' + room, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, text: text }),
  });
}

beforeAll(async () => {
  serverProcess = Bun.spawn(['bun', 'server.ts'], {
    cwd: import.meta.dir,
    // このテストは同じ PC から何十回も送るので、回数の制限は大きくしておく（制限は hardening.test.js で確かめる）
    env: {
      ...process.env,
      PORT: String(PORT),
      MINIX_POSTS_PER_MINUTE: '1000',
      MINIX_LIKES_PER_MINUTE: '1000',
      MINIX_READS_PER_MINUTE: '1000',
    },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  await waitForServer();
});

afterAll(() => {
  serverProcess.kill();
});

describe('本文の長さ（140字まで）', () => {
  test('140字ちょうどは保存できる', async () => {
    const res = await sendPost('たろう', 'あ'.repeat(140));
    expect(res.status).toBe(201);
  });

  test('141字は 400 で断られる', async () => {
    const res = await sendPost('たろう', 'あ'.repeat(141));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('140');
  });

  test('絵文字は 1 字と数える（絵文字 140 個は保存できる）', async () => {
    // '😀'.length は 2 なので、length で数えると 280 字になってしまう
    const res = await sendPost('たろう', '😀'.repeat(140));
    expect(res.status).toBe(201);
  });

  test('空白だけの本文は断られる', async () => {
    const res = await sendPost('たろう', '   ');
    expect(res.status).toBe(400);
  });
});

describe('名前（20字まで）', () => {
  test('21字の名前は断られる', async () => {
    const res = await sendPost('な'.repeat(21), 'こんにちは');
    expect(res.status).toBe(400);
  });

  test('空の名前は断られる', async () => {
    const res = await sendPost('', 'こんにちは');
    expect(res.status).toBe(400);
  });
});

describe('部屋の名前と id', () => {
  test('使えない文字の部屋名は断られる', async () => {
    const res = await sendPost('たろう', 'こんにちは', 'へや');
    expect(res.status).toBe(400);
  });

  test('ない id へのいいねは 404', async () => {
    const res = await fetch(BASE + '/posts/no-such-id/like?room=' + ROOM, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('ポストした時刻（B2 で使う createdAt）', () => {
  test('保存したポストに、今の時刻の createdAt が付く', async () => {
    const before = Date.now();
    const res = await sendPost('はなこ', '時刻のテスト');
    const post = await res.json();
    const createdAt = new Date(post.createdAt).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before - 1000);
    expect(createdAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('一覧は新しい順に並ぶ', async () => {
    const res = await fetch(BASE + '/posts?room=' + ROOM);
    const posts = await res.json();
    expect(posts[0].text).toBe('時刻のテスト');
    for (let i = 1; i < posts.length; i++) {
      expect(posts[i - 1].createdAt >= posts[i].createdAt).toBe(true);
    }
  });
});

// SSE の接続から、ある文字が届くまで読み進める。届かなければ 3 秒であきらめて失敗にする
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string): Promise<string> {
  const decoder = new TextDecoder();
  let received = '';
  const deadline = Date.now() + 3000;
  while (!received.includes(expected)) {
    if (Date.now() > deadline) {
      throw new Error(expected + ' が届きませんでした。届いたのは: ' + received);
    }
    const { value, done } = await reader.read();
    if (done) {
      throw new Error('接続が切れました。届いたのは: ' + received);
    }
    received += decoder.decode(value);
  }
  return received;
}

describe('SSE の知らせ（B9）', () => {
  test('つなぐと retry の指定が届き、ポストといいねのたびに changed が届く', async () => {
    const room = ROOM + '-sse';
    const res = await fetch(BASE + '/posts/events?room=' + room);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    try {
      expect(await readUntil(reader, ': connected')).toContain('retry: 3000');

      const post = await (await sendPost('じろう', 'SSE のテスト', room)).json();
      await readUntil(reader, 'data: changed');

      await fetch(BASE + '/posts/' + post.id + '/like?room=' + room, { method: 'POST' });
      await readUntil(reader, 'data: changed');
    } finally {
      await reader.cancel();
    }
  });

  test('使えない部屋名ではつなげない', async () => {
    const res = await fetch(BASE + '/posts/events?room=' + encodeURIComponent('へや'));
    expect(res.status).toBe(400);
  });
});

describe('画面のファイル（B6）', () => {
  test('script.ts は、型を取り除いた JavaScript として配られる', async () => {
    const res = await fetch(BASE + '/script.ts');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/javascript');
    const code = await res.text();
    expect(code).toContain('function showPosts');
    // 型の書き方（type Post = { ... } や : string）が残っていない
    expect(code).not.toContain('type Post');
    expect(code).not.toContain('): Promise<void>');
  });

  test('index.html は script.ts を読み込む', async () => {
    const html = await (await fetch(BASE + '/')).text();
    expect(html).toContain('src="script.ts"');
  });
});
