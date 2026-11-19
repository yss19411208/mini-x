// 画面に出す文字や色を決める小さな関数。中身は本体の script.ts と同じ（説明も script.ts にある）

// 本文の長さの上限。サーバーの MAX_TEXT_LENGTH と同じ（B1）
export const MAX_TEXT_LENGTH = 140;

// アイコンの背景の色（B7）
const AVATAR_COLORS = ['#7856ff', '#d6336c', '#1971c2', '#2f9e44', '#e8590c', '#ae3ec9', '#0c8599', '#495057'];

// 名前から、アイコンの背景の色を 1 つ選ぶ（B7。djb2 で全部の文字を混ぜる）
export function avatarColor(name: string): string {
  let hash = 5381;
  for (const char of name) {
    hash = (hash * 33 + char.codePointAt(0)!) % 1000003;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

// 名前の 1 文字目（B7）。絵文字が半分に切れないよう Array.from で分ける
export function initialOf(name: string): string {
  return Array.from(name)[0] ?? '';
}

// 文字数を数える。絵文字も 1 字（B1）
export function countChars(text: string): number {
  return Array.from(text).length;
}

// ポストした時刻を「たった今」「3分前」「2時間前」「11/19 16:02」の形にする（B2）
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
