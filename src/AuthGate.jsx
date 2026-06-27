import React, { useEffect, useState, useRef } from 'react';
import App from './Trastero.jsx';
import { supabase } from './supabaseClient';
import { pullMergePush, pushDoc } from './cloudSync';

const T = { bg: '#1A1714', surface: '#242019', edge: '#3A322A', ink: '#EDE6D8', mut: '#8A7E6E', amber: '#E0A458' };
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function Centered({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg, color: T.ink, fontFamily: SANS, padding: 20 }}>
      {children}
    </div>
  );
}

export default function AuthGate() {
  const [session, setSession] = useState(undefined); // undefined = cargando
  const [synced, setSynced] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Sync inicial al tener usuario
  useEffect(() => {
    let cancel = false;
    if (session && session.user && !synced) {
      pullMergePush(session.user.id).then(() => { if (!cancel) setSynced(true); });
    }
    return () => { cancel = true; };
  }, [session, synced]);

  // Subida debounced ante cada escritura local
  useEffect(() => {
    if (!synced || !session || !session.user) return;
    const onWrite = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => pushDoc(session.user.id), 800);
    };
    window.addEventListener('trastero-write', onWrite);
    return () => { window.removeEventListener('trastero-write', onWrite); clearTimeout(timer.current); };
  }, [synced, session]);

  const sendLink = async () => {
    setErr('');
    const addr = email.trim();
    if (!addr) return;
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    if (error) setErr(error.message); else setSent(true);
  };

  if (session === undefined) return <Centered><span style={{ color: T.mut }}>Cargando…</span></Centered>;

  if (!session) {
    return (
      <Centered>
        <div style={{ width: 'min(360px, 92vw)', background: T.surface, border: `1px solid ${T.edge}`, borderRadius: 14, padding: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Trastero</div>
          <div style={{ color: T.mut, fontSize: 13, marginBottom: 18 }}>Entra con tu correo para sincronizar tus canciones en todos tus dispositivos.</div>
          {sent ? (
            <div style={{ color: T.ink, fontSize: 14, lineHeight: 1.6 }}>
              Te envié un enlace a <b>{email}</b>. Ábrelo en este mismo dispositivo para entrar.
              <button onClick={() => setSent(false)} style={{ marginTop: 14, background: 'transparent', color: T.mut, border: 'none', cursor: 'pointer', fontSize: 13 }}>Usar otro correo</button>
            </div>
          ) : (
            <>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="tu@correo.com"
                onKeyDown={(e) => e.key === 'Enter' && sendLink()}
                style={{ width: '100%', boxSizing: 'border-box', background: T.bg, color: T.ink, border: `1px solid ${T.edge}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, marginBottom: 10 }} />
              <button onClick={sendLink}
                style={{ width: '100%', background: T.amber, color: '#1A1714', border: 'none', borderRadius: 8, padding: '10px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                Enviarme el enlace
              </button>
              {err && <div style={{ color: '#D2674A', fontSize: 12, marginTop: 10 }}>{err}</div>}
            </>
          )}
        </div>
      </Centered>
    );
  }

  if (!synced) return <Centered><span style={{ color: T.mut }}>Sincronizando tus canciones…</span></Centered>;

  return <App />;
}
