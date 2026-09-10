-- Radar do Algoritmo — Instagram
-- Módulo independente de inteligência de tendências do Instagram.
-- Descoberta = web pública (Tavily/Brave/DDG/Bing) no Worker; aqui persistimos
-- as análises com RLS "dono somente". Nenhum dado de métrica é inventado.

-- Configuração por usuário (nicho + agendamento).
create table if not exists public.insta_radar_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  keywords text[] not null default '{}',
  disabled boolean not null default false,
  status text not null default 'aguardando' check (
    status in ('aguardando', 'ok', 'rodando', 'erro')
  ),
  last_error text,
  last_run_at timestamptz,
  next_run_at timestamptz,
  alert_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.insta_radar_config enable row level security;
create policy "insta_radar_config_owner" on public.insta_radar_config
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.insta_radar_config to authenticated;

-- Tendências / oportunidades encontradas.
create table if not exists public.insta_radar_trends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  categoria text not null default 'trend' check (
    categoria in ('reels', 'trend', 'audio', 'formato', 'tema', 'gancho', 'viral', 'emergente', 'saturada', 'vendas')
  ),
  ciclo text not null default 'surgindo' check (
    ciclo in ('surgindo', 'crescendo', 'auge', 'saturando', 'caindo')
  ),
  score int not null default 0 check (score between 0 and 100),
  compat int not null default 0 check (compat between 0 and 100),
  crescimento int not null default 0,
  motivo text,
  adaptacao text,
  formato text,
  fonte text not null default 'observado' check (
    fonte in ('oficial', 'observado', 'estimativa', 'inferencia')
  ),
  fonte_detalhe text,
  url text,
  coletado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, nome)
);

create index if not exists insta_radar_trends_user_cycle on public.insta_radar_trends (user_id, ciclo);
create index if not exists insta_radar_trends_user_score on public.insta_radar_trends (user_id, score desc);
create index if not exists insta_radar_trends_user_compat on public.insta_radar_trends (user_id, compat desc);

alter table public.insta_radar_trends enable row level security;
create policy "insta_radar_trends_owner" on public.insta_radar_trends
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.insta_radar_trends to authenticated;

-- Áudios em alta.
create table if not exists public.insta_radar_audios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  artista text,
  usos int,
  crescimento int not null default 0,
  motivo text,
  ciclo text not null default 'crescendo' check (
    ciclo in ('surgindo', 'crescendo', 'auge', 'saturando', 'caindo')
  ),
  score int not null default 0 check (score between 0 and 100),
  compat int not null default 0 check (compat between 0 and 100),
  fonte text not null default 'observado' check (
    fonte in ('oficial', 'observado', 'estimativa', 'inferencia')
  ),
  fonte_detalhe text,
  url text,
  coletado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, nome)
);

create index if not exists insta_radar_audios_user_score on public.insta_radar_audios (user_id, score desc);

alter table public.insta_radar_audios enable row level security;
create policy "insta_radar_audios_owner" on public.insta_radar_audios
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.insta_radar_audios to authenticated;

-- Histórico de análises (snapshot por execução).
create table if not exists public.insta_radar_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resumo jsonb not null default '{}',
  criado_em timestamptz not null default now()
);

create index if not exists insta_radar_history_user_idx on public.insta_radar_history (user_id, criado_em desc);

alter table public.insta_radar_history enable row level security;
create policy "insta_radar_history_owner" on public.insta_radar_history
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.insta_radar_history to authenticated;

-- Alertas automáticos.
create table if not exists public.insta_radar_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null default 'nova_trend' check (
    tipo in ('nova_trend', 'audio_alta', 'nicho_alta', 'saturacao', 'oportunidade', 'formato')
  ),
  titulo text not null,
  descricao text,
  criado_em timestamptz not null default now(),
  lido boolean not null default false
);

create index if not exists insta_radar_alerts_user_idx on public.insta_radar_alerts (user_id, criado_em desc);

alter table public.insta_radar_alerts enable row level security;
create policy "insta_radar_alerts_owner" on public.insta_radar_alerts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.insta_radar_alerts to authenticated;

-- Planejamento de conteúdo (calendário).
create table if not exists public.insta_radar_plan (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dia text not null check (dia in ('seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom')),
  formato text not null default 'Reels',
  trend text,
  audio text,
  ideia text not null,
  gancho text,
  objetivo text default 'Engajamento',
  criado_em timestamptz not null default now()
);

create index if not exists insta_radar_plan_user_idx on public.insta_radar_plan (user_id, criado_em);

alter table public.insta_radar_plan enable row level security;
create policy "insta_radar_plan_owner" on public.insta_radar_plan
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.insta_radar_plan to authenticated;

-- Registro de integração oficial (Instagram/Meta). Não contém credenciais:
-- apenas o estado de conexão e orientações do que precisa ser configurado.
create table if not exists public.insta_conexao (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'instagram_meta',
  conectado boolean not null default false,
  label text,
  instrucao text,
  last_insights jsonb,
  updated_at timestamptz not null default now()
);

alter table public.insta_conexao enable row level security;
create policy "insta_conexao_owner" on public.insta_conexao
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.insta_conexao to authenticated;