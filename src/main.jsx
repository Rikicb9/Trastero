import React from 'react';
import { createRoot } from 'react-dom/client';
import AuthGate from './AuthGate.jsx';

// El componente Trastero usa window.storage (API asíncrona del artifact).
// Aquí lo emulamos sobre localStorage y avisamos de cada escritura para
// que AuthGate suba los cambios a Supabase (debounced).
if (!window.storage) {
  window.storage = {
    async get(key) {
      const v = localStorage.getItem(key);
      return v == null ? null : { key, value: v, shared: false };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      window.dispatchEvent(new Event('trastero-write'));
      return { key, value, shared: false };
    },
    async delete(key) {
      localStorage.removeItem(key);
      window.dispatchEvent(new Event('trastero-write'));
      return { key, deleted: true, shared: false };
    },
  };
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>
);
