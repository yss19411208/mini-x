// ミニX の動きを書くファイル。サーバーとポストをやりとりして、タイムラインに並べる
// API はサーバーの場所（URL）、ROOM は部屋の名前。同じ部屋の人どうしで、ポストが見える
const API = 'http://localhost:8000';
const ROOM = 'sample';
// 本文の長さの上限。server.js の MAX_TEXT_LENGTH と同じ数にする（B1）
const MAX_TEXT_LENGTH = 140;
// タイムラインを自動で取り直す間隔（ミリ秒）。10 秒（B4）
const AUTO_RELOAD_MS = 10 * 1000;
// アイコンの背景の色（B7）。白い太字が読めるよう、濃いめの色を 8 つ並べる
const AVATAR_COLORS = ['#7856ff', '#d6336c', '#1971c2', '#2f9e44', '#e8590c', '#ae3ec9', '#0c8599', '#495057'];
// 自分がいいねしたポストの id を、ブラウザ（localStorage）に保存するときの名前。部屋ごとに分ける（B8）
const LIKED_KEY = 'minix-liked-' + ROOM;
// SSE が切れて、ブラウザがつなぎ直すのを諦めたときに、自分でつなぎ直すまでの待ち時間。1 秒から倍々で、最大 30 秒（B9）
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30 * 1000;

// 名前から、アイコンの背景の色を 1 つ選ぶ（B7）
// 名前の全部の文字の番号（コードポイント）を混ぜた数を、色の数で割った余りで選ぶ。同じ名前なら、いつも同じ色になる
// 1 文字目だけだと「たろう」と「たけし」が同じ色になるので、全部の文字を使う
// 混ぜ方は djb2 という有名な作り方（5381 から始め、33 を掛けて文字の番号を足す）。33 を掛けるので、文字の並び順でも数が変わる
// 数が大きくなりすぎないよう、毎回 1000003（素数）で割った余りにする
function avatarColor(name) {
  let hash = 5381;
  for (const char of name) {
    hash = (hash * 33 + char.codePointAt(0)) % 1000003;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// 名前の 1 文字目を返す（B7）。name[0] だと絵文字（😀）が半分に切れて文字化けするので、Array.from で 1 字ずつに分ける
function initialOf(name) {
  return Array.from(name)[0];
}

// ブラウザに保存してある「自分がいいねしたポストの id」を読み出す（B8）
// 保存がない・壊れている・ブラウザが保存を許していない（シークレットモードなど）ときは、空から始める
function loadLikedIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIKED_KEY));
    if (Array.isArray(saved)) {
      return new Set(saved.filter((id) => typeof id === 'string'));
    }
  } catch (error) {
    console.warn('いいねの記録を読めませんでした', error);
  }
  return new Set();
}

// 自分がいいねしたポストの id。Set は「同じものを 2 回入れない入れ物」で、入っているかを has ですぐ調べられる（B8）
const likedIds = loadLikedIds();

// likedIds をブラウザに保存する。再読み込みしても、ピンクのハートが残る（B8）
function saveLikedIds() {
  try {
    localStorage.setItem(LIKED_KEY, JSON.stringify(Array.from(likedIds)));
  } catch (error) {
    console.warn('いいねの記録を保存できませんでした', error);
  }
}

// サーバーから消えたポスト（1 部屋 200 件を超えて消された古いもの）の id を、記録からも消す（B8）
// 記録がいつまでも増え続けないようにするため
function forgetDeletedLikes(posts) {
  const ids = new Set(posts.map((post) => post.id));
  let changed = false;
  for (const id of likedIds) {
    if (!ids.has(id)) {
      likedIds.delete(id);
      changed = true;
    }
  }
  if (changed) {
    saveLikedIds();
  }
}

// ポストした時刻を「たった今」「3分前」「2時間前」、1 日より前なら「11/19 16:02」の形の文字にする（B2）
function formatTime(createdAt) {
  const date = new Date(createdAt);
  const minutes = Math.floor((Date.now() - date.getTime()) / (60 * 1000));
  if (minutes < 1) {
    return 'たった今';
  }
  if (minutes < 60) {
    return minutes + '分前';
  }
  if (minutes < 24 * 60) {
    return Math.floor(minutes / 60) + '時間前';
  }
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return (date.getMonth() + 1) + '/' + date.getDate() + ' ' + hh + ':' + mm;
}

// 一覧を取りに行っている途中かどうか。自動更新と更新ボタンなどで、同じ通信を重ねないための印（B4）
let isLoading = false;
// 取りに行っている途中に、もう一度頼まれたかどうか。ポストした直後などに頼まれた分を、終わってから取り直す（B4）
let reloadAgain = false;

// タイムラインを取り直す。更新ボタン・ポストやいいねのあと・10 秒ごとの自動更新から呼ばれる（B4）
// 書き換えるのはタイムラインだけなので、入力中の名前や本文は消えない
async function showPosts() {
  // 前の通信が終わっていなければ、重ねて送らずに「あとでもう 1 回」と覚えておく
  if (isLoading) {
    reloadAgain = true;
    return;
  }

  isLoading = true;
  try {
    await loadPosts();
  } catch (error) {
    // サーバーが止まっているときなど。画面はそのままにして、次の自動更新でまた試す
    console.error('タイムラインを取れませんでした', error);
  } finally {
    isLoading = false;
  }

  if (reloadAgain) {
    reloadAgain = false;
    showPosts();
  }
}

// 10 秒ごとに呼ばれる。別のタブを見ているあいだは画面が見えないので、取りに行かない（B4）
// SSE がつながっているあいだは、変わったときにサーバーが知らせてくれるので、取りに行かない（B9）
// つまり 10 秒ごとの取り直しは、SSE が切れているあいだだけの「予備」になる
function autoReload() {
  if (document.hidden || isLive) {
    return;
  }
  showPosts();
}

// ===== B9: SSE（サーバーからの知らせ）でタイムラインをすぐ取り直す =====

// 今つないでいる EventSource（SSE の接続）。isLive は、つながっていて知らせを受け取れる状態かどうか
let eventSource = null;
let isLive = false;
// 次に自分でつなぎ直すまでの待ち時間。失敗するたびに倍にし、つながったら最初に戻す
let reconnectMs = RECONNECT_MIN_MS;

// サーバーの知らせの口 /posts/events につなぐ
function connectEvents() {
  eventSource = new EventSource(API + '/posts/events?room=' + ROOM);
  eventSource.addEventListener('open', onEventsOpen);
  // 知らせ（data: changed）が来たら、タイムラインを取り直す
  eventSource.addEventListener('message', showPosts);
  eventSource.addEventListener('error', onEventsError);
}

// つながったとき（つなぎ直せたときも）。切れていたあいだのポストを取りこぼさないよう、1 回取り直す
function onEventsOpen() {
  isLive = true;
  reconnectMs = RECONNECT_MIN_MS;
  showLiveStatus();
  showPosts();
}

// 切れたとき。サーバーが止まった・ネットが切れた・スリープから戻った、など
function onEventsError() {
  isLive = false;
  showLiveStatus();
  // CONNECTING（つなぎ直し中）なら、ブラウザが自分で何秒かおきにつなぎ直すので待つ
  // CLOSED は、ブラウザが諦めた（サーバーがエラーの返事をした など）ということなので、少し待って自分でつなぎ直す
  if (eventSource.readyState === EventSource.CLOSED) {
    eventSource.close();
    setTimeout(connectEvents, reconnectMs);
    reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
  }
}

// ヘッダーに、つながっているか（ライブ）、つなぎ直しているか、を出す
function showLiveStatus() {
  const status = document.getElementById('live-status');
  status.textContent = isLive ? 'ライブ' : 'つなぎ直し中…';
  status.classList.toggle('live', isLive);
  status.title = isLive ? '新しいポストやいいねが、すぐに届きます' : '10 秒ごとに取り直しています';
}

// サーバーにポストの一覧を「ください」と頼み、投稿カードにしてタイムラインに並べる（ミッション 1・2・4）
async function loadPosts() {
  // サーバーからポストの一覧を取ってくる（ミッション 2）
  const res = await fetch(API + '/posts?room=' + ROOM);
  if (!res.ok) {
    throw new Error('サーバーの返事が ' + res.status + ' でした');
  }
  const posts = await res.json();

  // 並べる前にタイムラインを空にする（ミッション 1）
  const timeline = document.getElementById('timeline');
  const template = document.getElementById('post-template');
  timeline.textContent = '';

  // 1 件ずつ、見本の投稿カードをコピーして中身を入れ、タイムラインに入れる（ミッション 1）
  for (const post of posts) {
    const card = template.content.cloneNode(true);
    // アイコンに名前の 1 文字目を入れ、名前で決まる色を背景にする（B7）
    const avatar = card.querySelector('.avatar');
    avatar.textContent = initialOf(post.name);
    avatar.style.backgroundColor = avatarColor(post.name);
    card.querySelector('.name').textContent = post.name;
    card.querySelector('.text').textContent = post.text;
    // ポストした時刻を出す。マウスを乗せると、日付と秒までの時刻が見える（B2）
    const time = card.querySelector('.time');
    time.textContent = formatTime(post.createdAt);
    time.dateTime = post.createdAt;
    time.title = new Date(post.createdAt).toLocaleString('ja-JP');
    // いいねの数を出し、ハートが押されたらこのポストの id で addLike を呼ぶ（ミッション 4）
    card.querySelector('.like-count').textContent = post.likes;
    const likeButton = card.querySelector('.like-btn');
    // 自分がいいねしたポストなら、ハートと数をピンクにする（B8）
    showLiked(likeButton, likedIds.has(post.id));
    likeButton.addEventListener('click', function () {
      addLike(post.id, likeButton);
    });
    timeline.appendChild(card);
  }
  forgetDeletedLikes(posts);
}

// いいねボタンを、いいね済み（ピンク）か、まだか、の見た目にする（B8）
// aria-pressed は「押されている状態のボタン」だと読み上げソフトに伝える印
function showLiked(button, liked) {
  button.classList.toggle('liked', liked);
  button.setAttribute('aria-pressed', String(liked));
}

// 文字数を数える。絵文字を 1 字と数えるため、server.js と同じく Array.from で 1 字ずつに分けて数える（B1）
function countChars(text) {
  return Array.from(text).length;
}

// 本文の残りの文字数を表示する。140 字を超えたら赤くして、ポストするボタンを押せなくする（B1）
function updateCharCount() {
  const text = document.getElementById('text-input').value;
  const rest = MAX_TEXT_LENGTH - countChars(text);
  const counter = document.getElementById('char-count');
  counter.textContent = rest;
  counter.classList.toggle('over', rest < 0);
  document.getElementById('post-btn').disabled = rest < 0;
}

// ポストを送っている途中かどうか。Ctrl + Enter の連打などで、同じポストを 2 回送らないための印（B3）
let isPosting = false;

// 投稿欄の名前と本文を、サーバーに「このポストを保存して」と送る（ミッション 3）
async function addPost() {
  const name = document.getElementById('name-input').value;
  const text = document.getElementById('text-input').value;
  // 140 字を超えていたら送らない（B1。サーバーも 400 で断るが、送る前に止める）
  if (countChars(text) > MAX_TEXT_LENGTH) {
    return;
  }
  // 前のポストを送っている途中なら、何もしない（B3）
  if (isPosting) {
    return;
  }

  isPosting = true;
  try {
    const res = await fetch(API + '/posts?room=' + ROOM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, text: text }),
    });
    // サーバーに断られたら（名前が空など）理由を出し、本文は消さずに残す
    if (!res.ok) {
      const error = await res.json();
      alert(error.message);
      return;
    }

    // 送り終わったら本文の欄を空にして、残りの文字数を戻し、タイムラインを取り直す
    document.getElementById('text-input').value = '';
    updateCharCount();
    showPosts();
  } finally {
    // うまくいっても、失敗しても、送り終わったら次のポストを送れるようにする
    isPosting = false;
  }
}

// 本文の欄で Ctrl + Enter（Mac は Cmd + Enter）が押されたらポストする（B3）
function postByShortcut(event) {
  // 日本語の変換中の Enter は「変換を決める」ためのものなので、ポストしない
  if (event.isComposing) {
    return;
  }
  // ctrlKey は Ctrl、metaKey は Mac の Cmd（⌘）が押されているか
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    // 本文に改行が入らないようにしてから送る
    event.preventDefault();
    addPost();
  }
}

// サーバーに「この id のポストのいいねを 1 増やして」と頼み、タイムラインを取り直す（ミッション 4）
// いいねは 1 人 1 回にする。いいね済みのポストのハートは、押しても何も送らない（B8）
async function addLike(id, button) {
  if (likedIds.has(id)) {
    return;
  }
  // 返事を待たずに先にピンクにして、記録する。連打しても 2 回目は上の if で止まる
  likedIds.add(id);
  saveLikedIds();
  showLiked(button, true);

  try {
    const res = await fetch(API + '/posts/' + id + '/like?room=' + ROOM, { method: 'POST' });
    if (!res.ok) {
      throw new Error('サーバーの返事が ' + res.status + ' でした');
    }
  } catch (error) {
    // 届かなかったら（サーバーが止まっている・ポストが消えた）記録を戻す。取り直しでハートも灰色に戻る
    console.error('いいねできませんでした', error);
    likedIds.delete(id);
    saveLikedIds();
  }
  showPosts();
}

// 「ポストする」ボタンでは addPost（ミッション 3）、更新ボタンでは showPosts（ミッション 2）を動かす
document.getElementById('post-btn').addEventListener('click', addPost);
document.getElementById('reload-btn').addEventListener('click', showPosts);
// 本文に文字を打つたびに、残りの文字数を数え直す（B1）
document.getElementById('text-input').addEventListener('input', updateCharCount);
// 本文の欄でキーが押されたら、Ctrl + Enter かどうかを確かめる（B3）
document.getElementById('text-input').addEventListener('keydown', postByShortcut);

// ページを開いたときに 1 回、残りの文字数とタイムラインを表示する
updateCharCount();
showPosts();
// サーバーの知らせ（SSE）につなぐ。つながるまでは「つなぎ直し中」と出す（B9）
showLiveStatus();
connectEvents();
// SSE が切れているあいだだけ、10 秒ごとにタイムラインを取り直す（B4。予備）
setInterval(autoReload, AUTO_RELOAD_MS);
