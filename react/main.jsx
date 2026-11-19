// React 版の入り口。index.html の <main id="root"> に、App の画面をつなぐ
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
