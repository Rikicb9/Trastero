import React, { useEffect, useState, useRef } from 'react';
import App from './Trastero.jsx';
import { supabase } from './supabaseClient';
import { pullMergePush, pushDoc } from './cloudSync';
 
const T = { bg: '#1A1714', surface: '#242019', edge: '#3A322A', ink: '#EDE6D8', mut: '#8A7E6E', amber: '#E0A458', copper: '#D2674A' };
const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
 
function Centered({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg, color: T.ink, fontFamily: SANS, padding: 20 }}>
      {children}
    </div>
  );
}
 
const inputStyle = { width: '100%', boxSizing: 'border-box', background: T.bg, color: T.ink, border: `1px solid ${T.edge}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, marginBottom: 10 };
const primaryBtn = { width: '100%', background: T.amber, color: '#1A1714', border: 'none', borderRadius: 8, padding: '10px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' };
 
export default function AuthGate() {
  const [session, setSession] = useState(undefined);
  const [synced, setSynced] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [accMsg, setAccMsg] = useState('');
  const timer = useRef(null);
 
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
 
  useEffect(() => {
    let cancel = false;
    if (session && session.user && !synced) {
      pullMergePush(session.user.id).then(() => { if (!cancel) setSynced(true); });
    }
    return () => { cancel = true; };
  }, [session, synced]);
 
  useEffect(() => {
    if (!synced || !session || !session.user) return;
    const onWrite = () => { clearTimeout(timer.current); timer.current = setTimeout(() => pushDoc(session.user.id), 800); };
    window.addEventListener('trastero-write', onWrite);
    return () => { window.removeEventListener('trastero-write', onWrite); clearTimeout(timer.current); };
  }, [synced, session]);
 
  const signIn = async () => {
    setErr(''); setMsg(''); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setErr('No pude entrar: revisa correo y contraseña. (Si es la primera vez, establece la contraseña desde el dispositivo donde ya tienes la sesion abierta.)');
  };
 
  const magicFallback = async () => {
    setErr(''); setMsg(''); setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } });
    setBusy(false);
    if (error) setErr(error.message); else setMsg('Te envie un enlace de acceso a ' + email.trim() + '. Abrelo en este dispositivo.');
  };
 
  const savePassword = async () => {
    setAccMsg('');
    if (newPw.length < 6) { setAccMsg('Minimo 6 caracteres.'); return; }
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) setAccMsg('Error: ' + error.message);
    else { setAccMsg('Contrasena guardada. Ya puedes entrar con tu correo y esta contrasena en cualquier dispositivo.'); setNewPw(''); }
  };
 
  const signOut = async () => { await supabase.auth.signOut(); setPanel(false); setSynced(false); };
 
  if (session === undefined) return <Centered><span style={{ color: T.mut }}>Cargando...</span></Centered>;
 
  if (!session) {
    return (
      <Centered>
        <div style={{ width: 'min(360px, 92vw)', background: T.surface, border: `1px solid ${T.edge}`, borderRadius: 14, padding: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Trastero</div>
          <div style={{ color: T.mut, fontSize: 13, marginBottom: 18 }}>Entra con tu correo y contrasena. Tus canciones se sincronizan en todos tus dispositivos.</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="tu@correo.com" style={inputStyle} />
          <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" placeholder="contrasena" onKeyDown={(e) => e.key === 'Enter' && signIn()} style={inputStyle} />
          <button onClick={signIn} disabled={busy} style={primaryBtn}>Entrar</button>
          {err && <div style={{ color: T.copper, fontSize: 12, marginTop: 10 }}>{err}</div>}
          {msg && <div style={{ color: T.amber, fontSize: 12, marginTop: 10 }}>{msg}</div>}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.edge}`, fontSize: 12, color: T.mut }}>
            Sin contrasena aun o la olvidaste? <button onClick={magicFallback} disabled={busy} style={{ background: 'transparent', border: 'none', color: T.amber, cursor: 'pointer', fontSize: 12, padding: 0 }}>Entrar con enlace por email</button> (solo de emergencia).
          </div>
        </div>
      </Centered>
    );
  }
 
  if (!synced) return <Centered><span style={{ color: T.mut }}>Sincronizando tus canciones...</span></Centered>;
 
  return (
    <>
      <App />
      <button onClick={() => { setPanel((v) => !v); setAccMsg(''); }} title="Cuenta"
        style={{ position: 'fixed', bottom: 14, right: 14, zIndex: 9998, width: 38, height: 38, borderRadius: 19, background: T.surface, color: T.ink, border: `1px solid ${T.edge}`, cursor: 'pointer', fontSize: 16, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>@</button>
      {panel && (
        <div style={{ position: 'fixed', bottom: 62, right: 14, zIndex: 9999, width: 'min(300px, 92vw)', background: T.surface, border: `1px solid ${T.edge}`, borderRadius: 12, padding: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', fontFamily: SANS, color: T.ink }}>
          <div style={{ fontSize: 12, color: T.mut, marginBottom: 10 }}>Sesion: {session.user.email}</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Establecer / cambiar contrasena</div>
          <input value={newPw} onChange={(e) => setNewPw(e.target.value)} type="password" placeholder="nueva contrasena (min. 6)" style={{ ...inputStyle, marginBottom: 8 }} />
          <button onClick={savePassword} style={{ ...primaryBtn, marginBottom: 10 }}>Guardar contrasena</button>
          {accMsg && <div style={{ fontSize: 12, color: accMsg.startsWith('Error') || accMsg.startsWith('Minimo') ? T.copper : T.amber, marginBottom: 10 }}>{accMsg}</div>}
          <button onClick={signOut} style={{ width: '100%', background: 'transparent', color: T.mut, border: `1px solid ${T.edge}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}>Cerrar sesion</button>
        </div>
      )}
    </>
  );
}
