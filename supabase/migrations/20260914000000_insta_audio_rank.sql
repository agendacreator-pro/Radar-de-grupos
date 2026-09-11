-- Radar do Algoritmo — Instagram
-- Ranking real de músicas em alta: campos de metadados da faixa, Trend Score,
-- posição/variação entre coletas, classificação de tendência, crescimento e
-- recorrência. Usa `score` (0-100) como Trend Score do Radar. Não apaga dados
-- existentes — apenas adiciona colunas com defaults.

alter table public.insta_radar_audios
  add column if not exists album text,
  add column if not exists provider_id text,
  add column if not exists track_url text,
  add column if not exists trend_status text check (
    trend_status in ('viral', 'crescendo', 'nova', 'consolidada', 'perdendo')
  ),
  add column if not exists rank int,
  add column if not exists previous_rank int,
  add column if not exists rank_change int,
  add column if not exists score_delta int,
  add column if not exists growth_rate numeric(8,1),
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists seen_count int not null default 1;

create index if not exists insta_radar_audios_user_rank
  on public.insta_radar_audios (user_id, rank asc);

-- Atualização automática periódica (por usuário; só dispara se habilitada).
alter table public.insta_radar_config
  add column if not exists auto_update boolean not null default true;