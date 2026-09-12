-- ============================================================
-- Radar do Algoritmo — Instagram — QUALIDADE DA BASE
-- Colunas para: formato×subformato, nicho resolvido + confiança,
-- origem do dado, qualidade dos sinais, e timestamps REAIS de
-- coleta (primeira/última vez vista). Nada aqui fabrica histórico.
-- ============================================================

alter table public.insta_radar_trends
  add column if not exists subformato text;

alter table public.insta_radar_trends
  add column if not exists niche text;

alter table public.insta_radar_trends
  add column if not exists niche_confidence text
  check (niche_confidence in ('high', 'medium', 'low', 'unknown'));

alter table public.insta_radar_trends
  add column if not exists source text
  check (source in ('web_search', 'engine', 'manual', 'other', 'unknown'));

alter table public.insta_radar_trends
  add column if not exists signal_quality text
  check (signal_quality in ('alta', 'media', 'baixa', 'insuficiente'));

-- Primeira vez que o Radar viu a tendência (nunca é sobrescrito).
alter table public.insta_radar_trends
  add column if not exists first_seen_at timestamptz;

-- Última vez que o Radar viu a tendência.
alter table public.insta_radar_trends
  add column if not exists last_seen_at timestamptz;

alter table public.insta_radar_trends
  add column if not exists seen_count int not null default 1;

-- Backfill REAL: created_at é o momento real do INSERT (ou seja, a primeira
-- vez que a linha apareceu) e updated_at o momento real da última gravação.
-- Não é histórico inventado — são os instantes que o banco já registrou.
update public.insta_radar_trends
set first_seen_at = coalesce(first_seen_at, created_at, coletado_em),
    last_seen_at  = coalesce(last_seen_at, updated_at, created_at)
where first_seen_at is null
   or last_seen_at  is null;

-- Normalização REAL de dados existentes: "Reels (áudio)" vira base "Reels"
-- + subformato "Áudio" (mesma regra determinística que o engine passa a usar).
update public.insta_radar_trends
set formato    = 'Reels',
    subformato = 'Áudio'
where formato = 'Reels (áudio)'
  and subformato is null;

-- Índice p/ os filtros de período honestos (Surgidas em 24h/7d/30d).
create index if not exists insta_radar_trends_user_first_seen
  on public.insta_radar_trends (user_id, first_seen_at);