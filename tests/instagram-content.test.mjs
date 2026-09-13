// Testes de unidade (node:test, sem framework) da camada pura:
//   src/lib/instagram-content.ts   ("✨ Transformar tendência em conteúdo")
// Executar:  npm run test:unit
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContentBlueprint,
  buildCtaForObjective,
  buildVisualDirection,
  contentStructureForFormat,
  prepareBlueprintPayload,
  INSTA_BLUEPRINT_TRANSPARENCIA,
} from "../src/lib/instagram-content.ts";

// ---------------------------------------------------------------------------
// fábrica de tendências sintéticas para os TESTES (não toca em dados reais)
// ---------------------------------------------------------------------------
function makeTrend(overrides = {}) {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    nome: "Como usar planilhas no dia a dia",
    categoria: "tema",
    ciclo: "crescendo",
    score: 82,
    compat: 75,
    crescimento: 60,
    motivo: "Sinais públicos observados em busca web.",
    adaptacao: "Adapte para o seu nicho.",
    formato: "Reels (áudio)",
    fonte: "web",
    fonte_detalhe: "Busca pública",
    url: "https://example.com/artigo",
    coletado_em: new Date().toISOString(),
    first_seen_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    seen_count: 2,
    niche: "planilhas",
    niche_confidence: "high",
    source: "web_search",
    signal_quality: "alta",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
test("buildContentBlueprint: preserva o objeto completo e gera blueprint determinístico", () => {
  const t = makeTrend();
  const b = buildContentBlueprint({ trend: t, objective: "engajamento" });

  assert.equal(b.trend, t); // objeto completo, nunca só o nome
  assert.ok(b.hook.length > 0, "gancho deve ser uma orientação");
  assert.ok(b.structure.length >= 3, "estrutura com passos");
  assert.match(b.structure[0].rotulo, /Gancho|Capa|Contexto|Introdução/);
  assert.ok(b.cta.text.length > 0 && b.cta.reason.length > 0);
  assert.ok(b.visualDirection.length > 0, "direção visual presente");
  assert.ok(b.delivery.length > 0);
  assert.equal(b.transparency, INSTA_BLUEPRINT_TRANSPARENCIA);
  assert.match(b.ideia, /planilhas/);
  assert.match(b.ideia, /Reels/);
});

test("nicho detectado com confiança alta/média é reutilizado (origin detected)", () => {
  const b = buildContentBlueprint({
    trend: makeTrend({ niche: "planilhas", niche_confidence: "high" }),
    objective: "engajamento",
    keywords: ["planilhas", "vendas"],
  });
  assert.equal(b.niche.niche, "planilhas");
  assert.equal(b.niche.confidence, "high");
  assert.equal(b.niche.origin, "detected");
  assert.equal(b.evidence.nicho, "planilhas");
});

test("nicho manual: escolha explícita do usuário vence a detecção", () => {
  const b = buildContentBlueprint({
    trend: makeTrend({ niche: null, niche_confidence: null }),
    objective: "engajamento",
    niche: "vendas",
  });
  assert.equal(b.niche.niche, "vendas");
  assert.equal(b.niche.origin, "manual");
  assert.equal(b.niche.confidence, "high");

  // escolha manual vence detecção que também existiria
  const b2 = buildContentBlueprint({
    trend: makeTrend({ niche: "planilhas", niche_confidence: "high" }),
    objective: "engajamento",
    niche: "papelaria criativa",
  });
  assert.equal(b2.niche.niche, "papelaria criativa");
  assert.equal(b2.niche.origin, "manual");
});

test("nicho ausente: não finge que sabe (unknown + dadosLimitados)", () => {
  const b = buildContentBlueprint({
    trend: makeTrend({ niche: null, niche_confidence: null, adaptacao: null, motivo: null }),
    objective: "engajamento",
    keywords: [],
  });
  assert.equal(b.niche.niche, null);
  assert.equal(b.niche.confidence, "unknown");
  assert.equal(b.niche.origin, "unknown");
  assert.equal(b.dadosLimitados, true);
  assert.match(b.adaptation.text, /não vinculou|teu nicho|o padrão/i);
});

test("nicho com confiança BAIXA não é exibido como detectado", () => {
  const b = buildContentBlueprint({
    trend: makeTrend({ niche: "planilhas", niche_confidence: "low" }),
    objective: "engajamento",
    keywords: ["planilhas"],
  });
  assert.equal(b.niche.niche, null);
  assert.equal(b.niche.origin, "unknown");
  assert.equal(b.dadosLimitados, true);
  // a evidência preserva o dado parcial (honesto: parcial, não confirmado)
  assert.equal(b.evidence.nicho, "planilhas");
  assert.equal(b.evidence.nichoConfidence, "low");
});

test("objetivo selecionado aparece no blueprint e influencia o CTA", () => {
  const b = buildContentBlueprint({ trend: makeTrend(), objective: "vendas" });
  assert.equal(b.objective.key, "vendas");
  assert.equal(b.objective.label, "Vendas");
  assert.match(b.cta.text, /Confira a solução no perfil/);
  assert.match(b.delivery, /benefício|entrega|conectando/i);
});

test("formato detectado é o padrão; trocar formato preserva o original", () => {
  const t = makeTrend({ formato: "Reels (áudio)" });
  const b = buildContentBlueprint({ trend: t, objective: "alcance" });
  assert.equal(b.format, "Reels");
  assert.equal(b.subformat, "Áudio");
  assert.equal(b.originalFormat, "Reels");
  assert.equal(b.originalSubformat, "Áudio");

  const trocado = buildContentBlueprint({
    trend: t,
    objective: "alcance",
    format: "Carrossel",
  });
  assert.equal(trocado.format, "Carrossel");
  assert.equal(trocado.subformat, null); // subformato do Reels não pertence ao Carrossel
  assert.equal(trocado.originalFormat, "Reels"); // original preservado
  assert.equal(trocado.originalSubformat, "Áudio");
});

test("Reels recebe estrutura própria (Gancho → Desenvolvimento → Entrega → CTA)", () => {
  const b = buildContentBlueprint({ trend: makeTrend(), objective: "engajamento" });
  assert.equal(b.structure.length, 4);
  assert.match(b.structure[0].rotulo, /Gancho/);
  assert.match(b.structure[3].rotulo, /CTA/);
  assert.notDeepEqual(b.structure, contentStructureForFormat("Carrossel"));
  assert.notDeepEqual(b.structure, contentStructureForFormat("Stories"));
});

test("Carrossel recebe estrutura específica de 6 passos", () => {
  const b = buildContentBlueprint({
    trend: makeTrend({ formato: "Carrossel" }),
    objective: "autoridade",
  });
  assert.equal(b.structure.length, 6);
  assert.match(b.structure[0].rotulo, /Capa/);
  assert.match(b.structure[1].rotulo, /Problema/);
  assert.match(b.structure[5].rotulo, /CTA/);
  assert.match(b.hook, /capa/i);
});

test("Stories recebe estrutura de Contexto/Interação/Entrega/CTA", () => {
  const b = buildContentBlueprint({
    trend: makeTrend({ formato: "Stories" }),
    objective: "conexao",
  });
  assert.equal(b.structure.length, 4);
  assert.match(b.structure[0].rotulo, /Contexto/);
  assert.match(b.structure[1].rotulo, /Interação/);
  assert.match(b.structure[3].rotulo, /CTA/);
});

test("tendência com adaptação real reutiliza o texto (sem inventar)", () => {
  const t = makeTrend({ adaptacao: "Foque no seu nicho de planilhas." });
  const b = buildContentBlueprint({ trend: t, objective: "seguidores" });
  assert.equal(b.adaptation.text, "Foque no seu nicho de planilhas.");
  assert.equal(b.adaptation.origem, "adaptacao");
});

test("tendência sem adaptação: fallback estrutural honesto (nunca inventa mercado)", () => {
  const b = buildContentBlueprint({
    trend: makeTrend({ adaptacao: null, motivo: null }),
    objective: "vendas",
    niche: "produtos digitais",
  });
  assert.equal(b.adaptation.origem, "estrutural");
  assert.match(b.adaptation.text, /produtos digitais/);
  assert.match(b.adaptation.text, /sem copiar/);
  assert.doesNotMatch(b.adaptation.text, /faturamento|alcance|viral/);
});

test("dados insuficientes são sinalizados (dadosLimitados)", () => {
  const fraca = buildContentBlueprint({
    trend: makeTrend({ signal_quality: "insuficiente", niche: null }),
    objective: "engajamento",
  });
  assert.equal(fraca.dadosLimitados, true);

  const boa = buildContentBlueprint({
    trend: makeTrend({ signal_quality: "alta", niche: "planilhas", niche_confidence: "high" }),
    objective: "engajamento",
    keywords: ["planilhas"],
  });
  assert.equal(boa.dadosLimitados, false);
});

test("CTA por objetivo (central + modulação por formato)", () => {
  assert.match(buildCtaForObjective("engajamento", "Reels").text, /Qual desses/);
  assert.match(buildCtaForObjective("alcance", "Reels").text, /Envie para alguém/);
  assert.match(buildCtaForObjective("autoridade", "Reels").text, /Salve/);
  assert.match(buildCtaForObjective("seguidores", "Reels").text, /Siga/);
  assert.match(buildCtaForObjective("conexao", "Reels").text, /Conta aqui/);
  // modulação por formato
  assert.match(buildCtaForObjective("vendas", "Carrossel").text, /^No último slide:/);
  assert.match(buildCtaForObjective("vendas", "Stories").text, /^Na última story:/);
  // objetivo → CTA coerente e explicado
  const c = buildCtaForObjective("vendas", "Reels");
  assert.ok(c.reason.length > 0, "CTA precisa explicar o porquê");
});

test("estrutura por formato nunca usa uma única lista para todos", () => {
  const reels = contentStructureForFormat("Reels").map((s) => s.rotulo);
  const carrossel = contentStructureForFormat("Carrossel").map((s) => s.rotulo);
  const stories = contentStructureForFormat("Stories").map((s) => s.rotulo);
  const generico = contentStructureForFormat("Video weirdo").map((s) => s.rotulo);
  assert.notDeepEqual(reels, carrossel);
  assert.notDeepEqual(reels, stories);
  assert.notDeepEqual(stories, carrossel);
  assert.equal(generico.length, 4); // fallback estruturado, nunca vazio
  assert.equal(contentStructureForFormat(null).length, 4);
});

test("direção visual é compatível com o formato", () => {
  const reels = buildVisualDirection("Reels");
  const carrossel = buildVisualDirection("Carrossel");
  assert.ok(reels.some((v) => /cena/i.test(v)));
  assert.ok(carrossel.some((v) => /capa/i.test(v)));
  assert.notDeepEqual(reels, carrossel);
  assert.ok(buildVisualDirection(null).length > 0);
});

test("preservação das evidências: sinais reais da linha", () => {
  const t = makeTrend({
    score: 82,
    compat: 75,
    crescimento: 60,
    seen_count: 3,
    signal_quality: "media",
    first_seen_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  });
  const b = buildContentBlueprint({ trend: t, objective: "trafego" });
  const e = b.evidence;
  assert.equal(e.tendencia, t.nome);
  assert.equal(e.score, 82);
  assert.equal(e.ciclo, "crescendo");
  assert.equal(e.cicloLabel, "📈 Crescendo");
  assert.equal(e.compat, 75);
  assert.equal(e.crescimento, 60);
  assert.equal(e.seenCount, 3);
  assert.equal(e.qualidade, "media");
  assert.equal(e.qualidadeLabel, "Média");
  assert.equal(e.primeiraVista, t.first_seen_at);
  assert.equal(e.fonte, "Busca pública (web)");
  assert.equal(e.recenciaDias, 5);
});

test("prepareBlueprintPayload: payload exato pronto para a próxima etapa (sem IA)", () => {
  const t = makeTrend();
  const b = buildContentBlueprint({ trend: t, objective: "autoridade" });
  const p = prepareBlueprintPayload(b);
  assert.equal(p.trend, t);
  assert.equal(p.format, b.format);
  assert.equal(p.hook, b.hook);
  assert.deepEqual(p.structure, b.structure);
  assert.deepEqual(p.cta, b.cta);
  assert.deepEqual(p.visualDirection, b.visualDirection);
  assert.deepEqual(p.evidence, b.evidence);
  assert.equal(p.niche.niche, b.niche.niche);
});
