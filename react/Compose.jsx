// 投稿欄の部品。名前と本文を useState で持ち、ポストする
import { useState } from 'react';
import icon from '../icon.svg';
import { sendPost } from './api.js';
import { countChars, MAX_TEXT_LENGTH } from './format.js';

// onPosted は、ポストし終わったときに呼ぶ関数（タイムラインを取り直すため）
export function Compose({ onPosted }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  // 送っている途中か（B3。Ctrl + Enter の連打で 2 回送らないため）
  const [isPosting, setIsPosting] = useState(false);
  // 残りの文字数（B1）。text が変わるたびに React が描き直すので、そのたびに数え直される
  const rest = MAX_TEXT_LENGTH - countChars(text);

  async function submit() {
    if (rest < 0 || isPosting) {
      return;
    }
    setIsPosting(true);
    try {
      const result = await sendPost(name, text);
      // 断られたら（名前が空など）理由を出し、本文は残す
      if (!result.ok) {
        alert(result.message);
        return;
      }
      setText('');
      onPosted();
    } catch (error) {
      console.error('ポストできませんでした', error);
    } finally {
      setIsPosting(false);
    }
  }

  // 本文の欄で Ctrl + Enter（Mac は Cmd + Enter）が押されたらポストする（B3）。日本語の変換中は何もしない
  function postByShortcut(event) {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="compose">
      <img className="avatar" src={icon} alt="" />
      <div className="compose-body">
        <input id="name-input" type="text" placeholder="ニックネーム" value={name} onChange={(event) => setName(event.target.value)} />
        <textarea
          id="text-input"
          placeholder="今日なにつくった？"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={postByShortcut}
        />
        <div className="compose-footer">
          {/* B1: 140 字を超えたら over で赤くし、ボタンを押せなくする */}
          <span id="char-count" className={rest < 0 ? 'over' : ''}>{rest}</span>
          <button id="post-btn" title="Ctrl + Enter（Mac は ⌘ + Enter）でもポストできます" disabled={rest < 0} onClick={submit}>
            ポストする
          </button>
        </div>
      </div>
    </div>
  );
}
