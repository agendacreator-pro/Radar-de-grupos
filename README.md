# Radar de Grupos

Ferramenta para descobrir, organizar e acompanhar grupos públicos do Facebook do seu nicho.

## Funcionalidades

- Busca de grupos por termos (via DuckDuckGo) com enriquecimento automático de dados (nome, membros, visibilidade)
- Importação de links do Facebook que você já conhece
- Acompanhamento por status por grupo: salvo, quero entrar, solicitado, aguardando, membro, sem interesse
- Favoritos, notas, tags e listas personalizadas por usuário
- Filtros (tamanho, visibilidade, status) e ordenação
- Exportação em CSV e XLS
- Histórico de buscas

## Stack

- TanStack Start (React + Vite) com Tailwind 4 e shadcn/ui
- Supabase (Auth, Postgres com RLS, Edge Function `radar-grupos`)
- Deploy: Cloudflare Workers (Nitro preset `cloudflare-module`)

## URL

- Produção: https://radar-de-grupos.meellcriativa.workers.dev

## Rodar local

```bash
npm install
npm run dev   # http://localhost:3000
```

## Deploy

Frontend:

```bash
npm run build
npx wrangler deploy -c wrangler.jsonc
```

As vars plain-text (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) estão em `wrangler.jsonc` (raiz), para o deploy ser determinístico. O secret `SUPABASE_SERVICE_ROLE_KEY` é setado uma vez:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name radar-de-grupos
```

Edge function:

```bash
supabase functions deploy radar-grupos
```