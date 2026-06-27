import { supabase } from './supabaseClient';

// Claves que usa el componente Trastero en window.storage (= localStorage)
const KEYS = {
  songs: 'trastero:songs:v1',
  settings: 'trastero:settings:v1',
  folders: 'trastero:folders:v1',
};

const readJSON = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
};

export function readLocalDoc() {
  return {
    v: 1,
    songs: readJSON(KEYS.songs, {}),
    folders: readJSON(KEYS.folders, []),
    settings: readJSON(KEYS.settings, {}),
  };
}

export function writeLocalDoc(doc) {
  if (doc && doc.songs) localStorage.setItem(KEYS.songs, JSON.stringify(doc.songs));
  if (doc && doc.folders) localStorage.setItem(KEYS.folders, JSON.stringify(doc.folders));
  if (doc && doc.settings) localStorage.setItem(KEYS.settings, JSON.stringify(doc.settings));
}

// Fusión: canciones por id (gana la de updatedAt más reciente),
// carpetas por id (sin duplicar), ajustes (lo local manda sobre lo remoto).
export function mergeDocs(local, remote) {
  const l = local || {}, r = remote || {};
  const songs = { ...(r.songs || {}) };
  for (const [id, s] of Object.entries(l.songs || {})) {
    const prev = songs[id];
    if (!prev || (s.updatedAt || 0) >= (prev.updatedAt || 0)) songs[id] = s;
  }
  const seen = new Set();
  const folders = [];
  for (const f of [...(r.folders || []), ...(l.folders || [])]) {
    if (f && !seen.has(f.id)) { seen.add(f.id); folders.push(f); }
  }
  const settings = { ...(r.settings || {}), ...(l.settings || {}) };
  return { v: 1, songs, folders, settings };
}

// Al iniciar sesión: trae lo remoto, fusiona con lo local, escribe local y sube el resultado.
export async function pullMergePush(userId) {
  let remote = { songs: {}, folders: [], settings: {} };
  try {
    const { data, error } = await supabase
      .from('trastero_state').select('data').eq('user_id', userId).maybeSingle();
    if (!error && data && data.data) remote = data.data;
  } catch { /* sin conexión: seguimos con lo local */ }

  const merged = mergeDocs(readLocalDoc(), remote);
  writeLocalDoc(merged);
  try { await supabase.from('trastero_state').upsert({ user_id: userId, data: merged }); }
  catch { /* se reintentará en el siguiente guardado */ }
  return merged;
}

// Guardado en la nube (debounced desde AuthGate al detectar escrituras).
export async function pushDoc(userId) {
  try { await supabase.from('trastero_state').upsert({ user_id: userId, data: readLocalDoc() }); }
  catch { /* offline: el localStorage conserva los cambios */ }
}
