-- Estilo musical (gênero) de cada música em alta, vindo da parada oficial
-- (iTunes/Apple Music primaryGenreName; Deezer genre_id best-effort).
alter table insta_radar_audios
  add column if not exists genero text;

create index if not exists insta_radar_audios_genero_idx
  on insta_radar_audios (user_id, genero);