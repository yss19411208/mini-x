// 画面に出す文字と色を決める小さな関数と、本文の長さの上限
// 本体の画面（script.ts）と React 版（react/）の両方が使う。サーバー（server.ts）も MAX_TEXT_LENGTH を使う
// ブラウザには server.ts が JavaScript に直して /format.ts で配る

// 本文の長さの上限（B1）。サーバーの入力チェックと、画面の残りの文字数の両方で使う
export const MAX_TEXT_LENGTH = 140;

// アイコンの背景の色（B7）。白い太字が読めるよう、濃いめの色を 8 つ並べる
const AVATAR_COLORS = ['#7856ff', '#d6336c', '#1971c2', '#2f9e44', '#e8590c', '#ae3ec9', '#0c8599', '#495057'];

// 名前から、アイコンの背景の色を 1 つ選ぶ（B7）
// 名前の全部の文字の番号（コードポイント）を混ぜた数を、色の数で割った余りで選ぶ。同じ名前なら、いつも同じ色になる
// 1 文字目だけだと「たろう」と「たけし」が同じ色になるので、全部の文字を使う
// 混ぜ方は djb2 という有名な作り方（5381 から始め、33 を掛けて文字の番号を足す）。33 を掛けるので、文字の並び順でも数が変わる
// 数が大きくなりすぎないよう、毎回 1000003（素数）で割った余りにする
export function avatarColor(name: string): string {
  let hash = 5381;
  for (const char of name) {
    hash = (hash * 33 + char.codePointAt(0)!) % 1000003;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

// 名前の 1 文字目を返す（B7）。name[0] だと絵文字（😀）が半分に切れて文字化けするので、Array.from で 1 字ずつに分ける
export function initialOf(name: string): string {
  return Array.from(name)[0] ?? '';
}

// ポストした時刻を「たった今」「3分前」「2時間前」、1 日より前なら「11/19 16:02」の形の文字にする（B2）
export function formatTime(createdAt: string): string {
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

// たまごがかえる時刻を「17:32」、今日でなければ「11/20 17:32」の形にする
export function formatOpensAt(opensAt: string): string {
  const date = new Date(opensAt);
  const hhmm = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? hhmm : (date.getMonth() + 1) + '/' + date.getDate() + ' ' + hhmm;
}

// 文字数を数える。絵文字を 1 字と数えるため、サーバーと同じく Array.from で 1 字ずつに分けて数える（B1）
export function countChars(text: string): number {
  return Array.from(text).length;
}
