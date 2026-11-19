// React 版の入り口。index.html の <main id="root"> に、App の画面をつなぐ
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

// 後ろの ! は「この部品は必ずある（null ではない）」と TypeScript に伝える印（B11。index.html に必ず書いてある）
createRoot(document.getElementById('root')!).render(<App />);
