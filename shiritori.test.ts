// しりとり部屋の決まり（shiritori.ts）を確かめるテスト。サーバーを立てずに、関数だけを試す
import { describe, expect, test } from 'bun:test';
import { checkShiritori, firstKana, isShiritoriRoom, lastKana, nextKana } from './shiritori.ts';

describe('最初の字・最後の字', () => {
  test('カタカナはひらがなにして比べる', () => {
    expect(firstKana('ラッパ')).toBe('ら');
    expect(lastKana('ゴリラ')).toBe('ら');
  });

  test('のばす音（ー）は飛ばし、前の字を使う', () => {
    expect(lastKana('コーヒー')).toBe('ひ');
    expect(lastKana('すきー')).toBe('き');
  });

  test('小さい字は大きい字にする', () => {
    expect(lastKana('きしゃ')).toBe('や');
    expect(lastKana('ジュース')).toBe('す');
    expect(lastKana('ちょっ')).toBe('つ');
  });
});

describe('つながるか', () => {
  test('前のことばの最後の字から始まればよい', () => {
    expect(checkShiritori('りんご', 'ごりら')).toBeNull();
    expect(checkShiritori('コーヒー', 'ひよこ')).toBeNull();
    expect(checkShiritori('きしゃ', 'やかん')).toBeNull();
  });

  test('つながらないと、何の字から始めるかを教える', () => {
    expect(checkShiritori('りんご', 'らっぱ')).toBe('「ご」から始まることばにしてください');
  });

  test('前が無い・「ん」で終わっていたら、好きな字からでよい', () => {
    expect(checkShiritori(null, 'すいか')).toBeNull();
    expect(checkShiritori('みかん', 'すいか')).toBeNull();
    expect(nextKana('みかん')).toBeNull();
  });

  test('かな以外（漢字・英字・空白・記号）と、20 字を超えることばは断る', () => {
    expect(checkShiritori(null, '林檎')).not.toBeNull();
    expect(checkShiritori(null, 'apple')).not.toBeNull();
    expect(checkShiritori(null, 'りん ご')).not.toBeNull();
    expect(checkShiritori(null, 'ーらめん')).not.toBeNull();
    expect(checkShiritori(null, 'あ'.repeat(21))).not.toBeNull();
    expect(checkShiritori(null, 'あ'.repeat(20))).toBeNull();
  });
});

describe('しりとりの部屋', () => {
  test('shiritori と shiritori- で始まる部屋だけ', () => {
    expect(isShiritoriRoom('shiritori')).toBe(true);
    expect(isShiritoriRoom('shiritori-2nen')).toBe(true);
    expect(isShiritoriRoom('sample')).toBe(false);
    expect(isShiritoriRoom('shiritorix')).toBe(false);
  });
});
