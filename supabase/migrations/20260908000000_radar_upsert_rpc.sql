-- Radar de Grupos — persistência em lote via RPC.
-- Executar UMA vez no SQL Editor do Supabase.
--
-- Motivo: no Cloudflare Workers o limite é ~50 subrequests por invocação.
-- Com 30 consultas ao Tavily + select/insert/merges/attach/load avulsos, a
-- busca com muitas descobertas estourava o limite e falhava com
-- "Too many subrequests by single Worker invocation".
-- Esta função faz insert + merge + attach + load em UM único subrequest.
--
-- Segurança: SECURITY DEFINER, execute apenas para service_role (o Worker).
-- Revogado de public/anon/authenticated para evitar que usuários anexem
-- grupos a contas de terceiros via RPC.

create or replace function public.radar_upsert_groups(
  p_user uuid,
  p_terms text[],
  p_groups jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g jsonb;
  r uuid;
  inserted_ok boolean;
  ids uuid[] := '{}';
  inserted_count int := 0;
begin
  for g in select * from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    insert into public.radar_grupos (
      fb_id, url, name, description, categoria, country, member_count, member_raw,
      member_checked_at, is_public, fontes, derivado_de
    ) values (
      case when g->>'slug' ~ '^[0-9]+$' then g->>'slug' else null end,
      g->>'url',
      coalesce(nullif(btrim(coalesce(g->>'name', ''), ''), ''), g->>'slug'),
      nullif(g->>'description', ''),
      case when g->>'term' is not null and g->>'term' not in ('', 'importado') then coalesce(p_terms[1], g->>'term') else null end,
      case when g->>'country' is null or g->>'country' = '' then 'BR' else upper(btrim(g->>'country')) end,
      case when g->>'member_count' is null or g->>'member_count' = '' then null else (g->>'member_count')::bigint end,
      nullif(g->>'member_raw', ''),
      case when g->>'member_count' is not null and g->>'member_count' <> '' then now() else null end,
      case when g->>'is_public' is null or g->>'is_public' = '' then null else (g->>'is_public')::boolean end,
      array[coalesce(nullif(g->>'source', ''), 'descoberto')],
      (select array(select distinct x from unnest(string_to_array(coalesce(g->>'term',''), '|') || coalesce(p_terms, '{}'::text[])) x where x is not null and x <> ''))
    )
    on conflict (url) do update set
      updated_at = now(),
      fontes = (select array(select distinct x from unnest(radar_grupos.fontes || excluded.fontes) x)),
      derivado_de = (select array(select distinct x from unnest(radar_grupos.derivado_de || excluded.derivado_de) x)),
      name = case
        when radar_grupos.name is null or radar_grupos.name = radar_grupos.fb_id then excluded.name
        else radar_grupos.name
      end,
      description = case
        when radar_grupos.name is null or radar_grupos.name = radar_grupos.fb_id then coalesce(radar_grupos.description, excluded.description)
        else radar_grupos.description
      end,
      member_count = case when radar_grupos.member_count is null then excluded.member_count else radar_grupos.member_count end,
      member_raw = case when radar_grupos.member_raw is null then excluded.member_raw else radar_grupos.member_raw end,
      member_checked_at = case
        when radar_grupos.member_checked_at is null then excluded.member_checked_at
        else radar_grupos.member_checked_at
      end
    returning id, (xmax = 0) into r, inserted_ok;

    if inserted_ok then
      inserted_count := inserted_count + 1;
    end if;
    ids := array_append(ids, r);
  end loop;

  insert into public.radar_grupo_usuario (user_id, grupo_id)
  select p_user, unnest(ids)
  on conflict (user_id, grupo_id) do nothing;

  return jsonb_build_object(
    'inserted', inserted_count,
    'groups', (
      select coalesce(jsonb_agg(grp order by member_count desc nulls last), '[]'::jsonb)
      from (
        select
          rg.*,
          rug.status,
          rug.favorito,
          rug.notas,
          rug.tags,
          rug.permite_divulgacao
        from public.radar_grupos rg
        join public.radar_grupo_usuario rug on rug.grupo_id = rg.id and rug.user_id = p_user
        where rg.id = any(ids)
      ) grp
    )
  );
end;
$$;

revoke all on function public.radar_upsert_groups(uuid, text[], jsonb) from public;
revoke all on function public.radar_upsert_groups(uuid, text[], jsonb) from anon;
revoke all on function public.radar_upsert_groups(uuid, text[], jsonb) from authenticated;
grant execute on function public.radar_upsert_groups(uuid, text[], jsonb) to service_role;