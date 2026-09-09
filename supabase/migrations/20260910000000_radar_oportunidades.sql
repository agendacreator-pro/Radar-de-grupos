-- Radar de Oportunidades de Venda
-- Publicações em grupos do Facebook com intenção de compra do nicho do usuário.
-- Descoberta acontece no Worker (fontes abertas + grupos salvos do usuário) e o
-- resultado é persistido aqui com RLS "dono somente".

create table if not exists public.radar_oportunidades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- URL canônica da publicação (normalizada p/ deduplicação); única por usuário.
  post_url text not null,
  post_id text,
  grupo_url text,
  grupo_nome text,
  trecho text not null,
  autor text,
  data_publicacao timestamptz,
  nicho text not null,
  termos_relacionados text[] not null default '{}',
  tipo_intencao text not null default 'potencial' check (
    tipo_intencao in ('alta_compra', 'indicacao', 'duvida', 'potencial', 'anuncio_vendedor')
  ),
  -- 0-100: quão "comprador pronto" parece a publicação.
  score int not null default 0 check (score >= 0 and score <= 100),
  justificativa text,
  fonte text not null default 'fontes_publicas',
  status text not null default 'nova' check (
    status in ('nova', 'quero_atender', 'respondida', 'nao_atender')
  ),
  -- Dedupe entre postagens "modal"/pinadas e repetidas.
  verificado boolean not null default false,
  data_encontrada timestamptz not null default now(),
  data_respondida timestamptz,
  ultima_verificacao timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, post_url)
);

create index if not exists radar_oportunidades_user_idx on public.radar_oportunidades (user_id);
create index if not exists radar_oportunidades_status_idx on public.radar_oportunidades (user_id, status);
create index if not exists radar_oportunidades_data_idx on public.radar_oportunidades (user_id, data_encontrada desc);
create index if not exists radar_oportunidades_tipo_idx on public.radar_oportunidades (user_id, tipo_intencao);

alter table public.radar_oportunidades enable row level security;

create policy "radar_oportunidades_owner" on public.radar_oportunidades
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant all on public.radar_oportunidades to authenticated;