-- ============================================================
-- Trastero — esquema Supabase
-- Un documento JSONB por usuario con todo el repositorio.
-- Pegar en Supabase Studio -> SQL Editor -> Run.
-- ============================================================

create table if not exists public.trastero_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Mantener updated_at al día en cada escritura
create or replace function public.trastero_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trastero_touch_trg on public.trastero_state;
create trigger trastero_touch_trg
  before update on public.trastero_state
  for each row execute function public.trastero_touch();

-- Seguridad por fila: cada usuario solo ve y escribe lo suyo
alter table public.trastero_state enable row level security;

drop policy if exists "trastero own select" on public.trastero_state;
create policy "trastero own select" on public.trastero_state
  for select using (auth.uid() = user_id);

drop policy if exists "trastero own insert" on public.trastero_state;
create policy "trastero own insert" on public.trastero_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "trastero own update" on public.trastero_state;
create policy "trastero own update" on public.trastero_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- (Opcional) sincronización en vivo entre dispositivos:
-- en Studio -> Database -> Replication, añade public.trastero_state a la
-- publicación supabase_realtime, o ejecuta:
-- alter publication supabase_realtime add table public.trastero_state;

-- Forma del documento `data`:
-- {
--   "v": 1,
--   "songs":   { "<id>": { ...cancion... }, ... },
--   "folders": [ { "id": "...", "name": "..." }, ... ],
--   "settings": { "notation": "es", "latencyOffset": 0 }
-- }
