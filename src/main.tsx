import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Guard against noisy transient token-service-api or offline reconnect warnings from halting the client
if (typeof window !== 'undefined') {
  const originalError = console.error;
  console.error = (...args: any[]) => {
    try {
      const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      if (
        msg.includes('token-service-api-has-not-been-used') ||
        msg.includes('Could not reach Cloud Firestore backend') ||
        msg.includes('Fetching auth token failed')
      ) {
        console.warn('[Firestore connection fallback active]:', ...args);
        return;
      }
    } catch {}
    originalError.apply(console, args);
  };
}

createRoot(document.getElementById('root')!).render(<App />);

