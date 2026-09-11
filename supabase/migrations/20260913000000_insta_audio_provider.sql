-- Radar do Algoritmo — Instagram
-- Origem da prévia encontrada (itunes/deezer), para o card exibir o nome
-- correto do provedor e link dinâmico (Apple Music/Deezer).

alter table public.insta_radar_audios
  add column if not exists provider text;