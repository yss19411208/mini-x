// しりとり部屋（オリジナル機能 1）の決まり
// サーバー（server.ts）は、ポストを保存する前にこの決まりで確かめる。画面（script.ts）は「次は何の字から」を出すのに使う
// 同じファイルを両方が読むので、判定がずれない

// しりとりのことばの長さの上限
export const MAX_WORD_LENGTH = 20;

// ひらがな・カタカナ・のばす音（ー）だけのことば。1 文字目はのばす音にしない
// ぁ-ゖ はひらがな全部、ァ-ヺ はカタカナ全部（「・」は入らない）
const KANA_WORD = /^[ぁ-ゖァ-ヺ][ぁ-ゖァ-ヺー]*$/;

// 小さい字を、しりとりで続けるときの大きい字に直す表（きしゃ → や、ねっこ の っ → つ）
const SMALL_TO_LARGE: Record<string, string> = {
  ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お',
  っ: 'つ', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ', ゕ: 'か', ゖ: 'け',
};

// しりとりの部屋かどうか。shiritori か、shiritori- で始まる部屋（shiritori-2nen など）
export function isShiritoriRoom(room: string): boolean {
  return room === 'shiritori' || room.startsWith('shiritori-');
}

// カタカナ 1 字をひらがなに直す。文字の番号で、カタカナ（ァ〜ヶ）は、ひらがな（ぁ〜ゖ）のちょうど 0x60 後ろにある
function toHiragana(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
}

// ことばの最初の字（ひらがなで）
export function firstKana(word: string): string {
  return toHiragana(Array.from(word)[0] ?? '');
}

// ことばの最後の字（ひらがなで）。のばす音（ー）は飛ばして前の字を使い、小さい字は大きくする
// 例: コーヒー → ひ、きしゃ → や、すりっぱ → ぱ
export function lastKana(word: string): string {
  const chars = Array.from(word).filter((char) => char !== 'ー');
  const last = toHiragana(chars[chars.length - 1] ?? '');
  return SMALL_TO_LARGE[last] ?? last;
}

// 次のことばが何の字から始まればよいか。直前のことばが無い・「ん」で終わっていたら null（好きな字からでよい）
export function nextKana(previous: string | null): string | null {
  if (previous === null) {
    return null;
  }
  const last = lastKana(previous);
  return last === 'ん' ? null : last;
}

// しりとりのポストを確かめる。だめなら理由の文を、よければ null を返す
// previous は、その部屋のいちばん新しいポストの本文（無ければ null）
// 「ん」で終わることばもポストできる（その人の負け）。次の人は好きな字から始める
export function checkShiritori(previous: string | null, word: string): string | null {
  if (!KANA_WORD.test(word)) {
    return 'しりとり部屋では、ひらがなかカタカナのことば（空白なし）だけをポストできます';
  }
  if (Array.from(word).length > MAX_WORD_LENGTH) {
    return 'しりとりのことばは ' + MAX_WORD_LENGTH + ' 文字までです';
  }
  const next = nextKana(previous);
  if (next !== null && firstKana(word) !== next) {
    return '「' + next + '」から始まることばにしてください';
  }
  return null;
}
