// Testes de unidade (node:test, sem framework) da camada pura:
//   src/lib/instagram-quality.ts   (normalização/resolução honesta)
//   src/lib/instagram-formatos.ts  (análise "Formatos em Alta")
// Executar:  npm run test:unit   (--import ./tests/loader.mjs registra o hook
// do alias "@/" e o Node ≥ 23.6 faz type-stripping do .ts)
import test from "node:test";
import assert from "node:assert/strict";

import {
  normPhrase,
  phraseHas,
  normalizeTrendFormat,
  resolveTrendNiche,
  deriveTrendSource,
  calculateSignalQuality,
  buildTrendSnapshot,
} from "../src/lib/instagram-quality.ts";

import {
  analyzeFormatos,
  groupTrendsByFormato,
  trendEmPeriodo,
  trendMencionaNicho,
  computeFormatoScore,
  deriveFormatoStatus,
} from "../src/lib/instagram-formatos.ts";

// ---------------------------------------------------------------------------
// fábrica de tendências sintéticas para os TESTES (não toca em dados reais)
// ---------------------------------------------------------------------------
function makeTrend(overrides = {}) {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    nome: "Tendência de teste",
    categoria: "outros",
    ciclo: "estavel",
    score: 70,
    compat: 60,
    crescimento: 55,
    motivo: "Sinais públicos observados em busca web.",
    adaptacao: "Adapte para o seu nicho.",
    formato: "Reels",
    fonte: "web",
    fonte_detalhe: "Busca pública",
    url: "https://example.com/artigo",
    coletado_em: new Date().toISOString(),
    ...overrides,
  };
}

const AGORA = Date.now();
const diasAtrasMs = (d) => new Date(AGORA - d * 86_400_000).toISOString();

// ---------------------------------------------------------------------------
test("normPhrase: ignora caixa, acentos e pontuação", () => {
  assert.equal(normPhrase("Automação!"), "automacao");
  assert.equal(normPhrase("  Reels (áudio)  "), "reels audio");
  assert.equal(normPhrase(""), "");
});

test("phraseHas: palavra inteira apenas (ia NÃO casa em simpatia)", () => {
  assert.equal(phraseHas("Simpatia e vendas", "ia"), false);
  assert.equal(phraseHas("IA para texto", "ia"), true);
  assert.equal(phraseHas("Planilhas de datas", "Planilhas"), true);
  assert.equal(phraseHas("", "x"), false);
});

test("normalizeTrendFormat: cai no grupo canônico e preserva subformato", () => {
  assert.deepEqual(normalizeTrendFormat("Reels (áudio)"), {
    formato: "Reels",
    subformato: "Áudio",
    raw: "Reels (áudio)",
  });
  assert.deepEqual(normalizeTrendFormat("Carrossel (fotos)"), {
    formato: "Carrossel",
    subformato: "Fotos",
    raw: "Carrossel (fotos)",
  });
  assert.deepEqual(normalizeTrendFormat("Carrossel"), {
    formato: "Carrossel",
    subformato: null,
    raw: "Carrossel",
  });
  assert.equal(normalizeTrendFormat(null).formato, null);
  assert.equal(normalizeTrendFormat(undefined).formato, null);
  assert.equal(normalizeTrendFormat("stories").formato, "Stories");
  assert.equal(normalizeTrendFormat("REELS").formato, "Reels");
  assert.equal(normalizeTrendFormat("Feed + Reels").formato, "Feed + Reels");
  // base desconhecida é mantida, nunca renomeada
  assert.equal(normalizeTrendFormat("Storytime").formato, "Storytime");
});

test("resolveTrendNiche: prioriza evidência forte e nunca inventa nicho", () => {
  const kw = ["planilhas", "ia para conteúdo", "vendas"];
  // keyword no título → high
  assert.deepEqual(resolveTrendNiche({ nome: "Como usar planilhas no dia a dia" }, kw), {
    niche: "planilhas",
    confidence: "high",
  });
  // keyword só no snippet → medium
  assert.deepEqual(resolveTrendNiche({ nome: "Post X", motivo: "aplica vendas diretas" }, kw), {
    niche: "vendas",
    confidence: "medium",
  });
  // keyword composta só com 1 palavra achada → low (parcial)
  assert.deepEqual(resolveTrendNiche({ nome: "Fale sobre IA aqui" }, kw), {
    niche: "ia para conteúdo",
    confidence: "low",
  });
  // explicit vence qualquer texto
  assert.deepEqual(resolveTrendNiche({ nome: "nada", explicit: "marketing digital" }, kw), {
    niche: "marketing digital",
    confidence: "high",
  });
  // sem keyword na lista
  assert.deepEqual(resolveTrendNiche({ nome: "qualquer coisa" }, []), {
    niche: null,
    confidence: "unknown",
  });
  // sem correspondência
  assert.deepEqual(resolveTrendNiche({ nome: "Receita de bolo", motivo: "massa" }, kw), {
    niche: null,
    confidence: "unknown",
  });
  // nunca considera `adaptacao` (que repete keywords automaticamente)
  assert.deepEqual(
    resolveTrendNiche({ nome: "Post genérico", motivo: "algo", extra: "adaptacao planilhas" }, kw),
    { niche: "planilhas", confidence: "medium" },
  );
});

test("deriveTrendSource: honesto sobre INSTAGRAM/telegram do dado", () => {
  assert.equal(deriveTrendSource({ url: "https://x.io" }), "web_search");
  assert.equal(deriveTrendSource({ provider: "bing" }), "web_search");
  assert.equal(deriveTrendSource({}), "engine");
  assert.equal(deriveTrendSource({ url: "https://x.io", manual: true }), "manual");
});

test("calculateSignalQuality: conta sinais reais, sem inventar", () => {
  assert.equal(calculateSignalQuality({}), "insuficiente");
  assert.equal(calculateSignalQuality({ url: "https://x.io" }), "baixa");
  assert.equal(
    calculateSignalQuality({ url: "https://x.io", provider: "bing", text: "x".repeat(150) }),
    "media",
  );
  assert.equal(
    calculateSignalQuality({
      url: "https://x.io",
      provider: "bing",
      published: new Date().toISOString(),
      text: "x".repeat(150),
    }),
    "alta",
  );
  // fonte oficial compensa sinal baixo, mas nunca cria "alta" sozinha
  assert.equal(calculateSignalQuality({ fonte: "oficial" }), "media");
  assert.equal(calculateSignalQuality({ fonte: "oficial", url: "https://x.io" }), "media");
  // data inválida não conta como sinal
  assert.equal(calculateSignalQuality({ url: "https://x.io", published: "ontem" }), "baixa");
  assert.equal(calculateSignalQuality({ url: null }), "insuficiente");
});

test("buildTrendSnapshot: prefere valores da coleta e cai em regras de fallback", () => {
  const t = makeTrend({
    nome: "Como usar planilhas",
    formato: "Reels (áudio)",
    first_seen_at: diasAtrasMs(3),
    last_seen_at: diasAtrasMs(1),
  });
  const s = buildTrendSnapshot(t, ["planilhas"]);
  assert.equal(s.key, "como usar planilhas");
  assert.equal(s.formato, "Reels");
  assert.equal(s.subformato, "Áudio");
  assert.deepEqual(s.nicho, "planilhas");
  assert.equal(s.nichoConfidence, "high");
  assert.equal(s.source, "web_search");
  assert.equal(s.primeiraColetaEm, t.first_seen_at);
  assert.equal(s.ultimaColetaEm, t.last_seen_at);
});

test("groupTrendsByFormato: 'Reels (áudio)' e 'Reels' caem no mesmo grupo", () => {
  const trends = [
    makeTrend({ formato: "Reels (áudio)" }),
    makeTrend({ formato: "Reels" }),
    makeTrend({ formato: "Carrossel" }),
    makeTrend({ formato: null }),
    makeTrend({ formato: "Stories (dica)" }),
  ];
  const groups = groupTrendsByFormato(trends);
  assert.equal(groups.size, 3);
  assert.equal(groups.get("Reels").length, 2);
  assert.equal(groups.get("Carrossel").length, 1);
  assert.equal(groups.get("Stories").length, 1);
});

test("trendEmPeriodo: usa first_seen (nunca sobrescrito), não coletado_em", () => {
  const antiga = makeTrend({
    first_seen_at: diasAtrasMs(40),
    coletado_em: new Date().toISOString(),
  });
  assert.equal(trendEmPeriodo(antiga, "24h"), false);
  assert.equal(trendEmPeriodo(antiga, "7d"), false);
  assert.equal(trendEmPeriodo(antiga, "30d"), false);
  assert.equal(trendEmPeriodo(antiga, "todos"), true);

  const recente = makeTrend({ first_seen_at: diasAtrasMs(2), coletado_em: diasAtrasMs(40) });
  assert.equal(trendEmPeriodo(recente, "24h"), false);
  assert.equal(trendEmPeriodo(recente, "7d"), true);
});

test("trendMencionaNicho: nicho gravado ≫ texto observado (nunca adaptacao)", () => {
  const gravado = makeTrend({ niche: "planilhas", niche_confidence: "high", nome: "xd" });
  assert.equal(trendMencionaNicho(gravado, "planilhas"), true);
  assert.equal(trendMencionaNicho(gravado, "vendas"), false);

  const legado = makeTrend({ nome: "Post sobre vendas hoje" });
  assert.equal(trendMencionaNicho(legado, "vendas"), true);
  assert.equal(trendMencionaNicho(legado, "planilhas"), false);
});

test("computeFormatoScore e deriveFormatoStatus: limites e status corretos", () => {
  assert.equal(computeFormatoScore(100, 1, 100, 100), 100);
  assert.equal(computeFormatoScore(0, 0, 0, 0), 0);
  assert.equal(deriveFormatoStatus(0.8, 0.1), "alta");
  assert.equal(deriveFormatoStatus(0.5, 0.2), "crescendo");
  assert.equal(deriveFormatoStatus(0.2, 0.6), "perdendo");
  assert.equal(deriveFormatoStatus(0.2, 0.2), "estavel");
});

test("analyzeFormatos: agrega qualidade, subformatos, histórico e sinaliza dados limitados", () => {
  const base = diasAtrasMs(1);
  const trends = [
    makeTrend({
      nome: "Como usar planilhas",
      formato: "Reels (áudio)",
      score: 90,
      ciclo: "auge",
      signal_quality: "alta",
      first_seen_at: base,
      last_seen_at: diasAtrasMs(1),
    }),
    makeTrend({
      nome: "Planilhas para datas",
      formato: "Reels (áudio)",
      score: 80,
      ciclo: "crescendo",
      signal_quality: "alta",
      first_seen_at: base,
      last_seen_at: diasAtrasMs(1),
    }),
    makeTrend({
      nome: "Planilhas no dia a dia",
      formato: "Reels",
      score: 70,
      ciclo: "auge",
      signal_quality: "alta",
      first_seen_at: base,
      last_seen_at: diasAtrasMs(2),
    }),
    makeTrend({
      nome: "Carrossel genérico",
      formato: "Carrossel",
      score: 60,
      ciclo: "estavel",
      signal_quality: "alta",
      first_seen_at: base,
      last_seen_at: base,
    }),
    makeTrend({
      nome: "Carrossel outro",
      formato: "Carrossel",
      score: 55,
      ciclo: "caindo",
      signal_quality: "alta",
      first_seen_at: base,
      last_seen_at: base,
    }),
  ];

  const analise = analyzeFormatos(trends, ["planilhas"]);
  assert.equal(analise.suficiente, true); // ≥5 tendências
  assert.equal(analise.total, 5);
  assert.equal(analise.dadosLimitados, false); // metade ou mais têm sinais fortes

  const reels = analise.results.find((r) => r.formato === "Reels");
  assert.ok(reels);
  assert.equal(reels.count, 3);
  assert.equal(reels.countEmAlta, 3);
  assert.equal(reels.status, "alta");
  // subformato Áudio ≠ sem variação → agregados separados
  assert.deepEqual(reels.subformatos.map((s) => s.subformato).sort(), [null, "Áudio"]);
  assert.equal(reels.subformatos.find((s) => s.subformato === "Áudio").count, 2);
  assert.equal(reels.comHistorico, 1); // só "Planilhas no dia a dia" tem last_seen ≠ first_seen
  assert.equal(reels.nichoResolvido, 3); // "planilhas" no título de cada Reels
  assert.ok(reels.dataInicio && reels.dataFim && reels.dataFim >= reels.dataInicio);
  assert.equal(reels.qualidade["alta"], 3);

  const carrossel = analise.results.find((r) => r.formato === "Carrossel");
  assert.ok(carrossel);
  assert.equal(carrossel.qualidade["alta"], 2);
  assert.equal(carrossel.status, "perdendo"); // 1/2 caindo
});

test("analyzeFormatos: insuficiente e semHistórico são sinalizados", () => {
  const poucas = [
    makeTrend({ first_seen_at: diasAtrasMs(1), last_seen_at: diasAtrasMs(1) }),
    makeTrend({ first_seen_at: diasAtrasMs(2), last_seen_at: diasAtrasMs(2) }),
    makeTrend({ first_seen_at: diasAtrasMs(3), last_seen_at: diasAtrasMs(3) }),
  ];
  const a = analyzeFormatos(poucas, []);
  assert.equal(a.suficiente, false);
  assert.equal(a.dadosLimitados, true);
  assert.equal(a.semHistorico, true);

  const vazio = analyzeFormatos([], []);
  assert.equal(vazio.suficiente, false);
  assert.equal(vazio.results.length, 0);
  assert.equal(vazio.semHistorico, false); // sem dados não é "sem histórico" (evita alarme falso)
});
