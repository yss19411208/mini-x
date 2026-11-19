// 投稿カード 1 枚分の部品。本体の index.html の <template id="post-template"> と同じ形
// {post.name} のように {} で入れた文字は、React が必ず「ただの文字」として出す（本体の textContent と同じ。XSS を防ぐ）
import { avatarColor, formatTime, initialOf } from './format.js';

export function PostCard({ post, liked, onLike }) {
  return (
    <li className="post">
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
        <p className="text">{post.text}</p>
        {/* B8: 自分がいいねしたポストは liked でピンクにする */}
        <button className={liked ? 'like-btn liked' : 'like-btn'} aria-pressed={liked} onClick={onLike}>
          <span className="like-count">{post.likes}</span>
        </button>
      </div>
    </li>
  );
}
