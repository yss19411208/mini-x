// 回数の制限（レート制限）。「同じ人（key）は windowMs ミリ秒のあいだに limit 回まで」を数える
// しくみは「固定の区切り」: 人ごとに、数えはじめた時刻と回数を覚え、区切りが過ぎたら 0 から数え直す
//
// 覚えておく人の数にも上限（maxKeys）を付ける。上限が無いと、IP を変えながら送られたときに、
// この記録そのものがメモリを食いつぶしてしまう
export function createRateLimiter({ limit, windowMs, maxKeys = 10000 }) {
  // key → { count: 回数, resetAt: 数え直す時刻 }。Map は入れた順を覚えているので、先頭がいちばん古い
  const counters = new Map();

  // 区切りが過ぎた記録を消す
  // 記録は数えはじめた順に並んでいて、どの記録も区切りの長さは同じなので、先頭ほど早く区切りが過ぎる。
  // だから先頭から見て、まだ区切りが過ぎていない記録に当たったら、そこで止めてよい（全部を見なくて済む）
  function sweep(now) {
    for (const [key, counter] of counters) {
      if (counter.resetAt > now) {
        break;
      }
      counters.delete(key);
    }
  }

  // 1 回分を数える。まだ使えるなら { ok: true }、使いすぎなら { ok: false, retryAfter: 待つ秒数 }
  function hit(key) {
    const now = Date.now();
    let counter = counters.get(key);
    if (!counter || counter.resetAt <= now) {
      // 新しく覚える前に、上限に届いていたら古い記録を消して場所を空ける
      if (!counter && counters.size >= maxKeys) {
        sweep(now);
        if (counters.size >= maxKeys) {
          counters.delete(counters.keys().next().value);
        }
      }
      counter = { count: 0, resetAt: now + windowMs };
      // いったん消してから入れ直し、Map の最後（新しい側）に置く
      counters.delete(key);
      counters.set(key, counter);
    }
    counter.count += 1;
    if (counter.count > limit) {
      return { ok: false, retryAfter: Math.ceil((counter.resetAt - now) / 1000) };
    }
    return { ok: true };
  }

  return { hit, sweep, size: () => counters.size };
}
