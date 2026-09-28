import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { App } from './App';
import { connectState } from './store';

connectState();
createRoot(document.getElementById('root')!).render(<App />);
