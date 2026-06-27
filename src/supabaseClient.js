import { createClient } from '@supabase/supabase-js';

// La anon key es pública por diseño: la seguridad la da el RLS de la tabla.
// Si algún día prefieres no tenerla en el código, muévela a variables de entorno
// de Vite (import.meta.env.VITE_SUPABASE_*) y configúralas como secrets en Actions.
const SUPABASE_URL = 'https://zahmumipbltfckexdddn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphaG11bWlwYmx0ZmNrZXhkZGRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDYyMDIsImV4cCI6MjA5ODEyMjIwMn0.aqjgnqiWykARCeAFtqD3svxMGqT0a0227IkGdgYbWvQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
