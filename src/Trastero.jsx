import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import { Plus, Play, Square, Trash2, Download, Wand2, Music, X, Loader2, Menu, HelpCircle, Copy, Repeat, Search, Upload, ListMusic, Folder, FolderPlus, ChevronDown, ChevronRight, GripVertical, Maximize2, SkipForward, SkipBack } from 'lucide-react';

/* ============================================================
   Trastero — editor + repositorio de tablaturas de guitarra
   MVP: rejilla de edición, audio (Tone.js), comandos en
   lenguaje natural (Claude API) y guardado local persistente.
   ============================================================ */

// --- Paleta (banco de luthier: madera, latón, ámbar) ---
const T = {
  bg: '#1A1714', surface: '#242019', panel: '#2E2620', edge: '#3A322A',
  line: '#6B5D4F', ink: '#EDE6D8', mut: '#8A7E6E', amber: '#E0A458', copper: '#D2674A',
};
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

// --- Afinaciones (de arriba/aguda a abajo/grave) ---
const TUNINGS = {
  standard:  { name: 'Estándar (E)',     labels: ['e','B','G','D','A','E'], notes: ['E4','B3','G3','D3','A2','E2'] },
  dropd:     { name: 'Drop D',           labels: ['e','B','G','D','A','D'], notes: ['E4','B3','G3','D3','A2','D2'] },
  halfstep:  { name: 'Medio tono abajo', labels: ['e','B','G','D','A','E'], notes: ['Eb4','Bb3','Gb3','Db3','Ab2','Eb2'] },
  dadgad:    { name: 'DADGAD',           labels: ['d','A','G','D','A','D'], notes: ['D4','A3','G3','D3','A2','D2'] },
};

const TECHS = { h:'hammer-on', p:'pull-off', b:'bend', s:'slide', '/':'slide ↑', '\\':'slide ↓', '~':'vibrato', x:'nota muerta' };

const EN_TO_ES = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
const toLabel = (note, notation) => {
  const m = String(note).match(/^([A-Ga-g])([#b]?)/);
  if (!m) return note;
  const letter = notation === 'es' ? EN_TO_ES[m[1].toUpperCase()] : m[1].toUpperCase();
  const acc = m[2] === '#' ? '♯' : m[2] === 'b' ? '♭' : '';
  return letter + acc;
};

// --- Helpers de modelo ---
const uid = () => Math.random().toString(36).slice(2, 9);
const emptyCell = () => ({ fret: null, tech: null });
const newColumn = () => ({ id: uid(), cells: Array.from({ length: 6 }, emptyCell) });
const newSection = (name, type = 'tab') => ({ id: uid(), name, type, columns: Array.from({ length: 16 }, newColumn), chords: ['', '', '', ''], repeats: {} });
const newSong = () => {
  const s = newSection('Intro');
  return { id: uid(), title: 'Nueva canción', artist: '', tuningKey: 'standard', bpm: 100, subdiv: 2, beatsPerBar: 4, tags: [], sections: [s], createdAt: Date.now(), updatedAt: Date.now() };
};

const noteFor = (open, fret) => Tone.Frequency(open).transpose(fret).toNote();

// --- Acordes: nombre (C, Am, Sol7, Do#m7, Fa…) -> notas ---
const ROOTS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11, do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };
const chordNotes = (raw) => {
  if (!raw || !raw.trim()) return [];
  const s = raw.trim(); const lower = s.toLowerCase();
  let rootPc = null, r = '';
  for (const k of ['sol', 'do', 're', 'mi', 'fa', 'la', 'si']) { if (lower.startsWith(k)) { rootPc = ROOTS[k]; r = s.slice(k.length); break; } }
  if (rootPc == null) { const c = lower[0]; if (/[a-g]/.test(c)) { rootPc = ROOTS[c]; r = s.slice(1); } }
  if (rootPc == null) return [];
  if (r[0] === '#' || r[0] === '♯') { rootPc = (rootPc + 1) % 12; r = r.slice(1); }
  else if (r[0] === 'b' || r[0] === '♭') { rootPc = (rootPc + 11) % 12; r = r.slice(1); }
  let iv;
  if (/maj7|M7/.test(r)) iv = [0, 4, 7, 11];
  else if (/m7|min7/i.test(r)) iv = [0, 3, 7, 10];
  else if (/7/.test(r)) iv = [0, 4, 7, 10];
  else if (/dim|°/i.test(r)) iv = [0, 3, 6];
  else if (/aug|\+/i.test(r)) iv = [0, 4, 8];
  else if (/sus2/i.test(r)) iv = [0, 2, 7];
  else if (/sus/i.test(r)) iv = [0, 5, 7];
  else if (/^m(?!a)/i.test(r) || /min/i.test(r)) iv = [0, 3, 7];
  else iv = [0, 4, 7];
  const midi = 48 + rootPc;
  return iv.map((x) => Tone.Frequency(midi + x, 'midi').toNote());
};

// --- Importador de tablatura ASCII (best-effort) ---
const parseTabBlock = (six) => {
  const bodies = six.map((l) => { const i = l.indexOf('|'); return i >= 0 ? l.slice(i + 1) : l; });
  const len = Math.max(0, ...bodies.map((b) => b.length));
  const cols = []; let pos = 0;
  while (pos < len) {
    const cells = []; let advance = 1;
    for (let s = 0; s < 6; s++) {
      const b = bodies[s] || ''; const ch = b[pos] || '-';
      if (/[0-9]/.test(ch)) {
        let num = ch;
        if (/[0-9]/.test(b[pos + 1] || '')) { num += b[pos + 1]; advance = Math.max(advance, 2); }
        cells.push({ fret: Math.min(24, parseInt(num, 10)), tech: null });
      } else if (ch === 'x' || ch === 'X') cells.push({ fret: null, tech: 'x' });
      else cells.push({ fret: null, tech: null });
    }
    if (cells.some((c) => c.fret != null || c.tech === 'x')) cols.push({ id: uid(), cells });
    pos += advance;
  }
  return cols;
};

const parseAscii = (text) => {
  const lines = text.split(/\r?\n/);
  const sections = []; let curName = 'Importado'; let block = [];
  const isTabLine = (l) => /\|/.test(l) && (l.match(/-/g) || []).length >= 2;
  const flush = () => { if (block.length >= 6) { const cols = parseTabBlock(block.slice(0, 6)); if (cols.length) sections.push({ id: uid(), name: curName, columns: cols, repeats: {} }); } block = []; };
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    const sec = l.match(/^\s*\[(.+?)\]/);
    if (sec) { flush(); curName = sec[1]; continue; }
    if (isTabLine(l)) { block.push(l); if (block.length === 6) flush(); }
    else if (block.length && block.length < 6) block = [];
  }
  flush();
  return sections.length ? sections : null;
};

const normalizeCells = (cells) => {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const c = (cells && cells[i]) || {};
    const fret = typeof c.fret === 'number' && c.fret >= 0 && c.fret <= 24 ? Math.round(c.fret) : null;
    const tech = typeof c.tech === 'string' && (TECHS[c.tech]) ? c.tech : null;
    out.push({ fret, tech });
  }
  return out;
};

const cellStr = (cell) => {
  if (cell.tech === 'x' && cell.fret == null) return 'x';
  if (cell.fret == null) return '';
  return String(cell.fret) + (cell.tech && cell.tech !== 'x' ? cell.tech : '');
};

const asciiSection = (sec, labels, cpb, repeats) => {
  const cols = sec.columns;
  const lw = Math.max(1, ...labels.map((l) => l.length));
  const widths = cols.map((c) => Math.max(1, ...c.cells.map((cell) => cellStr(cell).length)));
  return labels.map((lab, s) => {
    let line = lab.padEnd(lw, ' ') + '|';
    cols.forEach((c, ci) => {
      if (ci > 0 && ci % cpb === 0) {
        const closeRep = (repeats?.[cols[ci - 1].id] || 1) > 1;
        line += '-' + (closeRep ? ':' : '') + '|';
      }
      line += '-' + cellStr(c.cells[s]).padEnd(widths[ci], '-');
    });
    const lastClose = (repeats?.[cols[cols.length - 1].id] || 1) > 1;
    return line + '-' + (lastClose ? ':' : '') + '|';
  }).join('\n');
};

const asciiExport = (song, notation) => {
  const tn = TUNINGS[song.tuningKey];
  const labels = tn.notes.map((n) => toLabel(n, notation));
  const cpb = (song.beatsPerBar || 4) * song.subdiv;
  let out = `${song.title}${song.artist ? ' — ' + song.artist : ''}\nAfinación: ${tn.name} · ${song.bpm} BPM\n`;
  song.sections.forEach((sec) => {
    out += `\n[${sec.name}]\n`;
    if ((sec.type || 'tab') === 'chords') {
      const ch = (sec.chords || []).map((c) => c || '·');
      out += (ch.length ? ch.join('  |  ') : '(sin acordes)') + '\n';
      return;
    }
    out += `${asciiSection(sec, labels, cpb, sec.repeats)}\n`;
    const reps = []; let mi = 0;
    for (let i = 0; i < sec.columns.length; i += cpb) {
      const end = Math.min(i + cpb, sec.columns.length);
      const r = sec.repeats?.[sec.columns[end - 1].id] || 1;
      if (r > 1) reps.push(`compás ${mi + 1} ×${r}`);
      mi++;
    }
    if (reps.length) out += `Repeticiones: ${reps.join(' · ')}\n`;
  });
  return out + '\nCreado con Trastero';
};

// --- Adaptador de almacenamiento ---
// En Claude.ai usa el almacenamiento persistente del artifact.
// Para exportar a tu entorno local: sustituye get/set por localStorage.
const KEY = 'trastero:songs:v1';
const SKEY = 'trastero:settings:v1';
const FKEY = 'trastero:folders:v1';
const store = {
  async load() {
    try { const r = await window.storage.get(KEY, false); return r ? JSON.parse(r.value) : null; }
    catch { return null; }
  },
  async save(songs) {
    try { await window.storage.set(KEY, JSON.stringify(songs), false); } catch { /* no-op */ }
  },
  async loadFolders() {
    try { const r = await window.storage.get(FKEY, false); return r ? JSON.parse(r.value) : null; }
    catch { return null; }
  },
  async saveFolders(folders) {
    try { await window.storage.set(FKEY, JSON.stringify(folders), false); } catch { /* no-op */ }
  },
  async loadSettings() {
    try { const r = await window.storage.get(SKEY, false); return r ? JSON.parse(r.value) : null; }
    catch { return null; }
  },
  async saveSettings(s) {
    try { await window.storage.set(SKEY, JSON.stringify(s), false); } catch { /* no-op */ }
  },
};

const COLW = 30, ROWH = 30, LABELW = 34;

export default function App() {
  const [songs, setSongs] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [activeSecId, setActiveSecId] = useState(null);
  const [cursor, setCursor] = useState({ col: 0, str: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playCol, setPlayCol] = useState(-1);
  const [playSec, setPlaySec] = useState(null);
  const [nl, setNl] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [nlMsg, setNlMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hoverBar, setHoverBar] = useState(-1);
  const [notation, setNotation] = useState('en');
  const [latencyOffset, setLatencyOffset] = useState(0);
  const [bpmText, setBpmText] = useState('100');
  const [loop, setLoop] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [backupOpen, setBackupOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreText, setRestoreText] = useState('');
  const [restoreMsg, setRestoreMsg] = useState('');
  const [query, setQuery] = useState('');
  const [folders, setFolders] = useState([]);
  const [collapsed, setCollapsed] = useState({});
  const [dragOver, setDragOver] = useState(null); // {type:'song'|'folder'|'root', id}
  const dragSong = useRef(null);
  const dragSec = useRef(null);
  const backupTaRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [dragOverSec, setDragOverSec] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [toolbarOpen, setToolbarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 760 : true));
  const [zoom, setZoom] = useState(() => {
    try { const z = parseFloat(localStorage.getItem('trastero:zoom:v1')); return z >= 0.4 && z <= 3 ? z : 1; } catch { return 1; }
  });
  const pinch = useRef(null);

  const synthRef = useRef(null);
  const metroRef = useRef(null);
  const playTimer = useRef(null);
  const playToken = useRef(0);
  const visualTimers = useRef([]);
  const bufRef = useRef(null);
  const bufTimer = useRef(null);
  const gridRef = useRef(null);

  const song = songs[activeId];
  const section = song?.sections.find((s) => s.id === activeSecId);
  const tuning = song ? TUNINGS[song.tuningKey] : TUNINGS.standard;

  // Carga inicial
  useEffect(() => { (async () => {
    const set = await store.loadSettings(); if (set?.notation) setNotation(set.notation); if (typeof set?.latencyOffset === 'number') setLatencyOffset(set.latencyOffset);
    const fold = await store.loadFolders(); if (Array.isArray(fold)) setFolders(fold);
    const data = await store.load();
    if (data && Object.keys(data).length) {
      setSongs(data);
      const first = Object.values(data).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      setActiveId(first.id); setActiveSecId(first.sections[0].id);
    } else {
      const s = newSong(); setSongs({ [s.id]: s }); setActiveId(s.id); setActiveSecId(s.sections[0].id);
    }
    setLoaded(true);
  })(); }, []);

  // Responsivo
  useEffect(() => {
    const onResize = () => { const n = window.innerWidth < 760; setNarrow(n); setSidebarOpen(!n); };
    onResize(); window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize);
  }, []);

  // Persistir el zoom (local al dispositivo, no se sincroniza)
  useEffect(() => { try { localStorage.setItem('trastero:zoom:v1', String(zoom)); } catch { /* */ } }, [zoom]);

  // Mantener la pantalla encendida durante el directo (Wake Lock)
  useEffect(() => {
    if (!concert) return;
    let lock = null, released = false;
    const acquire = async () => { try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch { /* no soportado */ } };
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible' && !released) acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { released = true; document.removeEventListener('visibilitychange', onVis); try { lock && lock.release(); } catch { /* */ } };
  }, [concert]);

  // Zoom de la partitura con dos dedos (pellizco)
  useEffect(() => {
    const el = gridRef.current; if (!el) return;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e) => { if (e.touches.length === 2) { pinch.current = { d0: dist(e.touches), z0: zoom }; } };
    const onMove = (e) => {
      if (e.touches.length === 2 && pinch.current) {
        e.preventDefault();
        const ratio = dist(e.touches) / (pinch.current.d0 || 1);
        const z = Math.max(0.5, Math.min(2.5, pinch.current.z0 * ratio));
        setZoom(Math.round(z * 100) / 100);
      }
    };
    const onEnd = (e) => { if (e.touches.length < 2) pinch.current = null; };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); el.removeEventListener('touchend', onEnd); el.removeEventListener('touchcancel', onEnd); };
  }, [zoom]);

  // Persistir preferencia de notación
  useEffect(() => { if (loaded) store.saveSettings({ notation, latencyOffset }); }, [notation, latencyOffset, loaded]);

  // Persistir carpetas
  useEffect(() => { if (loaded) store.saveFolders(folders); }, [folders, loaded]);

  // Sincronizar el campo de BPM al cambiar de canción
  useEffect(() => { if (songs[activeId]) setBpmText(String(songs[activeId].bpm)); /* eslint-disable-next-line */ }, [activeId]);

  // Autoguardado (debounce)
  useEffect(() => {
    if (!loaded) return;
    setSaving(true);
    const t = setTimeout(async () => { await store.save(songs); setSaving(false); }, 500);
    return () => clearTimeout(t);
  }, [songs, loaded]);

  // Limpieza de audio
  useEffect(() => () => { clearTimeout(playTimer.current); if (synthRef.current) synthRef.current.dispose(); if (metroRef.current) metroRef.current.dispose(); }, []);

  // Auto-scroll de la tablatura siguiendo el cabezal de reproducción
  useEffect(() => {
    if (playCol < 0 || !playSec || !gridRef.current) return;
    const cont = gridRef.current;
    const el = cont.querySelector(`[data-sec="${playSec}"][data-col="${playCol}"]`);
    if (!el) return;
    const er = el.getBoundingClientRect(), cr = cont.getBoundingClientRect();
    const m = 110;
    if (er.left < cr.left + m) cont.scrollBy({ left: er.left - cr.left - m, behavior: 'smooth' });
    else if (er.right > cr.right - m) cont.scrollBy({ left: er.right - cr.right + m, behavior: 'smooth' });
    if (er.top < cr.top + 12) cont.scrollBy({ top: er.top - cr.top - 12, behavior: 'smooth' });
    else if (er.bottom > cr.bottom - 12) cont.scrollBy({ top: er.bottom - cr.bottom + 12, behavior: 'smooth' });
  }, [playCol, playSec]);

  // --- Mutaciones ---
  const updateSong = useCallback((id, patch) => {
    setSongs((prev) => prev[id] ? { ...prev, [id]: { ...prev[id], ...patch, updatedAt: Date.now() } } : prev);
  }, []);

  const updateSection = useCallback((secId, fn) => {
    setSongs((prev) => {
      const sg = prev[activeId]; if (!sg) return prev;
      return { ...prev, [activeId]: { ...sg, sections: sg.sections.map((s) => (s.id === secId ? fn(s) : s)), updatedAt: Date.now() } };
    });
  }, [activeId]);
  const updateActiveSection = useCallback((fn) => updateSection(activeSecId, fn), [updateSection, activeSecId]);

  const patchCell = useCallback((secId, col, str, patch) => {
    updateSection(secId, (sec) => ({
      ...sec,
      columns: sec.columns.map((c, ci) => ci !== col ? c : { ...c, cells: c.cells.map((cell, si) => si !== str ? cell : { ...cell, ...patch }) }),
    }));
  }, [updateSection]);

  const addColumnEnd = useCallback((secId) => updateSection(secId, (sec) => ({ ...sec, columns: [...sec.columns, newColumn()] })), [updateSection]);
  const addMeasureEnd = useCallback((secId) => {
    const cpb = (song?.beatsPerBar || 4) * (song?.subdiv || 2);
    updateSection(secId, (sec) => ({ ...sec, columns: [...sec.columns, ...Array.from({ length: cpb }, newColumn)] }));
  }, [song?.beatsPerBar, song?.subdiv, updateSection]);
  const insertColumnAfter = useCallback((secId, idx) => updateSection(secId, (sec) => { const cols = [...sec.columns]; cols.splice(idx + 1, 0, newColumn()); return { ...sec, columns: cols }; }), [updateSection]);

  const duplicateMeasure = useCallback((secId, mIdx) => {
    const cpb = (song?.beatsPerBar || 4) * (song?.subdiv || 2);
    updateSection(secId, (sec) => {
      const start = mIdx * cpb;
      if (start >= sec.columns.length) return sec;
      const end = Math.min(start + cpb, sec.columns.length);
      const copy = sec.columns.slice(start, end).map((c) => ({ id: uid(), cells: c.cells.map((x) => ({ ...x })) }));
      return { ...sec, columns: [...sec.columns.slice(0, end), ...copy, ...sec.columns.slice(end)] };
    });
  }, [song?.beatsPerBar, song?.subdiv, updateSection]);

  const deleteMeasure = useCallback((secId, mIdx) => {
    const cpb = (song?.beatsPerBar || 4) * (song?.subdiv || 2);
    updateSection(secId, (sec) => {
      const start = mIdx * cpb;
      const end = Math.min(start + cpb, sec.columns.length);
      const cols = [...sec.columns.slice(0, start), ...sec.columns.slice(end)];
      const final = cols.length ? cols : [newColumn()];
      const ids = new Set(final.map((c) => c.id));
      const reps = Object.fromEntries(Object.entries(sec.repeats || {}).filter(([k]) => ids.has(k)));
      return { ...sec, columns: final, repeats: reps };
    });
  }, [song?.beatsPerBar, song?.subdiv, updateSection]);

  const setRepeat = useCallback((secId, anchorId, n) => {
    updateSection(secId, (sec) => {
      const reps = { ...(sec.repeats || {}) };
      if (n <= 1) delete reps[anchorId]; else reps[anchorId] = Math.min(16, n);
      return { ...sec, repeats: reps };
    });
  }, [updateSection]);

  const setSectionType = useCallback((secId, type) => updateSection(secId, (s) => ({ ...s, type })), [updateSection]);
  const setChord = useCallback((secId, i, val) => updateSection(secId, (s) => { const ch = [...(s.chords || [])]; ch[i] = val; return { ...s, chords: ch }; }), [updateSection]);
  const addChord = useCallback((secId) => updateSection(secId, (s) => ({ ...s, chords: [...(s.chords || []), ''] })), [updateSection]);
  const removeChord = useCallback((secId, i) => updateSection(secId, (s) => ({ ...s, chords: (s.chords || []).filter((_, j) => j !== i) })), [updateSection]);

  const armBuf = () => { clearTimeout(bufTimer.current); bufTimer.current = setTimeout(() => { bufRef.current = null; }, 900); };

  // --- Teclado ---
  const handleKey = useCallback((e) => {
    if (!section || (section.type || 'tab') === 'chords') return;
    const { col, str } = cursor;
    const last = section.columns.length - 1;
    const move = (c, s) => { bufRef.current = null; setCursor({ col: c, str: s }); };

    if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      const cpb = (song?.beatsPerBar || 4) * (song?.subdiv || 2);
      const mIdx = Math.floor(col / cpb);
      duplicateMeasure(activeSecId, mIdx);
      move(Math.min((mIdx + 1) * cpb, section.columns.length), str);
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const key = `${col},${str}`;
      const buf = bufRef.current;
      let val;
      if (buf && buf.key === key) { const cand = buf.val + e.key; val = parseInt(cand, 10) <= 24 ? cand : e.key; }
      else val = e.key;
      bufRef.current = { key, val }; armBuf();
      patchCell(activeSecId, col, str, { fret: parseInt(val, 10), tech: null });
      return;
    }
    if (e.key === 'x') { e.preventDefault(); patchCell(activeSecId, col, str, { fret: null, tech: 'x' }); bufRef.current = null; return; }
    if (Object.prototype.hasOwnProperty.call(TECHS, e.key) && e.key !== 'x') {
      e.preventDefault(); patchCell(activeSecId, col, str, { tech: e.key }); bufRef.current = null; return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); patchCell(activeSecId, col, str, { fret: null, tech: null }); bufRef.current = null; return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); move(Math.max(0, col - 1), str); return; }
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      if (col >= last) { addColumnEnd(activeSecId); move(col + 1, str); } else move(col + 1, str);
      return;
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(col, Math.max(0, str - 1)); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(col, Math.min(5, str + 1)); return; }
    if (e.key === ' ') { e.preventDefault(); insertColumnAfter(activeSecId, col); move(col + 1, str); return; }
  }, [section, activeSecId, cursor, patchCell, addColumnEnd, insertColumnAfter, duplicateMeasure, song?.beatsPerBar, song?.subdiv]);

  // --- Audio ---
  const stop = useCallback(() => {
    playToken.current++; // invalida resaltados visuales pendientes
    clearTimeout(playTimer.current);
    visualTimers.current.forEach((t) => clearTimeout(t)); visualTimers.current = [];
    setIsPlaying(false); setPlayCol(-1); setPlaySec(null);
  }, []);
  const play = useCallback(async (mode = 'section', secOverride) => {
    if (isPlaying) { stop(); return; }
    const baseSec = secOverride ? song.sections.find((s) => s.id === secOverride) : section;
    if (!baseSec) return;
    await Tone.start();
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' }, envelope: { attack: 0.004, decay: 0.35, sustain: 0.08, release: 0.6 },
      }).toDestination();
      synthRef.current.volume.value = -7;
    }
    if (!metroRef.current) {
      metroRef.current = new Tone.MembraneSynth({ pitchDecay: 0.006, octaves: 4, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 } }).toDestination();
      metroRef.current.volume.value = -8;
    }
    const open = tuning.notes;
    const cpb = (song.beatsPerBar || 4) * song.subdiv;
    const secs = mode === 'all' ? song.sections : [baseSec];
    const stepDur = ((60 / song.bpm) / song.subdiv) / (speed || 1);
    // Plan por paso: sección, columna/acorde, notas, duración, pulso
    const plan = [];
    secs.forEach((sec) => {
      if ((sec.type || 'tab') === 'chords') {
        (sec.chords || []).forEach((name, ix) => {
          const cn = chordNotes(name);
          for (let k = 0; k < cpb; k++) plan.push({ secId: sec.id, ci: ix, notes: k === 0 ? cn : [], dur: stepDur * cpb * 0.95, beat: k % song.subdiv === 0, accent: k === 0 });
        });
      } else {
        for (let m = 0; m < sec.columns.length; m += cpb) {
          const end = Math.min(m + cpb, sec.columns.length);
          const rep = sec.repeats?.[sec.columns[end - 1].id] || 1;
          for (let r = 0; r < rep; r++) for (let j = m; j < end; j++) {
            const notes = [];
            sec.columns[j].cells.forEach((cell, s) => { if (cell.fret != null && cell.tech !== 'x') notes.push(noteFor(open[s], cell.fret)); });
            plan.push({ secId: sec.id, ci: j, notes, dur: stepDur * 0.9, beat: j % song.subdiv === 0, accent: j % cpb === 0 });
          }
        }
      }
    });
    if (!plan.length) return;
    // Compensación visual = latencia de salida medida (Bluetooth/cable) + calibración manual
    let outMs = 0;
    try { const raw = Tone.getContext().rawContext; outMs = Math.round(((raw.outputLatency || 0) + (raw.baseLatency || 0)) * 1000); } catch { outMs = 0; }
    const comp = Math.max(0, outMs + latencyOffset);
    playToken.current++; const tok = playToken.current;
    let i = 0; setIsPlaying(true);
    const tick = () => {
      if (i >= plan.length) { if (loop && mode === 'section') i = 0; else { stop(); return; } }
      const step = plan[i];
      if (metronome && step.beat) metroRef.current.triggerAttackRelease(step.accent ? 'C3' : 'C2', '32n');
      if (step.notes.length) synthRef.current.triggerAttackRelease(step.notes, step.dur || stepDur * 0.9); // audio ahora (se oye tras la latencia)
      const showCol = step.ci, showSec = step.secId;
      const vt = setTimeout(() => { if (playToken.current !== tok) return; setPlaySec(showSec); setPlayCol(showCol); }, comp);
      visualTimers.current.push(vt);
      i++; playTimer.current = setTimeout(tick, stepDur * 1000);
    };
    tick();
  }, [isPlaying, section, song, tuning, speed, loop, metronome, latencyOffset, stop]);

  // --- Lenguaje natural (Claude API) ---
  const runNL = useCallback(async () => {
    if (!nl.trim() || nlBusy || !section) return;
    // Atajo local: transposición (instantánea y fiable, sin API)
    const t = nl.toLowerCase();
    const transpVerb = /(transp|trasp)/.test(t);
    const upDown = /(sube|subir|baja|bajar)/.test(t) && /(traste|semitono|tono)/.test(t);
    if ((transpVerb || upDown) && /-?\d+/.test(t)) {
      let d = Math.abs(parseInt(t.match(/-?\d+/)[0], 10));
      if (/(abajo|baja|bajar|descend|menos)/.test(t) && !/(arriba|sube|subir)/.test(t)) d = -d;
      updateActiveSection((sec) => ({ ...sec, columns: sec.columns.map((c) => ({ ...c, cells: c.cells.map((cell) => cell.fret == null ? cell : { ...cell, fret: Math.max(0, Math.min(24, cell.fret + d)) }) })) }));
      setNlMsg(`Transpuesto ${d >= 0 ? '+' : ''}${d} traste(s).`); setNl(''); return;
    }
    setNlBusy(true); setNlMsg('');
    try {
      const labels = tuning.notes.map((n) => toLabel(n, notation));
      const compact = section.columns.map((c) => c.cells.map((cell) => cell.fret == null ? (cell.tech === 'x' ? 'x' : '-') : (cell.fret + (cell.tech && cell.tech !== 'x' ? cell.tech : ''))).join('|'));
      const sys = `Eres un asistente de tablatura de guitarra de 6 cuerdas (de aguda a grave): ${labels.join(', ')}. Afinación ${tuning.name}, al aire ${tuning.notes.join(', ')}. Devuelve SOLO un objeto JSON (sin markdown, sin texto extra) con la forma: {"message":"<breve, español>","cols":["t0|t1|t2|t3|t4|t5", ...]}. Cada cadena de "cols" es una columna: 6 cuerdas separadas por "|" (índice 0 = cuerda superior/aguda). Cada cuerda es el traste 0-24, opcionalmente seguido de una técnica (h,p,b,s,/,\\\\,~,x), o "-" si no suena. Devuelve TODAS las columnas resultantes.`;
      const userMsg = `Comando: ${nl}\n\nTablatura actual (cols): ${JSON.stringify(compact)}`;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, system: sys, messages: [{ role: 'user', content: userMsg }] }),
      });
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const raw = text.replace(/```json|```/g, '').trim();
      const a = raw.indexOf('{'), z = raw.lastIndexOf('}');
      const parsed = JSON.parse(a >= 0 && z > a ? raw.slice(a, z + 1) : raw);
      const src = parsed.cols || parsed.columns || [];
      const columns = src.map((c) => {
        if (typeof c === 'string') {
          const parts = c.split('|'); const cells = [];
          for (let i = 0; i < 6; i++) {
            const tok = (parts[i] || '-').trim();
            if (tok === '-' || tok === '') { cells.push({ fret: null, tech: null }); continue; }
            if (tok === 'x' || tok === 'X') { cells.push({ fret: null, tech: 'x' }); continue; }
            const mm = tok.match(/^(\d{1,2})(.*)$/);
            cells.push(mm ? { fret: Math.min(24, parseInt(mm[1], 10)), tech: (mm[2] && TECHS[mm[2]]) ? mm[2] : null } : { fret: null, tech: null });
          }
          return { id: uid(), cells };
        }
        return { id: uid(), cells: normalizeCells(c.cells) };
      });
      if (columns.length) { updateActiveSection((sec) => ({ ...sec, columns })); setCursor({ col: 0, str: 0 }); }
      setNlMsg(parsed.message || 'Hecho.'); setNl('');
    } catch {
      setNlMsg('No pude interpretar la respuesta. Prueba a reformular o acortar el comando.');
    } finally { setNlBusy(false); }
  }, [nl, nlBusy, section, tuning, notation, updateActiveSection]);

  // --- Canciones / secciones ---
  const topOrder = (folderId) => {
    const os = Object.values(songs).filter((s) => (s.folderId || null) === (folderId || null)).map((s) => (typeof s.order === 'number' ? s.order : 0));
    return (os.length ? Math.min(...os) : 0) - 1;
  };
  const selectSong = (id) => { setActiveId(id); setActiveSecId(songs[id].sections[0].id); setCursor({ col: 0, str: 0 }); stop(); if (narrow) setSidebarOpen(false); };

  // --- Modo Concierto (directo) ---
  const [concert, setConcert] = useState(null); // { ids: [...songId], i }
  const goToSong = (id) => { const s = songs[id]; if (!s) return; setActiveId(id); setActiveSecId(s.sections[0].id); setCursor({ col: 0, str: 0 }); stop(); requestAnimationFrame(() => { if (gridRef.current) gridRef.current.scrollTo(0, 0); }); };
  const startConcert = (folderId, startId) => {
    const ids = inFolder(folderId).map((s) => s.id);
    if (!ids.length) return;
    let i = startId ? ids.indexOf(startId) : 0; if (i < 0) i = 0;
    setSidebarOpen(false); setConcert({ ids, i }); goToSong(ids[i]);
  };
  const concertStep = (delta) => {
    setConcert((c) => {
      if (!c) return c;
      const i = Math.max(0, Math.min(c.ids.length - 1, c.i + delta));
      goToSong(c.ids[i]);
      return { ...c, i };
    });
  };
  const exitConcert = () => { setConcert(null); stop(); };
  const createSong = () => { const s = { ...newSong(), folderId: null, order: topOrder(null) }; setSongs((p) => ({ ...p, [s.id]: s })); setActiveId(s.id); setActiveSecId(s.sections[0].id); setCursor({ col: 0, str: 0 }); };
  // Carpetas
  const addFolder = () => setFolders((f) => [...f, { id: uid(), name: 'Nueva carpeta' }]);
  const renameFolder = (id, name) => setFolders((f) => f.map((x) => (x.id === id ? { ...x, name } : x)));
  const deleteFolder = (id) => {
    setSongs((prev) => { const next = { ...prev }; Object.values(next).forEach((s) => { if (s.folderId === id) next[s.id] = { ...s, folderId: null }; }); return next; });
    setFolders((f) => f.filter((x) => x.id !== id));
  };
  const toggleFolder = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  // Arrastrar canción: reordenar dentro de una carpeta o moverla a otra
  const moveSong = (dragId, targetFolderId, beforeId) => {
    setSongs((prev) => {
      const drag = prev[dragId]; if (!drag) return prev;
      const tf = targetFolderId ?? null;
      const list = Object.values(prev)
        .filter((s) => (s.folderId || null) === tf && s.id !== dragId)
        .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || b.updatedAt - a.updatedAt);
      let idx = beforeId ? list.findIndex((s) => s.id === beforeId) : list.length;
      if (idx < 0) idx = list.length;
      list.splice(idx, 0, drag);
      const next = { ...prev };
      list.forEach((s, i) => { next[s.id] = { ...next[s.id], folderId: tf, order: i }; });
      return next;
    });
    setDragOver(null); dragSong.current = null;
  };
  const dupSectionDeep = (s) => {
    const map = {};
    const columns = s.columns.map((c) => { const nid = uid(); map[c.id] = nid; return { id: nid, cells: c.cells.map((x) => ({ ...x })) }; });
    const repeats = {}; Object.entries(s.repeats || {}).forEach(([k, v]) => { if (map[k]) repeats[map[k]] = v; });
    return { id: uid(), name: s.name, columns, repeats };
  };
  const duplicateSong = (id) => {
    const src = songs[id];
    const copy = { ...src, id: uid(), title: src.title + ' (copia)', sections: src.sections.map(dupSectionDeep), createdAt: Date.now(), updatedAt: Date.now() };
    setSongs((p) => ({ ...p, [copy.id]: copy })); setActiveId(copy.id); setActiveSecId(copy.sections[0].id); setCursor({ col: 0, str: 0 });
  };
  const doImport = () => {
    const secs = parseAscii(importText);
    if (!secs) { setImportMsg('No reconocí ninguna tablatura. Pega 6 líneas por bloque (e B G D A E) con | y guiones.'); return; }
    const s = { ...newSong(), title: 'Tablatura importada', sections: secs, folderId: null, order: topOrder(null) };
    setSongs((p) => ({ ...p, [s.id]: s })); setActiveId(s.id); setActiveSecId(s.sections[0].id); setCursor({ col: 0, str: 0 });
    setImportOpen(false); setImportText(''); setImportMsg('');
  };
  const backupJSON = () => JSON.stringify({ v: 1, exported: new Date().toISOString(), songs, folders, settings: { notation, latencyOffset } }, null, 2);
  const copyBackup = async () => {
    const text = backupJSON(); let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fallback */ }
    if (!ok && backupTaRef.current) {
      backupTaRef.current.focus(); backupTaRef.current.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
    }
    setCopied(ok); if (ok) setTimeout(() => setCopied(false), 2000);
  };
  const downloadBackup = () => {
    const text = backupJSON();
    try {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `trastero-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
    } catch {
      try { const a = document.createElement('a'); a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(text); a.download = `trastero-backup.json`; a.click(); } catch { /* descarga bloqueada: usar Copiar */ }
    }
  };
  const doRestore = (text) => {
    let parsed; try { parsed = JSON.parse(text); } catch { setRestoreMsg('El archivo no es un JSON válido.'); return; }
    const inSongs = parsed && parsed.songs && typeof parsed.songs === 'object' ? parsed.songs : null;
    if (!inSongs) { setRestoreMsg('No encontré canciones en la copia. ¿Es un backup de Trastero?'); return; }
    const inFolders = Array.isArray(parsed.folders) ? parsed.folders : [];
    setSongs((prev) => ({ ...prev, ...inSongs })); // fusiona por id (la copia gana)
    setFolders((prev) => { const ids = new Set(prev.map((f) => f.id)); return [...prev, ...inFolders.filter((f) => f && !ids.has(f.id))]; });
    if (parsed.settings) { if (parsed.settings.notation) setNotation(parsed.settings.notation); if (typeof parsed.settings.latencyOffset === 'number') setLatencyOffset(parsed.settings.latencyOffset); }
    const first = Object.values(inSongs)[0];
    if (first && first.sections && first.sections[0]) { setActiveId(first.id); setActiveSecId(first.sections[0].id); setCursor({ col: 0, str: 0 }); }
    setRestoreOpen(false); setRestoreText(''); setRestoreMsg('');
  };
  const onRestoreFile = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => doRestore(String(r.result)); r.readAsText(f); e.target.value = '';
  };
  const deleteSong = (id) => {
    setSongs((prev) => { const next = { ...prev }; delete next[id]; if (id === activeId) {
      const rest = Object.values(next).sort((a, b) => b.updatedAt - a.updatedAt);
      if (rest.length) { setActiveId(rest[0].id); setActiveSecId(rest[0].sections[0].id); }
      else { const s = newSong(); next[s.id] = s; setActiveId(s.id); setActiveSecId(s.sections[0].id); }
    } return next; });
  };
  const addSection = (type = 'tab') => {
    const ns = newSection('Sección ' + (song.sections.length + 1), type);
    setSongs((p) => ({ ...p, [activeId]: { ...p[activeId], sections: [...p[activeId].sections, ns], updatedAt: Date.now() } }));
    setActiveSecId(ns.id); setCursor({ col: 0, str: 0 });
  };
  const moveSection = (dragId, beforeId) => {
    if (dragId && dragId !== beforeId) {
      setSongs((prev) => {
        const sg = prev[activeId]; if (!sg) return prev;
        const list = [...sg.sections];
        const from = list.findIndex((s) => s.id === dragId);
        if (from < 0) return prev;
        const [moved] = list.splice(from, 1);
        let to = beforeId ? list.findIndex((s) => s.id === beforeId) : list.length;
        if (to < 0) to = list.length;
        list.splice(to, 0, moved);
        return { ...prev, [activeId]: { ...sg, sections: list, updatedAt: Date.now() } };
      });
    }
    setDragOverSec(null); dragSec.current = null;
  };
  const deleteSection = (secId) => {
    const id = secId || activeSecId;
    if (song.sections.length <= 1) return;
    const rest = song.sections.filter((s) => s.id !== id);
    updateSong(activeId, { sections: rest });
    if (activeSecId === id) { setActiveSecId(rest[0].id); setCursor({ col: 0, str: 0 }); }
  };

  const downloadTxt = () => {
    const blob = new Blob([asciiExport(song, notation)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${song.title.replace(/[^\w\d-]+/g, '_')}.txt`; a.click(); URL.revokeObjectURL(a.href);
  };

  if (!loaded || !song || !section) {
    return <div style={{ minHeight: '100vh', background: T.bg, color: T.mut, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SANS }}><Loader2 size={18} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} /> Cargando repositorio…</div>;
  }

  const colsPerBar = (song.beatsPerBar || 4) * song.subdiv;
  const labels = tuning.notes.map((n) => toLabel(n, notation));
  const GUT = 30; // espacio extra al final de un compás repetido para el signo
  const layoutOf = (sec) => {
    const ms = [];
    for (let i = 0; i < sec.columns.length; i += colsPerBar) ms.push({ idx: ms.length, start: i, count: Math.min(colsPerBar, sec.columns.length - i) });
    let _mx = LABELW;
    const mlayout = ms.map((m) => {
      const repeat = (sec.repeats?.[sec.columns[m.start + m.count - 1].id] || 1) > 1;
      const x = _mx; const colsW = m.count * COLW; _mx += colsW;
      const gutX = _mx; if (repeat) _mx += GUT;
      return { ...m, x, colsW, repeat, gutX };
    });
    const gutterAfter = new Set(mlayout.filter((m) => m.repeat).map((m) => m.start + m.count - 1));
    return { mlayout, gutterAfter };
  };

  const q = query.trim().toLowerCase();
  const match = (s) => !q || `${s.title} ${s.artist} ${(s.tags || []).join(' ')}`.toLowerCase().includes(q);
  const inFolder = (fid) => Object.values(songs).filter((s) => (s.folderId || null) === (fid || null) && match(s)).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || b.updatedAt - a.updatedAt);
  const totalCount = Object.values(songs).filter(match).length;
  const btn = (extra = {}) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${T.edge}`, background: T.surface, color: T.ink, borderRadius: 8, padding: '7px 11px', fontSize: 13, cursor: 'pointer', fontFamily: SANS, ...extra });
  const SongRow = (s) => (
    <div key={s.id} draggable
      onDragStart={(e) => { dragSong.current = s.id; e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { setDragOver(null); dragSong.current = null; }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (dragSong.current && dragSong.current !== s.id) setDragOver({ type: 'song', id: s.id }); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragSong.current) moveSong(dragSong.current, s.folderId || null, s.id); }}
      onClick={() => selectSong(s.id)}
      style={{ padding: '7px 8px', borderRadius: 8, cursor: 'pointer', background: s.id === activeId ? T.panel : 'transparent', borderTop: `2px solid ${dragOver && dragOver.type === 'song' && dragOver.id === s.id ? T.amber : 'transparent'}`, border: `1px solid ${s.id === activeId ? T.edge : 'transparent'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <GripVertical size={13} color={T.mut} style={{ flexShrink: 0, cursor: 'grab' }} />
        <span style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || 'Sin título'}</div>
          <div style={{ fontSize: 11, color: T.mut, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.artist || '—'} · {s.sections.length} secc.{(s.tags && s.tags.length) ? ' · ' + s.tags.join(', ') : ''}</div>
        </span>
      </span>
      <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <Copy size={13} color={T.mut} onClick={(e) => { e.stopPropagation(); duplicateSong(s.id); }} title="Duplicar canción" />
        <Trash2 size={14} color={T.mut} onClick={(e) => { e.stopPropagation(); deleteSong(s.id); }} title="Eliminar" />
      </span>
    </div>
  );

  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: T.bg, color: T.ink, fontFamily: SANS, display: 'flex' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} input,select,textarea,button{outline:none} *::selection{background:${T.amber};color:#1A1714}`}</style>

      {/* Sidebar / repositorio */}
      {sidebarOpen && !concert && (
        <aside style={{ width: 250, flexShrink: 0, background: T.surface, borderRight: `1px solid ${T.edge}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, position: narrow ? 'fixed' : 'relative', height: narrow ? '100vh' : 'auto', zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 20, letterSpacing: 1, color: T.amber }}>Trastero</span>
            <span style={{ fontSize: 11, color: T.mut }}>tablaturas</span>
          </div>
          <button style={btn({ justifyContent: 'center', background: T.amber, color: '#1A1714', border: 'none', fontWeight: 600 })} onClick={createSong}><Plus size={15} /> Nueva canción</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn({ justifyContent: 'center', flex: 1 })} onClick={() => { setImportOpen(true); setImportMsg(''); }}><Upload size={14} /> Importar</button>
            <button style={btn({ justifyContent: 'center', flex: 1 })} onClick={addFolder}><FolderPlus size={14} /> Carpeta</button>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={13} color={T.mut} style={{ position: 'absolute', left: 9, top: 9 }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar título, artista, etiqueta"
              style={{ width: '100%', background: T.panel, border: `1px solid ${T.edge}`, borderRadius: 8, color: T.ink, fontSize: 12, padding: '7px 8px 7px 28px', fontFamily: SANS, boxSizing: 'border-box' }} />
          </div>
          <div style={{ fontSize: 11, color: T.mut, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 }}>Repositorio · {totalCount}</div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {folders.map((f) => {
              const list = inFolder(f.id);
              if (q && !list.length) return null;
              const open = !collapsed[f.id];
              const hot = dragOver && dragOver.type === 'folder' && dragOver.id === f.id;
              return (
                <div key={f.id}
                  onDragOver={(e) => { e.preventDefault(); if (dragSong.current) setDragOver({ type: 'folder', id: f.id }); }}
                  onDrop={(e) => { e.preventDefault(); if (dragSong.current) moveSong(dragSong.current, f.id, null); }}
                  style={{ border: `1px solid ${hot ? T.amber : T.edge}`, borderRadius: 8, padding: 4, background: T.bg }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 2px' }}>
                    {open ? <ChevronDown size={14} color={T.mut} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => toggleFolder(f.id)} /> : <ChevronRight size={14} color={T.mut} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => toggleFolder(f.id)} />}
                    <Folder size={13} color={T.amber} style={{ flexShrink: 0 }} />
                    <input value={f.name} onChange={(e) => renameFolder(f.id, e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', color: T.ink, fontSize: 12, fontWeight: 600, fontFamily: SANS, minWidth: 0 }} />
                    <span style={{ fontSize: 10, color: T.mut, flexShrink: 0 }}>{list.length}</span>
                    {list.length > 0 && <Maximize2 size={12} color={T.amber} style={{ cursor: 'pointer', flexShrink: 0 }} title="Modo concierto (toca esta carpeta como setlist)" onClick={(e) => { e.stopPropagation(); startConcert(f.id); }} />}
                    <Trash2 size={12} color={T.mut} style={{ cursor: 'pointer', flexShrink: 0 }} title="Eliminar carpeta (las canciones pasan a Sin carpeta)" onClick={() => deleteFolder(f.id)} />
                  </div>
                  {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4, marginTop: 2 }}>
                    {list.map(SongRow)}
                    {!list.length && <div style={{ fontSize: 11, color: T.mut, padding: '4px 6px' }}>Vacía · arrastra canciones aquí</div>}
                  </div>}
                </div>
              );
            })}
            <div
              onDragOver={(e) => { e.preventDefault(); if (dragSong.current) setDragOver({ type: 'root', id: 'root' }); }}
              onDrop={(e) => { e.preventDefault(); if (dragSong.current) moveSong(dragSong.current, null, null); }}
              style={{ border: `1px solid ${dragOver && dragOver.type === 'root' ? T.amber : 'transparent'}`, borderRadius: 8, padding: 2 }}>
              {folders.length > 0 && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
                <span style={{ fontSize: 10, color: T.mut, textTransform: 'uppercase', letterSpacing: 1 }}>Sin carpeta</span>
                {inFolder(null).length > 0 && <Maximize2 size={12} color={T.amber} style={{ cursor: 'pointer' }} title="Modo concierto con estas canciones" onClick={() => startConcert(null)} />}
              </div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{inFolder(null).map(SongRow)}</div>
            </div>
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btn({ justifyContent: 'center', flex: 1, fontSize: 12 })} onClick={() => setBackupOpen(true)} title="Exportar todas las canciones a un archivo"><Download size={13} /> Exportar copia</button>
              <button style={btn({ justifyContent: 'center', flex: 1, fontSize: 12 })} onClick={() => { setRestoreOpen(true); setRestoreMsg(''); }} title="Importar una copia (p. ej. en el móvil)"><Upload size={13} /> Importar copia</button>
            </div>
            <div style={{ fontSize: 11, color: T.mut }}>{saving ? 'Guardando…' : 'Guardado ✓'}</div>
          </div>
        </aside>
      )}

      {/* Editor */}
      <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {/* Cabecera de Concierto */}
        {concert && (
          <div style={{ padding: '12px 16px', borderBottom: `2px solid ${T.amber}`, background: T.surface, display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={exitConcert} title="Salir del modo concierto" style={{ ...btn({ padding: 8 }), flexShrink: 0 }}><X size={18} /></button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.15 }}>{song.title || 'Sin título'}</div>
              <div style={{ fontSize: 13, color: T.mut, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {song.artist || '—'}{(song.tags && song.tags.length) ? '  ·  ' + song.tags.join(' · ') : ''}
              </div>
            </div>
            <span style={{ fontFamily: MONO, fontSize: 14, color: T.amber, flexShrink: 0 }}>{concert.i + 1} / {concert.ids.length}</span>
            <button onClick={() => play('all')} disabled={isPlaying} title="Reproducir" style={{ ...btn({ padding: 10 }), flexShrink: 0 }}>{isPlaying ? <Square size={18} /> : <Play size={18} />}</button>
            <button onClick={() => setMetronome((v) => !v)} title="Metrónomo" style={{ ...btn({ padding: 10, background: metronome ? T.amber : T.surface, color: metronome ? '#1A1714' : T.ink, border: metronome ? 'none' : `1px solid ${T.edge}` }), flexShrink: 0 }}><Music size={18} /></button>
            <button onClick={() => concertStep(-1)} disabled={concert.i === 0} title="Anterior" style={{ ...btn({ padding: 12, opacity: concert.i === 0 ? 0.4 : 1 }), flexShrink: 0 }}><SkipBack size={20} /></button>
            <button onClick={() => concertStep(1)} disabled={concert.i >= concert.ids.length - 1}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: concert.i >= concert.ids.length - 1 ? T.surface : T.amber, color: concert.i >= concert.ids.length - 1 ? T.mut : '#1A1714', border: 'none', borderRadius: 10, padding: '14px 22px', fontSize: 17, fontWeight: 700, cursor: concert.i >= concert.ids.length - 1 ? 'default' : 'pointer', fontFamily: SANS, flexShrink: 0 }}>
              Siguiente <SkipForward size={20} />
            </button>
          </div>
        )}
        {/* Toolbar */}
        {!concert && (
        <div style={{ padding: 14, borderBottom: `1px solid ${T.edge}`, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {narrow && <button style={btn({ padding: 8 })} onClick={() => setSidebarOpen((v) => !v)}><Menu size={16} /></button>}
          <button style={btn({ padding: 8 })} onClick={() => setToolbarOpen((v) => !v)} title={toolbarOpen ? 'Ocultar controles' : 'Mostrar controles'}>{toolbarOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
          <input value={song.title} onChange={(e) => updateSong(activeId, { title: e.target.value })} placeholder="Título"
            style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${T.edge}`, color: T.ink, fontSize: 17, padding: '4px 2px', width: narrow ? 130 : 200, fontFamily: SANS }} />
          {toolbarOpen && <input value={song.artist} onChange={(e) => updateSong(activeId, { artist: e.target.value })} placeholder="Artista"
            style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${T.edge}`, color: T.mut, fontSize: 13, padding: '4px 2px', width: 120, fontFamily: SANS }} />}
          {toolbarOpen && <input value={(song.tags || []).join(', ')} onChange={(e) => updateSong(activeId, { tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} placeholder="Etiquetas"
            style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${T.edge}`, color: T.mut, fontSize: 12, padding: '4px 2px', width: 110, fontFamily: SANS }} />}
          <div style={{ flex: 1 }} />
          {toolbarOpen && <>
          <select value={song.tuningKey} onChange={(e) => updateSong(activeId, { tuningKey: e.target.value })} style={btn({ appearance: 'none' })}>
            {Object.entries(TUNINGS).map(([k, v]) => <option key={k} value={k} style={{ background: T.surface }}>{v.name}</option>)}
          </select>
          <select value={notation} onChange={(e) => setNotation(e.target.value)} style={btn({ appearance: 'none' })} title="Notación">
            <option value="en" style={{ background: T.surface }}>C D E…</option>
            <option value="es" style={{ background: T.surface }}>Do Re Mi…</option>
          </select>
          <label style={{ ...btn(), gap: 4 }}>BPM <input value={bpmText} inputMode="numeric"
            onChange={(e) => { const v = e.target.value; if (/^\d{0,3}$/.test(v)) { setBpmText(v); const n = parseInt(v, 10); if (!isNaN(n) && n >= 30 && n <= 300) updateSong(activeId, { bpm: n }); } }}
            onBlur={() => { const n = parseInt(bpmText, 10); if (!isNaN(n)) { const c = Math.max(30, Math.min(300, n)); updateSong(activeId, { bpm: c }); setBpmText(String(c)); } else setBpmText(String(song.bpm)); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            style={{ width: 42, background: 'transparent', border: 'none', color: T.ink, fontFamily: MONO, textAlign: 'center' }} /></label>
          <select value={song.subdiv} onChange={(e) => updateSong(activeId, { subdiv: +e.target.value })} style={btn({ appearance: 'none' })} title="Notas por tiempo">
            <option value={1} style={{ background: T.surface }}>♩ negra</option>
            <option value={2} style={{ background: T.surface }}>♪ corchea</option>
            <option value={4} style={{ background: T.surface }}>♬ semicorchea</option>
          </select>
          <select value={song.beatsPerBar || 4} onChange={(e) => updateSong(activeId, { beatsPerBar: +e.target.value })} style={btn({ appearance: 'none' })} title="Tiempos por compás">
            {[2, 3, 4, 5, 6].map((b) => <option key={b} value={b} style={{ background: T.surface }}>{b}/4 · compás</option>)}
          </select>
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)} style={btn({ appearance: 'none' })} title="Velocidad de práctica">
            <option value={1} style={{ background: T.surface }}>100%</option>
            <option value={0.75} style={{ background: T.surface }}>75%</option>
            <option value={0.5} style={{ background: T.surface }}>50%</option>
          </select>
          <button style={btn({ background: metronome ? T.amber : T.surface, color: metronome ? '#1A1714' : T.ink, border: metronome ? 'none' : `1px solid ${T.edge}`, padding: 8 })} onClick={() => setMetronome((v) => !v)} title="Metrónomo (al ritmo de los BPM)"><Music size={15} /></button>
          <button style={btn({ background: loop ? T.amber : T.surface, color: loop ? '#1A1714' : T.ink, border: loop ? 'none' : `1px solid ${T.edge}`, padding: 8 })} onClick={() => setLoop((v) => !v)} title="Bucle de la sección"><Repeat size={15} /></button>
          </>}
          <button style={btn({ background: isPlaying ? T.copper : T.surface, color: isPlaying ? '#1A1714' : T.ink, border: isPlaying ? 'none' : `1px solid ${T.edge}` })} onClick={() => play('section')}>{isPlaying ? <Square size={15} /> : <Play size={15} />}{isPlaying ? 'Detener' : 'Sección'}</button>
          <button style={btn()} onClick={() => play('all')} disabled={isPlaying} title="Reproducir toda la canción"><ListMusic size={15} /> Todo</button>
          {toolbarOpen && <button style={btn()} onClick={() => setExportOpen(true)}><Download size={15} /> Exportar</button>}
          {toolbarOpen && <button style={btn({ padding: 8 })} onClick={() => setHelpOpen((v) => !v)} title="Ayuda"><HelpCircle size={16} /></button>}
          <button style={btn({ background: T.amber, color: '#1A1714', border: 'none', fontWeight: 600 })} onClick={() => startConcert(song.folderId || null, activeId)} title="Modo concierto: setlist = canciones de esta carpeta, en orden"><Maximize2 size={15} /> Concierto</button>
        </div>
        )}

        {helpOpen && (
          <div style={{ padding: '12px 16px', background: T.surface, borderBottom: `1px solid ${T.edge}`, fontSize: 12.5, color: T.mut, lineHeight: 1.7 }}>
            <b style={{ color: T.ink }}>Teclado:</b> dígitos = traste (escribe 1 y 2 seguidos para el 12) · flechas = moverse · <b style={{ color: T.ink }}>→/Enter</b> al final añade columna · <b style={{ color: T.ink }}>espacio</b> = insertar columna · <b style={{ color: T.ink }}>borrar</b> = vaciar celda · <b style={{ color: T.ink }}>Ctrl/⌘+D</b> = duplicar compás · <b style={{ color: T.ink }}>×N</b> sobre el compás = repetirlo (aparece el signo de cierre <b style={{ color: T.ink }}>:‖</b> y suena/exporta esas veces) · botón <b style={{ color: T.ink }}>+</b> = añadir compás.<br />
            <b style={{ color: T.ink }}>Técnicas</b> (tecla sobre la celda): {Object.entries(TECHS).map(([k, v]) => <span key={k} style={{ marginRight: 10 }}><span style={{ color: T.amber, fontFamily: MONO }}>{k}</span> {v}</span>)}
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.edge}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ color: T.ink }}>Sincronía audio↔visual:</b>
              <input type="range" min={-50} max={400} step={5} value={latencyOffset} onChange={(e) => setLatencyOffset(+e.target.value)} style={{ width: 200, accentColor: T.amber }} />
              <span style={{ fontFamily: MONO, color: T.amber, minWidth: 64 }}>{latencyOffset >= 0 ? '+' : ''}{latencyOffset} ms</span>
              <span style={{ color: T.mut }}>súbelo si por Bluetooth ves la nota antes de oírla; déjalo en 0 por cable.</span>
            </div>
          </div>
        )}

        {/* Rejilla de tablatura — todas las secciones apiladas (canción completa) */}
        <div ref={gridRef} tabIndex={concert ? -1 : 0} onKeyDown={concert ? undefined : handleKey}
          style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 20, outline: 'none', touchAction: 'pan-x pan-y' }}
          onMouseDown={() => { if (!concert) gridRef.current?.focus(); }}>
          <div style={{ zoom: zoom, width: 'fit-content', minWidth: '100%' }}>
          {song.sections.map((sec) => {
            const { mlayout, gutterAfter } = layoutOf(sec);
            const isActiveSec = activeSecId === sec.id;
            return (
              <div key={sec.id}
                onDragOver={(e) => { if (dragSec.current) { e.preventDefault(); if (dragSec.current !== sec.id) setDragOverSec(sec.id); } }}
                onDrop={(e) => { if (dragSec.current) { e.preventDefault(); moveSection(dragSec.current, sec.id); } }}
                style={{ marginBottom: 22, borderTop: `2px solid ${dragOverSec === sec.id ? T.amber : 'transparent'}`, paddingTop: dragOverSec === sec.id ? 6 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {!concert && <GripVertical size={15} color={T.mut} title="Arrastra para reordenar la sección" draggable
                    onDragStart={(e) => { dragSec.current = sec.id; e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setDragOverSec(null); dragSec.current = null; }}
                    style={{ cursor: 'grab', flexShrink: 0 }} />}
                  <span style={{ width: 6, height: 18, borderRadius: 3, background: isActiveSec ? T.amber : T.edge, flexShrink: 0 }} />
                  {concert ? (
                    <span style={{ color: T.ink, fontSize: 15, fontWeight: 600, fontFamily: SANS }}>{sec.name || 'Sección'}</span>
                  ) : (
                  <input value={sec.name} onChange={(e) => updateSection(sec.id, (s) => ({ ...s, name: e.target.value }))} onFocus={() => { setActiveSecId(sec.id); setCursor({ col: 0, str: 0 }); }}
                    style={{ background: 'transparent', border: 'none', color: T.ink, fontSize: 15, fontWeight: 600, fontFamily: SANS, width: 200, minWidth: 0 }} placeholder="Nombre de sección" />
                  )}
                  {!concert && <span style={{ display: 'flex', border: `1px solid ${T.edge}`, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
                    {[['tab', 'Tab'], ['chords', 'Acordes']].map(([tp, lbl]) => (
                      <button key={tp} onClick={() => setSectionType(sec.id, tp)}
                        style={{ padding: '5px 10px', fontSize: 11, border: 'none', cursor: 'pointer', background: (sec.type || 'tab') === tp ? T.amber : 'transparent', color: (sec.type || 'tab') === tp ? '#1A1714' : T.mut, fontFamily: SANS, fontWeight: 600 }}>{lbl}</button>
                    ))}
                  </span>}
                  {!concert && <button style={btn({ padding: 6 })} title="Reproducir esta sección" onClick={() => { setActiveSecId(sec.id); play('section', sec.id); }}><Play size={13} /></button>}
                  {!concert && song.sections.length > 1 && <button style={btn({ padding: 6 })} title="Eliminar sección" onClick={() => deleteSection(sec.id)}><Trash2 size={13} /></button>}
                </div>
                {(sec.type || 'tab') === 'tab' ? (
                <div style={{ display: 'inline-block', background: T.panel, border: `1px solid ${T.edge}`, borderRadius: 10, padding: '12px 8px', boxShadow: isActiveSec ? `0 0 0 1.5px ${T.amber}55` : 'none' }}>
                  <div style={{ display: 'flex', marginLeft: LABELW, height: 24 }}>
                    {mlayout.map((m) => {
                      const anchorId = sec.columns[m.start + m.count - 1].id;
                      const rep = sec.repeats?.[anchorId] || 1;
                      const hkey = sec.id + ':' + m.idx;
                      const hov = hoverBar === hkey;
                      const stp = { width: 16, height: 16, lineHeight: '13px', textAlign: 'center', border: `1px solid ${T.edge}`, background: T.surface, color: T.ink, borderRadius: 4, cursor: 'pointer', fontSize: 13, padding: 0 };
                      return (
                        <div key={m.idx} onMouseEnter={() => setHoverBar(hkey)} onMouseLeave={() => setHoverBar(null)}
                          style={{ width: m.colsW + (m.repeat ? GUT : 0), boxSizing: 'border-box', borderLeft: m.idx > 0 ? `1px solid ${T.line}` : '1px solid transparent', position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <span style={{ position: 'absolute', left: 5, fontSize: 10, color: T.mut, fontFamily: MONO }}>{m.idx + 1}</span>
                          <div style={{ position: 'absolute', left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4 }}>
                            {hov && <button title="Menos repeticiones" style={stp} onClick={() => setRepeat(sec.id, anchorId, rep - 1)}>−</button>}
                            {(rep > 1 || hov) && <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: rep > 1 ? T.amber : T.mut, minWidth: 22, textAlign: 'center' }}>×{rep}</span>}
                            {hov && <button title="Más repeticiones" style={stp} onClick={() => setRepeat(sec.id, anchorId, rep + 1)}>+</button>}
                          </div>
                          <span style={{ position: 'absolute', right: 5, display: 'flex', gap: 5, opacity: hov ? 1 : 0, transition: 'opacity .15s' }}>
                            <Copy size={13} color={T.amber} style={{ cursor: 'pointer' }} title="Duplicar compás" onClick={() => duplicateMeasure(sec.id, m.idx)} />
                            {mlayout.length > 1 && <Trash2 size={12} color={T.mut} style={{ cursor: 'pointer' }} title="Eliminar compás" onClick={() => deleteMeasure(sec.id, m.idx)} />}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                    <div style={{ position: 'relative' }}>
                      {labels.map((lab, str) => (
                        <div key={str} style={{ display: 'flex', alignItems: 'center', height: ROWH }}>
                          <div style={{ width: LABELW, height: ROWH, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, color: T.mut, fontSize: 13 }}>{lab}</div>
                          {sec.columns.map((c, ci) => {
                            const cell = c.cells[str];
                            const content = cellStr(cell);
                            const isCursor = isActiveSec && cursor.col === ci && cursor.str === str;
                            const isPlay = playSec === sec.id && playCol === ci;
                            const atBoundary = ci % colsPerBar === 0 && ci > 0;
                            const repClose = atBoundary && (sec.repeats?.[sec.columns[ci - 1].id] || 1) > 1;
                            const barEdge = atBoundary && !repClose;
                            const beatEdge = !atBoundary && song.subdiv > 1 && ci % song.subdiv === 0 && ci > 0;
                            return (
                              <React.Fragment key={c.id}>
                                <div data-sec={sec.id} data-col={ci} onClick={() => { setActiveSecId(sec.id); setCursor({ col: ci, str }); gridRef.current?.focus(); }}
                                  style={{ width: COLW, height: ROWH, position: 'relative', cursor: 'pointer', borderLeft: barEdge ? `1px solid ${T.line}` : beatEdge ? `1px solid ${T.edge}` : '1px solid transparent', background: isPlay ? 'rgba(210,103,74,0.16)' : 'transparent' }}>
                                  <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, background: T.line, transform: 'translateY(-1px)' }} />
                                  {content && (
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <span style={{ background: T.panel, fontFamily: MONO, fontSize: 13, padding: '0 3px', borderRadius: 3, lineHeight: '18px', zIndex: 1, color: cell.tech === 'x' && cell.fret == null ? T.copper : T.ink }}>
                                        {cell.fret != null ? cell.fret : 'x'}
                                        {cell.tech && cell.tech !== 'x' && <span style={{ color: T.amber }}>{cell.tech}</span>}
                                      </span>
                                    </div>
                                  )}
                                  {isCursor && <div style={{ position: 'absolute', inset: 3, border: `1.5px solid ${T.amber}`, borderRadius: 4, pointerEvents: 'none' }} />}
                                </div>
                                {gutterAfter.has(ci) && (
                                  <div style={{ width: GUT, height: ROWH, position: 'relative' }}>
                                    <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, background: T.line, transform: 'translateY(-1px)' }} />
                                  </div>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      ))}
                      {mlayout.map((m) => {
                        if (!m.repeat) return null;
                        const H = ROWH * 6;
                        const xB = m.gutX + GUT;
                        const dot = (top) => ({ position: 'absolute', left: m.gutX + 6, top, width: 5, height: 5, borderRadius: 3, background: T.amber });
                        return (
                          <div key={'rep' + m.idx} style={{ position: 'absolute', left: 0, top: 0, height: H, width: '100%', pointerEvents: 'none', zIndex: 2 }}>
                            <div style={dot(H / 2 - 12)} /><div style={dot(H / 2 + 7)} />
                            <div style={{ position: 'absolute', left: xB - 10, top: 0, height: H, width: 1, background: T.amber }} />
                            <div style={{ position: 'absolute', left: xB - 3, top: 0, height: H, width: 3, background: T.amber, borderRadius: 1 }} />
                          </div>
                        );
                      })}
                    </div>
                    {!concert && <button onClick={() => addMeasureEnd(sec.id)} title="Añadir compás" style={{ ...btn({ padding: 4 }), height: ROWH * 6, marginLeft: 6, alignItems: 'center' }}><Plus size={14} /></button>}
                  </div>
                </div>
                ) : (
                <div style={{ display: 'inline-block', background: T.panel, border: `1px solid ${T.edge}`, borderRadius: 10, padding: 12, boxShadow: isActiveSec ? `0 0 0 1.5px ${T.amber}55` : 'none' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 640 }}>
                    {(sec.chords || []).map((ch, i) => {
                      const playing = playSec === sec.id && playCol === i;
                      const hk = sec.id + ':c' + i;
                      return (
                        <div key={i} data-sec={sec.id} data-col={i} onMouseEnter={() => setHoverBar(hk)} onMouseLeave={() => setHoverBar(null)}
                          style={{ position: 'relative', width: 74, height: 56, borderRadius: 8, border: `1px solid ${playing ? T.copper : T.edge}`, background: playing ? 'rgba(210,103,74,0.16)' : T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <input value={ch} readOnly={!!concert} onChange={(e) => setChord(sec.id, i, e.target.value)} onFocus={() => setActiveSecId(sec.id)} placeholder="—"
                            style={{ width: '100%', textAlign: 'center', background: 'transparent', border: 'none', color: T.ink, fontFamily: MONO, fontSize: 17, fontWeight: 600 }} />
                          {!concert && hoverBar === hk && (sec.chords || []).length > 1 && <Trash2 size={12} color={T.mut} style={{ position: 'absolute', top: 3, right: 3, cursor: 'pointer' }} onClick={() => removeChord(sec.id, i)} />}
                        </div>
                      );
                    })}
                    {!concert && <button onClick={() => addChord(sec.id)} title="Añadir acorde" style={{ width: 42, height: 56, borderRadius: 8, border: `1px dashed ${T.edge}`, background: 'transparent', color: T.mut, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={16} /></button>}
                  </div>
                  {!concert && <div style={{ fontSize: 11, color: T.mut, marginTop: 8 }}>Escribe el acorde (C, Am, G7, Do, Lam, Sol7…). Se reproduce al dar a play.</div>}
                </div>
                )}
              </div>
            );
          })}
          {!concert && <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn({ background: 'transparent' })} onClick={() => addSection('tab')}><Plus size={15} /> Sección de tablatura</button>
            <button style={btn({ background: 'transparent' })} onClick={() => addSection('chords')}><Plus size={15} /> Rueda de acordes</button>
          </div>}
          </div>
        </div>

        {/* Zoom flotante de la partitura */}
        <div style={{ position: 'absolute', left: 14, bottom: 70, zIndex: 30, display: 'flex', alignItems: 'center', gap: 2, background: T.surface, border: `1px solid ${T.edge}`, borderRadius: 20, padding: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
          <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 100) / 100))} title="Reducir" style={{ width: 30, height: 30, borderRadius: 15, border: 'none', background: 'transparent', color: T.ink, fontSize: 18, cursor: 'pointer' }}>−</button>
          <button onClick={() => setZoom(1)} title="Tamaño normal" style={{ minWidth: 42, height: 30, borderRadius: 15, border: 'none', background: 'transparent', color: T.mut, fontSize: 11, fontFamily: MONO, cursor: 'pointer' }}>{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 100) / 100))} title="Ampliar" style={{ width: 30, height: 30, borderRadius: 15, border: 'none', background: 'transparent', color: T.ink, fontSize: 18, cursor: 'pointer' }}>+</button>
        </div>

        {/* Barra de comandos en lenguaje natural */}
        {!concert && (
        <div style={{ padding: 14, borderTop: `1px solid ${T.edge}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Wand2 size={15} color={T.amber} style={{ position: 'absolute', left: 11, top: 11 }} />
              <input value={nl} onChange={(e) => setNl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runNL(); }}
                placeholder='Ej.: "transpón 2 trastes arriba", "genera un riff de blues en Em", "repite todo x2", "pásalo a Drop D"'
                style={{ width: '100%', background: T.surface, border: `1px solid ${T.edge}`, borderRadius: 9, color: T.ink, fontSize: 13, padding: '9px 12px 9px 34px', fontFamily: SANS, boxSizing: 'border-box' }} />
            </div>
            <button style={btn({ background: T.amber, color: '#1A1714', border: 'none', fontWeight: 600 })} onClick={runNL} disabled={nlBusy}>
              {nlBusy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Music size={15} />} {nlBusy ? 'Pensando…' : 'Aplicar'}
            </button>
          </div>
          {nlMsg && <div style={{ fontSize: 12, color: T.mut }}>{nlMsg}</div>}
        </div>
        )}
      </main>

      {/* Modal exportar */}
      {exportOpen && (
        <div onClick={() => setExportOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.edge}`, borderRadius: 12, padding: 18, width: 'min(640px, 92vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b>Exportar tablatura (texto)</b>
              <X size={18} color={T.mut} style={{ cursor: 'pointer' }} onClick={() => setExportOpen(false)} />
            </div>
            <textarea readOnly value={asciiExport(song, notation)} style={{ width: '100%', height: 320, background: T.bg, color: T.ink, border: `1px solid ${T.edge}`, borderRadius: 8, fontFamily: MONO, fontSize: 12, padding: 12, boxSizing: 'border-box', whiteSpace: 'pre', overflow: 'auto' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btn()} onClick={() => { try { navigator.clipboard.writeText(asciiExport(song, notation)); } catch { /* usar selección manual */ } }}>Copiar</button>
              <button style={btn({ background: T.amber, color: '#1A1714', border: 'none', fontWeight: 600 })} onClick={downloadTxt}><Download size={15} /> Descargar .txt</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal importar */}
      {importOpen && (
        <div onClick={() => setImportOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.edge}`, borderRadius: 12, padding: 18, width: 'min(640px, 92vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b>Importar tablatura ASCII</b>
              <X size={18} color={T.mut} style={{ cursor: 'pointer' }} onClick={() => setImportOpen(false)} />
            </div>
            <div style={{ fontSize: 12, color: T.mut }}>Pega una tablatura en texto (bloques de 6 líneas e B G D A E con <span style={{ fontFamily: MONO }}>|</span> y guiones). Usa <span style={{ fontFamily: MONO }}>[Nombre]</span> para separar secciones. Se importan las posiciones; el ritmo no se conserva.</div>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'[Intro]\ne|--0--3--|\nB|--1--0--|\nG|--0--0--|\nD|--2--2--|\nA|--3-----|\nE|--------|'} style={{ width: '100%', height: 260, background: T.bg, color: T.ink, border: `1px solid ${T.edge}`, borderRadius: 8, fontFamily: MONO, fontSize: 12, padding: 12, boxSizing: 'border-box', whiteSpace: 'pre', overflow: 'auto' }} />
            {importMsg && <div style={{ fontSize: 12, color: T.copper }}>{importMsg}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btn()} onClick={() => setImportOpen(false)}>Cancelar</button>
              <button style={btn({ background: T.amber, color: '#1A1714', border: 'none', fontWeight: 600 })} onClick={doImport}><Upload size={15} /> Importar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal exportar copia */}
      {backupOpen && (
        <div onClick={() => setBackupOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.edge}`, borderRadius: 12, padding: 18, width: 'min(640px, 92vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b>Exportar copia de seguridad</b>
              <X size={18} color={T.mut} style={{ cursor: 'pointer' }} onClick={() => setBackupOpen(false)} />
            </div>
            <div style={{ fontSize: 12, color: T.mut }}>Incluye todas tus canciones, carpetas y ajustes. <b style={{ color: T.ink }}>Copia</b> el texto y pásalo al móvil (email, nota, Drive…); allí pégalo en «Importar copia». La descarga puede estar bloqueada por el entorno.</div>
            <textarea ref={backupTaRef} readOnly value={backupJSON()} onClick={(e) => e.target.select()} style={{ width: '100%', height: 220, background: T.bg, color: T.ink, border: `1px solid ${T.edge}`, borderRadius: 8, fontFamily: MONO, fontSize: 11, padding: 12, boxSizing: 'border-box', overflow: 'auto' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              {copied && <span style={{ fontSize: 12, color: T.amber }}>Copiado ✓</span>}
              <button style={btn()} onClick={downloadBackup} title="Si está bloqueado, usa Copiar"><Download size={15} /> Descargar .json</button>
              <button style={btn({ background: T.amber, color: '#1A1714', border: 'none', fontWeight: 600 })} onClick={copyBackup}><Copy size={15} /> Copiar todo</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal importar copia */}
      {restoreOpen && (
        <div onClick={() => setRestoreOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.edge}`, borderRadius: 12, padding: 18, width: 'min(640px, 92vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b>Importar copia de seguridad</b>
              <X size={18} color={T.mut} style={{ cursor: 'pointer' }} onClick={() => setRestoreOpen(false)} />
            </div>
            <div style={{ fontSize: 12, color: T.mut }}>Selecciona el archivo <span style={{ fontFamily: MONO }}>.json</span> exportado, o pega su contenido. Se <b>fusiona</b> con lo que ya tengas (no borra nada).</div>
            <label style={{ ...btn({ justifyContent: 'center' }), cursor: 'pointer' }}><Upload size={14} /> Elegir archivo .json
              <input type="file" accept="application/json,.json" onChange={onRestoreFile} style={{ display: 'none' }} />
            </label>
            <textarea value={restoreText} onChange={(e) => setRestoreText(e.target.value)} placeholder="…o pega aquí el contenido del backup" style={{ width: '100%', height: 180, background: T.bg, color: T.ink, border: `1px solid ${T.edge}`, borderRadius: 8, fontFamily: MONO, fontSize: 11, padding: 12, boxSizing: 'border-box', overflow: 'auto' }} />
            {restoreMsg && <div style={{ fontSize: 12, color: T.copper }}>{restoreMsg}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btn()} onClick={() => setRestoreOpen(false)}>Cancelar</button>
              <button style={btn({ background: T.amber, color: '#1A1714', border: 'none', fontWeight: 600 })} onClick={() => doRestore(restoreText)} disabled={!restoreText.trim()}><Upload size={15} /> Importar copia</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
