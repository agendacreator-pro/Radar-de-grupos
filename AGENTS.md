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
- Edge Function `radar-grupos` deployada em `yhjmulicddyclnqmodlk` (usa `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` auto-injetados; `supabase-js` **pinado** em `2.45.4` no `_shared/radar.ts` — versões novas (2.116+) quebram o bundle do edge function).
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

### Pending / To verify
- Criar usuário de teste (sign-up aberto; se e-mail de confirmação bloquear, criar via admin com `email_confirm: true` ou desativar confirmação no projeto).
- Se o Supabase restringir egress da edge function (DuckDuckGo/Facebook), liberar na dashboard (Network Restrictions / Egress).
- UI: seleção de agência para serviços de envio NÃO se aplica (radar não usa envio).