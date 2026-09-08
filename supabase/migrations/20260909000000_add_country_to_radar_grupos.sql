-- Adiciona coluna country (código ISO 3166-1 alpha-2) para filtro por país.

alter table public.radar_grupos
  add column if not exists country text not null default 'BR';

create index if not exists radar_grupos_country_idx on public.radar_grupos (country);
