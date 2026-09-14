// Testes de unidade (node:test, sem framework) da FIDELIDADE da IA ao
// blueprint/tendência recebidos:
//   - rastreabilidade: GeneratedContent carrega a tendência real usada;
//   - validação semântica determinística (evaluateFidelity): recusa
//     conteúdo genérico, lista de formatos, ano inventado, promessa sem
//     evidência, legenda/direção visual/CTA genéricos.
// Executar:  npm run test:unit
import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateFidelity,
  normalizeGeneratedContent,
  resolveSourceBlueprintId,
} from "../src/lib/instagram-ai.ts";
import { makeBlueprintPayloadId } from "../src/lib/instagram-content.ts";

// ---------------------------------------------------------------------------
// fábrica de payload (mesmo shape de ContentBlueprintPayload)
// ---------------------------------------------------------------------------
function makePayload(overrides = {}) {
  return {
    id: makeBlueprintPayloadId({
      trendId: "t-1",
      niche: "planilhas",
      objectiveKey: "engajamento",
      format: "Reels",
      subformat: "Áudio",
    }),
    trend: {
      id: "t-1",
      nome: "Como usar planilhas no dia a dia",
      categoria: "tema",
      motivo: "Sinais públicos observados em busca web.",
      adaptacao: "Adapte para o seu nicho.",
      fonte: "web",
      url: "https://example.com/artigo",
    },
    niche: { niche: "planilhas", confidence: "high", origin: "detected" },
    objective: {
      key: "engajamento",
      label: "Engajamento",
      emoji: "💬",
      desc: "Gerar comentários.",
    },
    format: "Reels",
    subformat: "Áudio",
    hook: "Abra com o ponto central da tendência.",
    structure: [],
    delivery: "Desenvolva uma ideia por cena.",
    cta: { text: "Comenta abaixo.", reason: "Pergunta aberta." },
    visualDirection: ["cenas rápidas", "texto na tela"],
    evidence: { tendencia: "planilhas", score: 82, qualidade: "media" },
    ...overrides,
  };
}

// Resposta FIEL à tendência "Como usar planilhas no dia a dia".
function faithfulRaw() {
  return {
    trendNote: "Como usar planilhas no dia a dia",
    adaptationNote: "Aplicar a tendência ao nicho de planilhas criativas de papelaria.",
    title: "3 atalhos de planilha que salvam seu tempo",
    idea: "Mostrar atalhos reais de planilha.",
    hook: "Você perde horas em planilhas?",
    script: [
      {
        scene: "Gancho",
        text: "Visual: mãos digitando no teclado | Fala: quanto tempo você perde em planilhas? | Texto na tela: planilhas no dia a dia",
      },
      {
        scene: "Cena 1",
        text: "Visual: exemplo de fórmula na tela | Fala: este atalho resolve seu dia | Texto na tela: atalho 1",
      },
      {
        scene: "CTA",
        text: "Visual: tela com o perfil | Fala: comenta qual atalho você usa | Texto na tela: comenta aqui",
      },
    ],
    caption: "Salve este Reel com as dicas de planilha para usar no dia a dia.",
    cta: "Comenta qual atalho você mais usa.",
    keywords: ["planilha", "atalhos", "produtividade"],
    visualDirection: [
      "mostrar a tela real da planilha com fórmulas",
      "aproximar no cursor quando mostrar o atalho",
    ],
  };
}

// ---------------------------------------------------------------------------
test("normalizeGeneratedContent: carimba a tendência REAL usada (rastreável)", () => {
  const payload = makePayload();
  const g = normalizeGeneratedContent(faithfulRaw(), "Reels", "Áudio", payload);
  assert.equal(g.sourceTrendId, "t-1");
  assert.equal(g.sourceTrendTitle, "Como usar planilhas no dia a dia");
  assert.equal(g.sourceBlueprintId, payload.id);
  assert.equal(g.trendNote, "Como usar planilhas no dia a dia");
  assert.match(g.adaptationNote, /planilhas criativas de papelaria/);
});

test("normalizeGeneratedContent: sem payload → campos de fonte ficam null (compat)", () => {
  const g = normalizeGeneratedContent(faithfulRaw(), "Reels", "Áudio");
  assert.equal(g.sourceTrendId, null);
  assert.equal(g.sourceTrendTitle, null);
  assert.equal(g.sourceBlueprintId, null);
});

test("resolveSourceBlueprintId: derivado deterministicamente quando payload sem id", () => {
  const p = makePayload();
  delete p.id;
  const a = resolveSourceBlueprintId(p);
  const b = resolveSourceBlueprintId(p);
  assert.ok(a && a.startsWith("bp_"), "prefixo de blueprint");
  assert.equal(a, b, "mesmo input → mesmo id");
});

test("makeBlueprintPayloadId: estável e sensível aos inputs", () => {
  assert.equal(
    makeBlueprintPayloadId({
      trendId: "t-1",
      niche: "planilhas",
      objectiveKey: "engajamento",
      format: "Reels",
      subformat: "Áudio",
    }),
    makeBlueprintPayloadId({
      trendId: "t-1",
      niche: "planilhas",
      objectiveKey: "engajamento",
      format: "Reels",
      subformat: "Áudio",
    }),
  );
  assert.notEqual(
    makeBlueprintPayloadId({
      trendId: "t-1",
      niche: "planilhas",
      objectiveKey: "vendas",
      format: "Reels",
      subformat: "Áudio",
    }),
    makeBlueprintPayloadId({
      trendId: "t-1",
      niche: "planilhas",
      objectiveKey: "engajamento",
      format: "Reels",
      subformat: "Áudio",
    }),
    "objetivo diferente → blueprint id diferente",
  );
});

// ---------------------------------------------------------------------------
// VALIDAÇÃO SEMÂNTICA (evaluateFidelity)
// ---------------------------------------------------------------------------

test("evaluateFidelity: conteúdo fiel à tendência → ok", () => {
  const payload = makePayload();
  const gen = normalizeGeneratedContent(faithfulRaw(), payload.format, payload.subformat, payload);
  const fid = evaluateFidelity(gen, payload);
  assert.equal(fid.ok, true, JSON.stringify(fid.problems));
  assert.equal(fid.trendTrace, true);
});

test("evaluateFidelity: lista genérica de formatos → rejeitada", () => {
  const payload = makePayload();
  const gen = normalizeGeneratedContent(
    {
      title: "3 formatos que vão bombar",
      idea: "Descubra os 3 formatos do momento.",
      hook: "Veja as 5 tendências do Instagram.",
      script: [
        {
          scene: "Gancho",
          text: "3 formatos que vão bombar: Reels curtos, Carrossel educativo, Lives interativas.",
        },
      ],
      caption: "3 formatos que vão bombar no Instagram.",
      cta: "Visite meu perfil.",
    },
    payload.format,
    payload.subformat,
    payload,
  );
  const fid = evaluateFidelity(gen, payload);
  assert.equal(fid.ok, false);
  assert.ok(
    fid.problems.some((p) => /lista gen[eé]rica/.test(p)),
    JSON.stringify(fid.problems),
  );
});

test("evaluateFidelity: ano inventado em previsão → rejeitada", () => {
  const payload = makePayload();
  const gen = normalizeGeneratedContent(
    {
      ...faithfulRaw(),
      script: [{ scene: "Gancho", text: "Isto vai bombar em 2025 no nicho de planilhas." }],
    },
    payload.format,
    payload.subformat,
    payload,
  );
  const fid = evaluateFidelity(gen, payload);
  assert.equal(fid.ok, false);
  assert.ok(
    fid.problems.some((p) => /ano inventado/.test(p)),
    JSON.stringify(fid.problems),
  );
});

test("evaluateFidelity: promessa absoluta sem evidência → rejeitada", () => {
  const payload = makePayload();
  const gen = normalizeGeneratedContent(
    {
      ...faithfulRaw(),
      hook: "O Instagram está priorizando planilhas e isso vai aumentar suas vendas.",
    },
    payload.format,
    payload.subformat,
    payload,
  );
  const fid = evaluateFidelity(gen, payload);
  assert.equal(fid.ok, false);
  assert.ok(
    fid.problems.some((p) => /promessa/.test(p)),
    JSON.stringify(fid.problems),
  );
});

test("evaluateFidelity: formato diferente do solicitado → rejeitada", () => {
  const payload = makePayload(); // Reels
  const gen = normalizeGeneratedContent(
    {
      ...faithfulRaw(),
      format: "Carrossel",
      slides: [{ slide: "Slide 1", title: "Cap", text: "planilhas" }],
    },
    payload.format,
    payload.subformat,
    payload,
  );
  const fid = evaluateFidelity(gen, payload);
  assert.equal(fid.ok, false);
  assert.ok(
    fid.problems.some((p) => /formato/.test(p)),
    JSON.stringify(fid.problems),
  );
});

test("evaluateFidelity: tendência ignorada (conteúdo sobre outro assunto) → rejeitada", () => {
  const payload = makePayload();
  const gen = normalizeGeneratedContent(
    {
      title: "Dicas de decoração",
      idea: "Reforma de casa.",
      hook: "Você gosta de decorar?",
      script: [{ scene: "Gancho", text: "Mostre a sala reformada com luzes bonitas." }],
      caption: "Ideias de decoração para sua casa.",
      cta: "Comenta aqui.",
    },
    payload.format,
    payload.subformat,
    payload,
  );
  const fid = evaluateFidelity(gen, payload);
  assert.equal(fid.ok, false);
  assert.equal(fid.trendTrace, false, "nenhum token da tendência no conteúdo");
  assert.ok(
    fid.problems.some((p) => /não aparece/.test(p)),
    JSON.stringify(fid.problems),
  );
});

test("evaluateFidelity: legenda genérica (não cita tendência/nicho) → rejeitada", () => {
  const payload = makePayload();
  const gen = normalizeGeneratedContent(
    {
      ...faithfulRaw(),
      caption: "Aproveite e siga para mais conteúdo.",
    },
    payload.format,
    payload.subformat,
    payload,
  );
  const fid = evaluateFidelity(gen, payload);
  assert.equal(fid.ok, false);
  assert.ok(
    fid.problems.some((p) => /legenda gen[eé]rica/.test(p)),
    JSON.stringify(fid.problems),
  );
});

test("evaluateFidelity: direção visual só de template → rejeitada", () => {
  const payload = makePayload();
  const gen = normalizeGeneratedContent(
    { ...faithfulRaw(), visualDirection: ["cenas rápidas", "texto na tela"] },
    payload.format,
    payload.subformat,
    payload,
  );
  const fid = evaluateFidelity(gen, payload);
  assert.equal(fid.ok, false);
  assert.ok(
    fid.problems.some((p) => /direção visual gen[eé]rica/.test(p)),
    JSON.stringify(fid.problems),
  );
});

test("evaluateFidelity: CTA genérico → rejeitada", () => {
  const payload = makePayload();
  const gen = normalizeGeneratedContent(
    { ...faithfulRaw(), cta: "Curte!" },
    payload.format,
    payload.subformat,
    payload,
  );
  const fid = evaluateFidelity(gen, payload);
  assert.equal(fid.ok, false);
  assert.ok(
    fid.problems.some((p) => /CTA gen[eé]rico/.test(p)),
    JSON.stringify(fid.problems),
  );
});

test("evaluateFidelity: consome variação de caixa/acentos no rastreio", () => {
  const payload = makePayload({
    trend: {
      ...makePayload().trend,
      nome: "Planilhas para organizar a papelaria",
    },
  });
  const gen = normalizeGeneratedContent(
    {
      title: "Planilha de papelaria",
      idea: "Organize a papelaria com planilhas.",
      hook: "Sua papelaria vira um caos?",
      script: [{ scene: "Gancho", text: "Mostre a planilha de estoque de papelaria organizada." }],
      caption: "Salve esta planilha de papelaria.",
      cta: "Marca alguém que precisa organizar a papelaria.",
    },
    payload.format,
    payload.subformat,
    payload,
  );
  const fid = evaluateFidelity(gen, payload);
  assert.equal(fid.ok, true, JSON.stringify(fid.problems));
});
