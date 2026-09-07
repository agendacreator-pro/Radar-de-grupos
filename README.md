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
cd .output
npx wrangler deploy --name radar-de-grupos --var SUPABASE_URL=https://<ref>.supabase.co --var SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
```

Edge function:

```bash
supabase functions deploy radar-grupos
```