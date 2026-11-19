// 投稿カード 1 枚分の部品。本体の index.html の <template id="post-template"> と同じ形
// {post.name} のように {} で入れた文字は、React が必ず「ただの文字」として出す（本体の textContent と同じ。XSS を防ぐ）
import type { Post } from './api.ts';
import { avatarColor, formatOpensAt, formatTime, initialOf } from '../format.ts';

// この部品が受け取る値（props）の形（B11）
type PostCardProps = {
  post: Post;
  liked: boolean; // 自分がいいねしたか
  onLike: () => void; // ハートが押されたときに呼ぶ関数
};

export function PostCard({ post, liked, onLike }: PostCardProps) {
  // 本体のオリジナル機能 2「夢のたまご」。React 版ではポストはできないが、かえる前のたまごが空のカードに見えないよう表示だけ合わせる
  const sealed = post.sealed === true;
  return (
    <li className={sealed ? 'post sealed' : 'post'}>
      {/* B7: 名前の 1 文字目と、名前で決まる色のアイコン */}
      <div className="avatar initial" aria-hidden="true" style={{ backgroundColor: avatarColor(post.name) }}>
        {initialOf(post.name)}
      </div>
      <div className="post-body">
        <span className="name">{post.name}</span>
        {/* B2: ポストした時刻。マウスを乗せると日付と秒まで見える */}
        <time className="time" dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString('ja-JP')}>
          {formatTime(post.createdAt)}
        </time>
        {post.opensAt && <span className="egg-badge">{sealed ? '🥚 夢のたまご' : '🐣 かえった夢のたまご'}</span>}
        <p className="text">{sealed && post.opensAt ? formatOpensAt(post.opensAt) + ' にかえります' : post.text}</p>
        {/* B8: 自分がいいねしたポストは liked でピンクにする */}
        <button className={liked ? 'like-btn liked' : 'like-btn'} aria-pressed={liked} disabled={sealed} onClick={onLike}>
          <span className="like-count">{post.likes}</span>
        </button>
      </div>
    </li>
  );
}
