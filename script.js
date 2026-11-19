// ミニX の動きを書くファイル。サーバーとポストをやりとりして、タイムラインに並べる
// API はサーバーの場所（URL）、ROOM は部屋の名前。同じ部屋の人どうしで、ポストが見える
const API = 'http://localhost:8000';
const ROOM = 'sample';
// 本文の長さの上限。server.js の MAX_TEXT_LENGTH と同じ数にする（B1）
const MAX_TEXT_LENGTH = 140;

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

// サーバーにポストの一覧を「ください」と頼み、投稿カードにしてタイムラインに並べる（ミッション 1・2・4）
async function showPosts() {
  // サーバーからポストの一覧を取ってくる（ミッション 2）
  const res = await fetch(API + '/posts?room=' + ROOM);
  const posts = await res.json();

  // 並べる前にタイムラインを空にする（ミッション 1）
  const timeline = document.getElementById('timeline');
  const template = document.getElementById('post-template');
  timeline.textContent = '';

  // 1 件ずつ、見本の投稿カードをコピーして中身を入れ、タイムラインに入れる（ミッション 1）
  for (const post of posts) {
    const card = template.content.cloneNode(true);
    card.querySelector('.name').textContent = post.name;
    card.querySelector('.text').textContent = post.text;
    // ポストした時刻を出す。マウスを乗せると、日付と秒までの時刻が見える（B2）
    const time = card.querySelector('.time');
    time.textContent = formatTime(post.createdAt);
    time.dateTime = post.createdAt;
    time.title = new Date(post.createdAt).toLocaleString('ja-JP');
    // いいねの数を出し、ハートが押されたらこのポストの id で addLike を呼ぶ（ミッション 4）
    card.querySelector('.like-count').textContent = post.likes;
    card.querySelector('.like-btn').addEventListener('click', function () {
      addLike(post.id);
    });
    timeline.appendChild(card);
  }
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
async function addLike(id) {
  await fetch(API + '/posts/' + id + '/like?room=' + ROOM, { method: 'POST' });
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
