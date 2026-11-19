// React 版ミニX の画面全体（B10 で JSX、B11 で TSX にした）。ヘッダー・投稿欄・タイムラインの 3 つを並べる
// 本体の script.ts では、関数が画面の部品を探して書き換えていた。React では「今の値（state）」から画面の形を書き、
// 値が変わると React が描き直す
import { useEffect } from 'react';
import { sendLike } from './api.ts';
import { Compose } from './Compose.tsx';
import { useLikedIds, useTimeline } from './hooks.ts';
import { PostCard } from './PostCard.tsx';

// ヘッダー。SSE でつながっているか（B9）と、更新ボタン
type HeaderProps = { isLive: boolean; onReload: () => void };

function Header({ isLive, onReload }: HeaderProps) {
  return (
    <header className="header">
      <h1>ホーム</h1>
      <div className="header-tools">
        <span
          id="live-status"
          className={isLive ? 'live-status live' : 'live-status'}
          title={isLive ? '新しいポストやいいねが、すぐに届きます' : '10 秒ごとに取り直しています'}
        >
          {isLive ? 'ライブ' : 'つなぎ直し中…'}
        </span>
        <button id="reload-btn" onClick={onReload}>更新</button>
      </div>
    </header>
  );
}

export function App() {
  const { posts, isLive, reload } = useTimeline();
  const { likedIds, add, remove, keepOnly } = useLikedIds();

  // 一覧が届くたびに、消えたポストのいいねの記録を消す（B8）。まだ届いていない（null）ときは何もしない
  useEffect(() => {
    if (posts) {
      keepOnly(posts);
    }
  }, [posts, keepOnly]);

  // いいねは 1 人 1 回（B8）。先にピンクにしてから送り、届かなかったら戻す
  async function like(id: string): Promise<void> {
    if (likedIds.has(id)) {
      return;
    }
    add(id);
    try {
      await sendLike(id);
    } catch (error) {
      console.error('いいねできませんでした', error);
      remove(id);
    }
    reload();
  }

  return (
    <>
      <Header isLive={isLive} onReload={reload} />
      <Compose onPosted={reload} />
      <ul id="timeline">
        {(posts ?? []).map((post) => (
          <PostCard key={post.id} post={post} liked={likedIds.has(post.id)} onLike={() => like(post.id)} />
        ))}
      </ul>
    </>
  );
}
