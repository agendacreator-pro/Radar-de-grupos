# Radar de Grupos — Work State

## Objective
- Ferramenta independente (não é Vitrine Criativa nem Agenda Creator): descobrir, organizar e acompanhar grupos públicos do Facebook do nicho do usuário.
- Acesso das lojas/papelarias via login próprio (Supabase Auth).

## Important Details
- Repo: `agendacreator-pro/Radar-de-grupos` (projeto separado da vitrine)
- Supabase project `yhjmulicddyclnqmodlk` — URL `https://yhjmulicddyclnqmodlk.supabase.co`; chaves anon/publishable + service_role estão em `.env` (não commitado). Use o publishable key (`sb_publishable_...`) como `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Worker: `https://radar-de-grupos.meellcriativa.workers.dev` (conta `meellcriativa`, mesmas credenciais wrangler da vitrine)
- Build: `npm run build` (Vite lê `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` do `.env`). Não setar essas vars manualmente no CLI.
- Deploy frontend: `npx wrangler deploy -c wrangler.jsonc` (config commitado define `name`, `main`, `assets` e as vars plain-text `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` — deploy determinístico; NÃO usar `--var` solto, que um deploy sem vars limpa).
- **Worker needs `SUPABASE_SERVICE_ROLE_KEY`** (server functions gravam via service role): já setado via `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name radar-de-grupos` (Wrangler account `meellcriativa` tem as credenciais). **`TAVILY_API_KEY` já setado** (fonte primária, planos com $5-1.000 créditos/mês grátis). Opcional: `BRAVE_API_KEY`.
- **Descoberta roda no Worker Cloudflare** via server functions (`src/lib/radar-engine.ts`): egresso do Supabase (edge functions) bloqueia DuckDuckGo/Facebook → busca retornava 0 grupos. No Worker Tavily/Brave/DDG/Bing funciona; Facebook direto está bloqueado (400) → contagem de membros vem de snippets (nunca inventada).
- Edge Function `radar-grupos` (egresso Supabase) ficou OBsoleta para busca — mantida, mas a UI chama o engine do Worker. `radar-grupos` deployada em `yhjmulicddyclnqmodlk` (usa `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` auto-injetados; `supabase-js` **pinado** em `2.45.4` no `_shared/radar.ts`).
- PowerShell: usar `; if ($?)`; `Select-Object -First`.
- Usuário exige: sempre commit e push sem pedir (no repo do radar).

## Work State

### Completed
- Projeto Supabase `radar-de-grupos` criado + migração `20260907000000_radar_grupos.sql` aplicada (tabelas `radar_grupos`, `radar_grupo_usuario`, `radar_listas`, `radar_lista_grupos`, `radar_buscas` + RLS owner).
- Types regenerados do banco (`supabase gen types typescript --project-id yhjmulicddyclnqmodlk`).
- Edge function `radar-grupos` deployada (401 sem auth; usuário autenticado por Bearer JWT via service role).
- Frontend standalone (TanStack Start) com: landing, `/auth` (login/criar conta/esqueci senha), `/painel/grupos` (página do radar), layout com logout.
- Worker `radar-de-grupos` deployado com vars `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`.
- HTML do Facebook: scraping via User-Agent; busca via DuckDuckGo HTML.
- Teste: endpoints respondem 200 e `/auth` renderiza título.
- **Engine de descoberta no Worker** (`src/lib/radar-engine.ts`): server functions `radarSearch`/`radarImport`/`radarRecheck` que rodam no Worker (egresso CF). Fontes: Tavily (se `TAVILY_API_KEY`) → Brave (se `BRAVE_API_KEY`) → DDG html → DDG lite → Bing; parse de contagem de membros em snippets. `painel.grupos.tsx` usa o engine (passa o JWT do usuário na chamada; grava via service role). Corrige a busca que retornava 0 grupos (egresso do Supabase bloqueado).
- **Botão Buscar funciona com somente termos extras** (campo principal vazio): `runSearch` valida `term || selectedTerms.length > 0`; botão habilita com termos selecionados.
- `tsc --noEmit` passa; `vite build` gera `.output` (preset cloudflare-module).
- **FIX CONFIG (raiz do "Missing SUPABASE_URL")**: o worker tinha o secret `SUPABASE_SERVICE_ROLE_KEY`, mas as vars plain-text `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` não persistiam em deploys sem `--var` → `radarSearch` (admin client) lançava "Missing Supabase environment variable(s): SUPABASE_URL". Solução: `wrangler.jsonc` commitado (raiz) com as vars; deploy = `npx wrangler deploy -c wrangler.jsonc`. Verificado E2E: busca real no worker retorna grupos e persiste no `yhjmulicddyclnqmodlk` (projeto do radar).
- Erros de ambiente agora logam detalhes técnicos no console do worker e mostram mensagem amigável ao usuário; engine retorna `success:false` em falha de persistência em vez de mascarar como "0 grupos".
- **FIX SUBREQUESTS (limite ~50/invocação)**: buscas volumosas (30 queries Tavily + ~206 grupos) falhavam com "Too many subrequests by single Worker invocation" no `persistGroups` (select + bulk insert + merges + attach + load avulsos). Solução: migration `20260908000000_radar_upsert_rpc.sql` cria a função `radar_upsert_groups(uuid, text[], jsonb)` (SECURITY DEFINER, execute SÓ para service_role; revogado de public/anon/authenticated) que faz insert + merge (ON CONFLICT url) + attach (`radar_grupo_usuario`) + load em **1 subrequest** e devolve `{inserted, groups}`. `persistGroups` = RPC-first com fallback legado (`persistGroupsLegacy`) se a função não existir no DB; `radarSearch`/`radarImport` usam `rows` do RPC direto (sem `loadGroupsByIds` extra). Aplicada via `supabase db push` (CLI já rastreia `20260907000000`). Verificado em escala: sucesso com 189 grupos, `batch_rpc_logs=0`, `subrequest_logs=0`, `exceptions=0`. Note: `supabase db push` no repo do radar precisa de confirmação `[Y/n]` interativa. Teste de stress: `.e2e-search.mjs` (não commitado; usa usuário `radar-e2e-opencode@example.com`).

### Pending / To verify
- `BRAVE_API_KEY` opcional (fonte secundária); corroborar buscas com Tavily (chave `tvly-dev-*` já setada): DDG voltou a dar 202 no IP do worker → Tavily resolve.
- UI: seleção de agência para serviços de envio NÃO se aplica (radar não usa envio).