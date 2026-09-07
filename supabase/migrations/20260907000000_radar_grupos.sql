-- Radar de Grupos
-- Descobre, organiza e acompanha grupos públicos do Facebook para o nicho do usuário.

-- Grupos descobertos (dados compartilhados, deduplicados por URL/id do Facebook)
create table if not exists public.radar_grupos (
  id uuid primary key default gen_random_uuid(),
  fb_id text unique,
  url text not null unique,
  name text not null,
  description text,
  categoria text,
  member_count bigint,
  member_raw text,
  is_public boolean,
  derivado_de text[] not null default '{}',
  fontes text[] not null default '{}',
  member_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists radar_grupos_member_count_idx on public.radar_grupos (member_count desc nulls last);
create index if not exists radar_grupos_public_idx on public.radar_grupos (is_public);

-- Relação usuário <-> grupo (status de participação, favoritos, notas, tags)
create table if not exists public.radar_grupo_usuario (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  grupo_id uuid not null references public.radar_grupos(id) on delete cascade,
  status text not null default 'salvo' check (status in ('salvo', 'quero_entrar', 'solicitado', 'aguardando', 'membro', 'nao_interesse')),
  favorito boolean not null default false,
  notas text,
  tags text[] not null default '{}',
  permite_divulgacao boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, grupo_id)
);

create index if not exists radar_grupo_usuario_user_idx on public.radar_grupo_usuario (user_id);

-- Listas personalizadas (ex.: por nicho, tamanho ou objetivo)
create table if not exists public.radar_listas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  icone text,
  created_at timestamptz not null default now()
);

create table if not exists public.radar_lista_grupos (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null references public.radar_listas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  grupo_id uuid not null references public.radar_grupos(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (lista_id, grupo_id)
);

-- Histórico de buscas
create table if not exists public.radar_buscas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  termo text not null,
  termos jsonb not null default '[]',
  total_resultados int not null default 0,
  total_grupos int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists radar_buscas_user_idx on public.radar_buscas (user_id, created_at desc);

-- Enables authenticated users to read discovered groups + their own radar rows.
alter table public.radar_grupos enable row level security;
alter table public.radar_grupo_usuario enable row level security;
alter table public.radar_listas enable row level security;
alter table public.radar_lista_grupos enable row level security;
alter table public.radar_buscas enable row level security;

-- radar_grupos: any authenticated user can read (shared discovery index)
create policy "radar_grupos_select_auth" on public.radar_grupos
  for select to authenticated using (true);

-- Radar data is written by the server (service role) and by the owner in the app.
create policy "radar_grupo_usuario_owner" on public.radar_grupo_usuario
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "radar_listas_owner" on public.radar_listas
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "radar_lista_grupos_owner" on public.radar_lista_grupos
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "radar_buscas_owner" on public.radar_buscas
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.radar_grupos to authenticated;
grant all on public.radar_grupo_usuario to authenticated;
grant all on public.radar_listas to authenticated;
grant all on public.radar_lista_grupos to authenticated;
grant all on public.radar_buscas to authenticated;