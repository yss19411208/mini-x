// ミニX の動きを書くファイル。サーバーとポストをやりとりして、タイムラインに並べる
// B6 で TypeScript にした。ブラウザは .ts を読めないので、server.ts が配る前に型を取り除いて JavaScript にする
// API はサーバーの場所（URL）、ROOM は部屋の名前。同じ部屋の人どうしで、ポストが見える
// ふだんは、画面を配ったのと同じ場所（bun server.ts が画面も API も配る。手元の 8000 番も、公開先 https://minix.dreamyard.cc も）
// bun run index.html（Bun の開発用サーバー。3000 番）で画面だけを開いたときは、API は localhost:8000 のサーバー
const API = location.port === '3000' ? 'http://localhost:8000' : location.origin;
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

// サーバーから届くポスト 1 件の形（B6）。server.ts の Post と同じ形
type Post = {
  id: string;
  name: string;
  text: string;
  likes: number;
  createdAt: string; // ISO の形の時刻
};

// id で画面の部品を探す（B6）。T は「何の部品か」（入力欄なら HTMLInputElement など）
// getElementById は「見つからないかもしれない（null）」と型に出るので、ここで確かめて、無ければすぐ気づけるようにする
function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error('id="' + id + '" の部品が index.html にありません');
  }
  return element as T;
}

// 投稿カードの中から、class で部品を探す（B6）。byId と同じく、無ければすぐ気づけるようにする
function part<T extends Element>(card: DocumentFragment, selector: string): T {
  const element = card.querySelector<T>(selector);
  if (!element) {
    throw new Error(selector + ' の部品が投稿カードの見本にありません');
  }
  return element;
}

// 名前から、アイコンの背景の色を 1 つ選ぶ（B7）
// 名前の全部の文字の番号（コードポイント）を混ぜた数を、色の数で割った余りで選ぶ。同じ名前なら、いつも同じ色になる
// 1 文字目だけだと「たろう」と「たけし」が同じ色になるので、全部の文字を使う
// 混ぜ方は djb2 という有名な作り方（5381 から始め、33 を掛けて文字の番号を足す）。33 を掛けるので、文字の並び順でも数が変わる
// 数が大きくなりすぎないよう、毎回 1000003（素数）で割った余りにする
function avatarColor(name: string): string {
  let hash = 5381;
  for (const char of name) {
    hash = (hash * 33 + char.codePointAt(0)!) % 1000003;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

// 名前の 1 文字目を返す（B7）。name[0] だと絵文字（😀）が半分に切れて文字化けするので、Array.from で 1 字ずつに分ける
function initialOf(name: string): string {
  return Array.from(name)[0] ?? '';
}

// ブラウザに保存してある「自分がいいねしたポストの id」を読み出す（B8）
// 保存がない・壊れている・ブラウザが保存を許していない（シークレットモードなど）ときは、空から始める
function loadLikedIds(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LIKED_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      return new Set(saved.filter((id): id is string => typeof id === 'string'));
    }
  } catch (error) {
    console.warn('いいねの記録を読めませんでした', error);
  }
  return new Set();
}

// 自分がいいねしたポストの id。Set は「同じものを 2 回入れない入れ物」で、入っているかを has ですぐ調べられる（B8）
const likedIds = loadLikedIds();

// likedIds をブラウザに保存する。再読み込みしても、ピンクのハートが残る（B8）
function saveLikedIds(): void {
  try {
    localStorage.setItem(LIKED_KEY, JSON.stringify(Array.from(likedIds)));
  } catch (error) {
    console.warn('いいねの記録を保存できませんでした', error);
  }
}

// サーバーから消えたポスト（1 部屋 200 件を超えて消された古いもの）の id を、記録からも消す（B8）
// 記録がいつまでも増え続けないようにするため
function forgetDeletedLikes(posts: Post[]): void {
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
function formatTime(createdAt: string): string {
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
async function showPosts(): Promise<void> {
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
function autoReload(): void {
  if (document.hidden || isLive) {
    return;
  }
  showPosts();
}

// ===== B9: SSE（サーバーからの知らせ）でタイムラインをすぐ取り直す =====

// 今つないでいる EventSource（SSE の接続）。isLive は、つながっていて知らせを受け取れる状態かどうか
let eventSource: EventSource | null = null;
let isLive = false;
// 次に自分でつなぎ直すまでの待ち時間。失敗するたびに倍にし、つながったら最初に戻す
let reconnectMs = RECONNECT_MIN_MS;

// サーバーの知らせの口 /posts/events につなぐ
function connectEvents(): void {
  const source = new EventSource(API + '/posts/events?room=' + ROOM);
  source.addEventListener('open', onEventsOpen);
  // 知らせ（data: changed）が来たら、タイムラインを取り直す
  source.addEventListener('message', showPosts);
  source.addEventListener('error', onEventsError);
  eventSource = source;
}

// つながったとき（つなぎ直せたときも）。切れていたあいだのポストを取りこぼさないよう、1 回取り直す
function onEventsOpen(): void {
  isLive = true;
  reconnectMs = RECONNECT_MIN_MS;
  showLiveStatus();
  showPosts();
}

// 切れたとき。サーバーが止まった・ネットが切れた・スリープから戻った、など
function onEventsError(): void {
  isLive = false;
  showLiveStatus();
  // CONNECTING（つなぎ直し中）なら、ブラウザが自分で何秒かおきにつなぎ直すので待つ
  // CLOSED は、ブラウザが諦めた（サーバーがエラーの返事をした など）ということなので、少し待って自分でつなぎ直す
  if (eventSource && eventSource.readyState === EventSource.CLOSED) {
    eventSource.close();
    setTimeout(connectEvents, reconnectMs);
    reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
  }
}

// ヘッダーに、つながっているか（ライブ）、つなぎ直しているか、を出す
function showLiveStatus(): void {
  const status = byId('live-status');
  status.textContent = isLive ? 'ライブ' : 'つなぎ直し中…';
  status.classList.toggle('live', isLive);
  status.title = isLive ? '新しいポストやいいねが、すぐに届きます' : '10 秒ごとに取り直しています';
}

// サーバーにポストの一覧を「ください」と頼み、投稿カードにしてタイムラインに並べる（ミッション 1・2・4）
async function loadPosts(): Promise<void> {
  // サーバーからポストの一覧を取ってくる（ミッション 2）
  const res = await fetch(API + '/posts?room=' + ROOM);
  if (!res.ok) {
    throw new Error('サーバーの返事が ' + res.status + ' でした');
  }
  const posts: Post[] = await res.json();

  // 並べる前にタイムラインを空にする（ミッション 1）
  const timeline = byId<HTMLUListElement>('timeline');
  const template = byId<HTMLTemplateElement>('post-template');
  timeline.textContent = '';

  // 1 件ずつ、見本の投稿カードをコピーして中身を入れ、タイムラインに入れる（ミッション 1）
  for (const post of posts) {
    const card = template.content.cloneNode(true) as DocumentFragment;
    // アイコンに名前の 1 文字目を入れ、名前で決まる色を背景にする（B7）
    const avatar = part<HTMLDivElement>(card, '.avatar');
    avatar.textContent = initialOf(post.name);
    avatar.style.backgroundColor = avatarColor(post.name);
    part(card, '.name').textContent = post.name;
    part(card, '.text').textContent = post.text;
    // ポストした時刻を出す。マウスを乗せると、日付と秒までの時刻が見える（B2）
    const time = part<HTMLTimeElement>(card, '.time');
    time.textContent = formatTime(post.createdAt);
    time.dateTime = post.createdAt;
    time.title = new Date(post.createdAt).toLocaleString('ja-JP');
    // いいねの数を出し、ハートが押されたらこのポストの id で addLike を呼ぶ（ミッション 4）
    // textContent に入れられるのは文字だけなので、数を String で文字にする（B6）
    part(card, '.like-count').textContent = String(post.likes);
    const likeButton = part<HTMLButtonElement>(card, '.like-btn');
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
function showLiked(button: HTMLButtonElement, liked: boolean): void {
  button.classList.toggle('liked', liked);
  button.setAttribute('aria-pressed', String(liked));
}

// 文字数を数える。絵文字を 1 字と数えるため、server.js と同じく Array.from で 1 字ずつに分けて数える（B1）
function countChars(text: string): number {
  return Array.from(text).length;
}

// 本文の残りの文字数を表示する。140 字を超えたら赤くして、ポストするボタンを押せなくする（B1）
function updateCharCount(): void {
  const text = byId<HTMLTextAreaElement>('text-input').value;
  const rest = MAX_TEXT_LENGTH - countChars(text);
  const counter = byId('char-count');
  counter.textContent = String(rest);
  counter.classList.toggle('over', rest < 0);
  byId<HTMLButtonElement>('post-btn').disabled = rest < 0;
}

// ポストを送っている途中かどうか。Ctrl + Enter の連打などで、同じポストを 2 回送らないための印（B3）
let isPosting = false;

// 投稿欄の名前と本文を、サーバーに「このポストを保存して」と送る（ミッション 3）
async function addPost(): Promise<void> {
  const name = byId<HTMLInputElement>('name-input').value;
  const text = byId<HTMLTextAreaElement>('text-input').value;
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
      const error: { message: string } = await res.json();
      alert(error.message);
      return;
    }

    // 送り終わったら本文の欄を空にして、残りの文字数を戻し、タイムラインを取り直す
    byId<HTMLTextAreaElement>('text-input').value = '';
    updateCharCount();
    showPosts();
  } finally {
    // うまくいっても、失敗しても、送り終わったら次のポストを送れるようにする
    isPosting = false;
  }
}

// 本文の欄で Ctrl + Enter（Mac は Cmd + Enter）が押されたらポストする（B3）
function postByShortcut(event: KeyboardEvent): void {
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
async function addLike(id: string, button: HTMLButtonElement): Promise<void> {
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
byId('post-btn').addEventListener('click', addPost);
byId('reload-btn').addEventListener('click', showPosts);
// 本文に文字を打つたびに、残りの文字数を数え直す（B1）
byId('text-input').addEventListener('input', updateCharCount);
// 本文の欄でキーが押されたら、Ctrl + Enter かどうかを確かめる（B3）
byId('text-input').addEventListener('keydown', postByShortcut);

// ページを開いたときに 1 回、残りの文字数とタイムラインを表示する
updateCharCount();
showPosts();
// サーバーの知らせ（SSE）につなぐ。つながるまでは「つなぎ直し中」と出す（B9）
showLiveStatus();
connectEvents();
// SSE が切れているあいだだけ、10 秒ごとにタイムラインを取り直す（B4。予備）
setInterval(autoReload, AUTO_RELOAD_MS);

// このファイルを「モジュール」として扱わせる印（B6）。これが無いと、TypeScript は中の名前（API・ROOM など）を
// ほかのファイルと共通の名前として扱い、server.ts の同じ名前とぶつかったことにしてしまう
export {};
