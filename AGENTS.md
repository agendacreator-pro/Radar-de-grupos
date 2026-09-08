# Radar de Grupos — Work State

## Objective
- Ferramenta independente (não é Vitrine Criativa nem Agenda Creator): descobrir, organizar e acompanhar grupos públicos do Facebook do nicho do usuário.
- Acesso das lojas/papelarias via login próprio (Supabase Auth).

## Important Details
- Repo: `agendacreator-pro/Radar-de-grupos` (projeto separado da vitrine)
- Supabase project `yhjmulicddyclnqmodlk` — URL `https://yhjmulicddyclnqmodlk.supabase.co`; chaves anon/publishable + service_role estão em `.env` (não commitado). Use o publishable key (`sb_publishable_...`) como `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Worker: `https://radar-de-grupos.meellcriativa.workers.dev` (conta `meellcriativa`, mesmas credenciais wrangler da vitrine)
- Build: `npm run build` (Vite lê `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` do `.env`). Não setar essas vars manualmente no CLI.
- Deploy frontend: `cd .output && npx wrangler deploy --name radar-de-grupos --var SUPABASE_URL=https://yhjmulicddyclnqmodlk.supabase.co --var SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`
- **Worker needs `SUPABASE_SERVICE_ROLE_KEY`** (server functions gravam via service role): `<service_role_de_.env> | npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (Wrangler account `meellcriativa` tem as credenciais). Opcional: `BRAVE_API_KEY` para resultados mais limpos.
- **Descoberta roda no Worker Cloudflare** via server functions (`src/lib/radar-engine.ts`): egresso do Supabase (edge functions) bloqueia DuckDuckGo/Facebook → busca retornava 0 grupos. No Worker o DDG/Bing/Brave funciona; Facebook direto está bloqueado (400) → contagem de membros vem de snippets (nunca inventada).
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
- **Engine de descoberta no Worker** (`src/lib/radar-engine.ts`): server functions `radarSearch`/`radarImport`/`radarRecheck` que rodam no Worker (egresso CF). Fontes: Brave (se `BRAVE_API_KEY`) → DDG html → DDG lite → Bing; parse de contagem de membros em snippets. `painel.grupos.tsx` usa o engine (passa o JWT do usuário na chamada; grava via service role). Corrige a busca que retornava 0 grupos (egresso do Supabase bloqueado).
- **Botão Buscar funciona com somente termos extras** (campo principal vazio): `runSearch` valida `term || selectedTerms.length > 0`; botão habilita com termos selecionados.
- `tsc --noEmit` passa; `vite build` gera `.output` (preset cloudflare-module).
- **Worker deployado** (`026afb7c`) com secret `SUPABASE_SERVICE_ROLE_KEY` + vars `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`. Verificado em produção via `/dbg`: DDG html/lite retornam grupos reais (10 URLs p/ "papelaria personalizada"); Facebook direto bloqueado (400) → contagem de membros vem de snippets.

### Pending / To verify
- Criar usuário de teste (sign-up aberto; se e-mail de confirmação bloquear, criar via admin com `email_confirm: true` ou desativar confirmação no projeto).
- Testar busca real no RLP `/painel/grupos` (login + Buscar) e afinar: orçamento de tempo (~26s wall, 42 subqueries, delay 950ms), `BRAVE_API_KEY` opcional (minha qualidade de contagem de membros em snippets), mais templates de query se necessário.
- UI: seleção de agência para serviços de envio NÃO se aplica (radar não usa envio).