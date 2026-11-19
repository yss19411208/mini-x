// React の「フック」（use で始まる関数）。画面の部品から、タイムラインといいねの記録を使えるようにする
import { useCallback, useEffect, useRef, useState } from 'react';
import { eventsUrl, fetchPosts, ROOM } from './api.js';

// タイムラインを自動で取り直す間隔（B4）と、SSE を自分でつなぎ直すまでの待ち時間（B9）
const AUTO_RELOAD_MS = 10 * 1000;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30 * 1000;

// タイムライン（ポストの一覧）を持ち、SSE の知らせや 10 秒ごとに取り直す
// posts は、まだ 1 回も取れていないあいだは null
export function useTimeline() {
  const [posts, setPosts] = useState(null);
  const [isLive, setIsLive] = useState(false);
  // 取りに行っている途中か・途中でもう一度頼まれたか（B4。同じ通信を重ねないため）
  // 画面の描き直しには関係ないので、useState ではなく useRef に置く
  const loading = useRef({ busy: false, again: false });

  // 一覧を取り直す。途中なら「あとでもう 1 回」と覚えておき、終わってから取り直す
  const reload = useCallback(async function reload() {
    const state = loading.current;
    if (state.busy) {
      state.again = true;
      return;
    }
    state.busy = true;
    try {
      setPosts(await fetchPosts());
    } catch (error) {
      console.error('タイムラインを取れませんでした', error);
    } finally {
      state.busy = false;
    }
    if (state.again) {
      state.again = false;
      reload();
    }
  }, []);

  // 画面を開いたときに 1 回取り、サーバーの知らせ（SSE）につなぐ（B9）
  // 画面が閉じられたら（return の関数）、接続とつなぎ直しのタイマーを片づける
  useEffect(() => {
    let source = null;
    let retryTimer = null;
    let waitMs = RECONNECT_MIN_MS;

    function connect() {
      source = new EventSource(eventsUrl());
      // つながったら（つなぎ直せたときも）、切れていたあいだの分を 1 回取り直す
      source.addEventListener('open', () => {
        setIsLive(true);
        waitMs = RECONNECT_MIN_MS;
        reload();
      });
      // 知らせ（data: changed）が来たら取り直す
      source.addEventListener('message', reload);
      // 切れたら。ブラウザが諦めた（CLOSED）ときだけ、少し待って自分でつなぎ直す（待ち時間は倍々、最大 30 秒）
      source.addEventListener('error', () => {
        setIsLive(false);
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          retryTimer = setTimeout(connect, waitMs);
          waitMs = Math.min(waitMs * 2, RECONNECT_MAX_MS);
        }
      });
    }

    reload();
    connect();
    return () => {
      clearTimeout(retryTimer);
      source.close();
    };
  }, [reload]);

  // SSE が切れているあいだだけ、10 秒ごとに取り直す（B4 の予備）。別のタブを見ているあいだは取りに行かない
  // isLive が変わるたびにこの effect が作り直されるので、つながったらタイマーは止まる
  useEffect(() => {
    if (isLive) {
      return;
    }
    const timer = setInterval(() => {
      if (!document.hidden) {
        reload();
      }
    }, AUTO_RELOAD_MS);
    return () => clearInterval(timer);
  }, [isLive, reload]);

  return { posts, isLive, reload };
}

// 自分がいいねしたポストの id を、ブラウザ（localStorage）に保存するときの名前。本体と同じ名前なので、記録も共通（B8）
const LIKED_KEY = 'minix-liked-' + ROOM;

// 保存してある id を読み出す。無い・壊れている・保存が許されていないときは空から始める
function loadLikedIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIKED_KEY));
    if (Array.isArray(saved)) {
      return new Set(saved.filter((id) => typeof id === 'string'));
    }
  } catch (error) {
    console.warn('いいねの記録を読めませんでした', error);
  }
  return new Set();
}

// 自分がいいねしたポストの id の記録（B8）。変わるたびに localStorage に保存する
// Set は中身を変えても React が気づかないので、変えるときは毎回新しい Set を作る
export function useLikedIds() {
  const [likedIds, setLikedIds] = useState(loadLikedIds);

  useEffect(() => {
    try {
      localStorage.setItem(LIKED_KEY, JSON.stringify(Array.from(likedIds)));
    } catch (error) {
      console.warn('いいねの記録を保存できませんでした', error);
    }
  }, [likedIds]);

  const add = useCallback((id) => {
    setLikedIds((prev) => new Set(prev).add(id));
  }, []);

  const remove = useCallback((id) => {
    setLikedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // サーバーから消えたポストの id を、記録からも消す（記録が増え続けないように）。消すものが無ければそのまま
  const keepOnly = useCallback((posts) => {
    const ids = new Set(posts.map((post) => post.id));
    setLikedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  return { likedIds, add, remove, keepOnly };
}
