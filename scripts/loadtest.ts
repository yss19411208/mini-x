// 短い負荷試験（連打）。サーバーを立て、いろいろな連打をして、落ちないこととメモリが増え続けないことを確かめる
// 使い方: bun scripts/loadtest.js [サーバーのファイル（決めなければ server.js）]
// 手元の PC だけで動かす。公開しているサーバーには向けないこと
//
// 試すこと（それぞれ ROUND_MS ミリ秒）
//   1. flood   : 1 人が、一覧・ポスト・いいねを同時に 50 本ずつ連打する
//   2. rooms   : 毎回違う人が、毎回違う部屋の一覧を取る（部屋を無限に作らせる攻撃）
//   3. fill    : 毎回違う人が、600 の部屋に 140 字のポストを送る（部屋をポストで満たす攻撃）
//   4. sse     : 毎回違う人が、SSE を 700 本つなぐ
// 2 と 3 は 2 回くり返し、1 回目と 2 回目の後でメモリを比べる（増え続けるなら、2 回目でも増える）
// 「毎回違う人」は CF-Connecting-IP で名乗る。サーバーは MINIX_TRUST_LOCAL_PROXY=1 で、それを信じる設定で立てる

const PORT = 8790;
const BASE = 'http://localhost:' + PORT;
const ROUND_MS = 8000;
const CONCURRENCY = 50;
const serverFile = process.argv[2] || 'server.js';

// サーバーを立てる（cwd はサーバーのファイルのあるフォルダ）
const path = await import('node:path');
const serverProcess = Bun.spawn(['bun', path.basename(serverFile)], {
  cwd: path.dirname(path.resolve(serverFile)),
  env: { ...process.env, PORT: String(PORT), MINIX_TRUST_LOCAL_PROXY: '1' },
  stdout: 'ignore',
  stderr: 'ignore',
});

// サーバーのメモリ（Windows の作業セット、MB）。PowerShell で、そのプロセスだけを調べる
function serverMemoryMb() {
  const result = Bun.spawnSync(['powershell', '-NoProfile', '-Command', '(Get-Process -Id ' + serverProcess.pid + ').WorkingSet64']);
  return Math.round(Number(result.stdout.toString().trim()) / 1024 / 1024);
}

// 毎回違う IP を作る（試験用に予約された 198.18.0.0/15 の範囲。6 万人を超えたら 198.19 に移る）
let ipCounter = 0;
function nextIp() {
  const n = ipCounter++;
  return '198.' + (18 + ((n >> 16) & 1)) + '.' + ((n >> 8) & 255) + '.' + (n & 255);
}

// 決めた時間だけ、CONCURRENCY 本で makeRequest を回し続け、返事の番号ごとの数を返す
async function hammer(makeRequest) {
  const counts = {};
  const end = Date.now() + ROUND_MS;
  async function worker() {
    while (Date.now() < end) {
      let key;
      try {
        const res = await makeRequest();
        await res.arrayBuffer();
        key = String(res.status);
      } catch {
        key = 'error';
      }
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return counts;
}

function post(room, ip) {
  return fetch(BASE + '/posts?room=' + room, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ name: 'loadtest', text: 'あ'.repeat(140) }),
  });
}

const results = [];
function record(name, counts) {
  const memory = serverMemoryMb();
  results.push({ name, counts, memory });
  console.log(name.padEnd(8), 'メモリ', String(memory).padStart(4), 'MB', JSON.stringify(counts));
}

// 起動を待つ
for (let i = 0; i < 50; i++) {
  try {
    await fetch(BASE + '/posts?room=load');
    break;
  } catch {
    await Bun.sleep(100);
  }
}
record('start', {});

// 1. 1 人の連打
const victim = await (await fetch(BASE + '/posts?room=load')).json();
let turn = 0;
record('flood', await hammer(() => {
  turn += 1;
  const ip = '203.0.113.7';
  if (turn % 3 === 0) {
    return post('load', ip);
  }
  if (turn % 3 === 1) {
    return fetch(BASE + '/posts/' + victim[0].id + '/like?room=load', { method: 'POST', headers: { 'CF-Connecting-IP': ip } });
  }
  return fetch(BASE + '/posts?room=load', { headers: { 'CF-Connecting-IP': ip } });
}));

// 2・3 を 2 回くり返す
let roomCounter = 0;
for (const round of [1, 2]) {
  record('rooms' + round, await hammer(() => {
    roomCounter += 1;
    return fetch(BASE + '/posts?room=r' + roomCounter, { headers: { 'CF-Connecting-IP': nextIp() } });
  }));
  record('fill' + round, await hammer(() => post('fill' + Math.floor(Math.random() * 600), nextIp())));
}

// 4. SSE を 700 本つなぐ（つないだまま持っておく）
// Bun の fetch は同じ相手への同時接続の数に上限があり、つなぎっぱなしの SSE を何百本も開けないので、
// ここだけは TCP の接続を直接開いて、HTTP の頼みごとを手で書く。返事の 1 行目（HTTP/1.1 200 OK など）で番号を数える
const net = await import('node:net');
function openSse(ip) {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, '127.0.0.1');
    socket.once('connect', () => {
      socket.write('GET /posts/events?room=load HTTP/1.1\r\nHost: localhost\r\nCF-Connecting-IP: ' + ip + '\r\n\r\n');
    });
    socket.once('data', (chunk) => {
      resolve({ status: chunk.toString().split(' ')[1], socket });
    });
    socket.once('error', () => resolve({ status: 'error', socket }));
  });
}
const sockets = [];
const sseCounts = {};
for (let i = 0; i < 700; i++) {
  const { status, socket } = await openSse(nextIp());
  sseCounts[status] = (sseCounts[status] || 0) + 1;
  sockets.push(socket);
}
record('sse', sseCounts);
for (const socket of sockets) {
  socket.destroy();
}

// 落ち着くのを待ってから、まだ答えるかを確かめる
Bun.gc(true);
await Bun.sleep(3000);
const alive = await fetch(BASE + '/posts?room=after', { headers: { 'CF-Connecting-IP': nextIp() } });
record('after', { alive: alive.status });

serverProcess.kill();
