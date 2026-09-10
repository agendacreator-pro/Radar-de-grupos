-- Radar do Algoritmo — Instagram
-- Prévia real da música (Apple/iTunes) para reprodução no painel.
-- A descoberta continua via sinais públicos; aqui guardamos o vínculo
-- com a faixa real encontrada no iTunes Search (preview de 30s, sem
-- inventar nada) para o botão "ouvir prévia" e o nome para usar no Reels.

alter table public.insta_radar_audios
  add column if not exists preview_url text,
  add column if not exists artwork_url text,
  add column if not exists itunes_url text,
  add column if not exists track_name text,
  add column if not exists artist_name text,
  add column if not exists enrich_attempted_at timestamptz;