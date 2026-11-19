// 攻撃に備えた上限（feat/hardening）を確かめるテスト。bun test で動かす
// 上限を小さくしたサーバーを別のポートで立て、上限を超えたら 429・413 などで断ることを確かめる
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

// テスト用の小さな上限
const SMALL_LIMITS = {
  MINIX_POSTS_PER_MINUTE: '3',
  MINIX_LIKES_PER_MINUTE: '5',
  MINIX_READS_PER_MINUTE: '10',
  MINIX_NEW_ROOMS_PER_MINUTE: '5',
  MINIX_MAX_ROOMS: '3',
  MINIX_MAX_SSE_PER_IP: '2',
  MINIX_MAX_SSE_TOTAL: '4',
  MINIX_SSE_MAX_LIFETIME_MS: '1500',
  MINIX_EGGS_PER_MINUTE: '2',
  MINIX_MAX_EGGS_PER_ROOM: '3',
};

// trusted: 同じ PC の中継から来たときに CF-Connecting-IP を信じるサーバー（テストでは「人」をヘッダで分けられる）
// untrusted: ヘッダを信じないサーバー（ふだんの設定。ヘッダを書き換えても制限をすり抜けられないことを確かめる）
const TRUSTED: TestServer = { port: 8766, env: { ...SMALL_LIMITS, MINIX_TRUST_LOCAL_PROXY: '1' } };
const UNTRUSTED: TestServer = { port: 8767, env: { ...SMALL_LIMITS } };
type TestServer = { port: number; env: Record<string, string> };
const processes: ReturnType<typeof Bun.spawn>[] = [];

// テストのたびに違う「人」（IP）にして、ほかのテストの回数と混ざらないようにする
let ipCounter = 0;
function newIp() {
  ipCounter += 1;
  return '198.51.100.' + ipCounter;
}

// サーバーを立てて、返事をするようになるまで待つ
async function startServer({ port, env }: TestServer): Promise<void> {
  processes.push(Bun.spawn(['bun', 'server.ts'], {
    cwd: import.meta.dir,
    env: { ...process.env, ...env, PORT: String(port) },
    stdout: 'ignore',
    stderr: 'inherit',
  }));
  for (let i = 0; i < 50; i++) {
    try {
      await fetch('http://localhost:' + port + '/');
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error(port + ' 番のテスト用サーバーが起動しませんでした');
}

// trusted のサーバーに、ip の人として頼みごとを送る
function request(path: string, ip: string, options: RequestInit = {}, port = TRUSTED.port): Promise<Response> {
  const headers = { 'CF-Connecting-IP': ip, ...((options.headers as Record<string, string>) || {}) };
  return fetch('http://localhost:' + port + path, { ...options, headers: headers });
}

// ポストを 1 件送る
// body に文字を渡すと、JSON にせずそのまま送る（壊れた JSON を試すため）
function sendPost(room: string, ip: string, body: object | string = { name: 'たろう', text: 'こんにちは' }, port = TRUSTED.port): Promise<Response> {
  return request('/posts?room=' + room, ip, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }, port);
}

beforeAll(async () => {
  await Promise.all([startServer(TRUSTED), startServer(UNTRUSTED)]);
});

afterAll(() => {
  for (const serverProcess of processes) {
    serverProcess.kill();
  }
});

describe('回数の制限（429）', () => {
  test('ポストは 1 分に 3 回まで。4 回目は 429 と Retry-After', async () => {
    const ip = newIp();
    for (let i = 0; i < 3; i++) {
      expect((await sendPost('limit-post', ip)).status).toBe(201);
    }
    const res = await sendPost('limit-post', ip);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    // 別の人はまだポストできる
    expect((await sendPost('limit-post', newIp())).status).toBe(201);
  });

  test('一覧の取得は 1 分に 10 回まで', async () => {
    const ip = newIp();
    for (let i = 0; i < 10; i++) {
      expect((await request('/posts?room=limit-read', ip)).status).toBe(200);
    }
    expect((await request('/posts?room=limit-read', ip)).status).toBe(429);
  });

  test('同じポストへのいいねの連打は 2 回目から 429', async () => {
    const ip = newIp();
    const post = await (await sendPost('limit-like', ip)).json();
    const like = () => request('/posts/' + post.id + '/like?room=limit-like', ip, { method: 'POST' });
    expect((await like()).status).toBe(200);
    expect((await like()).status).toBe(429);
    // 別の人のいいねは数える
    const other = await request('/posts/' + post.id + '/like?room=limit-like', newIp(), { method: 'POST' });
    expect((await other.json()).likes).toBe(2);
  });

  test('いいねは全部で 1 分に 5 回まで（ポストを変えても）', async () => {
    const ip = newIp();
    const posts = await (await request('/posts?room=limit-likes', newIp())).json();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const post = posts[i % posts.length];
      const res = await request('/posts/' + post.id + '/like?room=limit-likes', ip, { method: 'POST' });
      statuses.push(res.status);
    }
    expect(statuses[5]).toBe(429);
  });

  test('ヘッダを信じないサーバーでは、CF-Connecting-IP を変えても制限をすり抜けられない', async () => {
    // 同じ PC から、毎回違う IP を名乗って送る
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await sendPost('spoof', newIp(), undefined, UNTRUSTED.port)).status);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
  });
});

describe('送るデータの大きさと形', () => {
  test('4096 バイトを超える本文は 413', async () => {
    const res = await sendPost('body', newIp(), 'a'.repeat(5000));
    expect(res.status).toBe(413);
  });

  test('とても大きな本文（200KB）も断られ、サーバーは落ちない', async () => {
    // Bun は 64KB を超える本文を、読み終わる前に 413 で断って接続を切る。送っている途中で切られると、
    // 送った側には 413 が届かず「接続が切れた（ECONNRESET）」になることがある。どちらも「断られた」とみなす
    let result: number | string;
    try {
      result = (await sendPost('body', newIp(), 'a'.repeat(200 * 1024))).status;
    } catch (error) {
      result = (error as { code?: string }).code ?? 'error';
    }
    expect([413, 'ECONNRESET']).toContain(result);
    expect((await request('/posts?room=body', newIp())).status).toBe(200);
  });

  test('Content-Type が JSON でなければ 415', async () => {
    const res = await request('/posts?room=body', newIp(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ name: 'a', text: 'b' }),
    });
    expect(res.status).toBe(415);
  });

  test('name と text 以外のキー・配列・JSON でない文字は 400', async () => {
    expect((await sendPost('body', newIp(), { name: 'a', text: 'b', likes: 999 })).status).toBe(400);
    expect((await sendPost('body', newIp(), '["a", "b"]')).status).toBe(400);
    expect((await sendPost('body', newIp(), '{name:')).status).toBe(400);
  });
});

describe('部屋の数の上限（3 部屋）', () => {
  test('4 つ目の部屋を作ると、いちばん長く使われていない部屋が消える', async () => {
    const ip = newIp();
    const first = await (await sendPost('room-old', ip, { name: 'a', text: '消えるはず' })).json();
    await sendPost('room-keep', ip);
    await request('/posts?room=room-new1', ip);
    // room-keep を使い直すと、新しい側に回る
    await request('/posts?room=room-keep', ip);
    await request('/posts?room=room-new2', ip);
    // room-old のポストは無くなっている
    const res = await request('/posts/' + first.id + '/like?room=room-old', newIp(), { method: 'POST' });
    expect(res.status).toBe(404);
    // room-keep は残っている（自分のポストが先頭にある）
    const keep = await (await request('/posts?room=room-keep', newIp())).json();
    expect(keep[0].text).toBe('こんにちは');
  });

  test('1 人が新しい部屋を 1 分に 6 つ作ろうとすると 429', async () => {
    const ip = newIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await request('/posts?room=many-' + i, ip)).status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});

describe('SSE の接続数', () => {
  // SSE をつなぎ、返事と読み手を返す
  // つなげなかったとき（429 など）は reader が無いので、閉じるときは close を使う
  async function connect(ip: string) {
    const res = await request('/posts/events?room=sse', ip);
    const reader = res.status === 200 ? res.body!.getReader() : null;
    return { status: res.status, reader: reader, close: async () => { await reader?.cancel(); } };
  }

  test('1 人 2 本まで。3 本目は 429。1 本閉じればまたつなげる', async () => {
    const ip = newIp();
    const a = await connect(ip);
    const b = await connect(ip);
    const c = await connect(ip);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 429]);
    await a.close();
    // 閉じたことがサーバーに伝わるまで、少し待ちながら試す
    let again = await connect(ip);
    for (let i = 0; i < 20; i++) {
      if (again.status === 200) {
        break;
      }
      await Bun.sleep(100);
      again = await connect(ip);
    }
    expect(again.status).toBe(200);
    await b.close();
    await again.close();
  });

  test('全体で 4 本まで。5 本目は 503', async () => {
    const opened = [];
    for (let i = 0; i < 4; i++) {
      opened.push(await connect(newIp()));
    }
    const fifth = await connect(newIp());
    expect(opened.map((o) => o.status)).toEqual([200, 200, 200, 200]);
    expect(fifth.status).toBe(503);
    for (const o of opened) {
      await o.close();
    }
  });

  test('寿命（1.5 秒）を過ぎた接続は、サーバーから切られる', async () => {
    await Bun.sleep(500);
    const { status, reader } = await connect(newIp());
    expect(status).toBe(200);
    const started = Date.now();
    // 切られるまで読み続ける（ping が来ても読み続ける）
    while (true) {
      const { done } = await reader!.read();
      if (done) {
        break;
      }
      if (Date.now() - started > 6000) {
        throw new Error('6 秒たっても切られませんでした');
      }
    }
    expect(Date.now() - started).toBeLessThan(6000);
  });
});

describe('エラーの返事とヘッダ', () => {
  test('ない URL は 404 で、送った URL をそのまま返さない', async () => {
    const res = await request('/<script>alert(1)</script>', newIp());
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<script>');
  });

  test('画面と API の返事にセキュリティ用のヘッダが付く', async () => {
    for (const path of ['/', '/posts?room=headers']) {
      const res = await request(path, newIp());
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    }
  });
});

describe('夢のたまごの上限（オリジナル機能 2）', () => {
  const egg = { name: 'たろう', text: 'ひみつ', opensIn: 1 };

  test('1 人が 1 分に作れるたまごは 2 個まで', async () => {
    const ip = newIp();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await sendPost('egg-limit', ip, egg)).status);
    }
    expect(statuses).toEqual([201, 201, 429]);
  });

  test('1 部屋の、まだかえっていないたまごは 3 個まで', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await sendPost('egg-room', newIp(), egg)).status);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
    // ふつうのポストはできる
    expect((await sendPost('egg-room', newIp())).status).toBe(201);
  });
});

