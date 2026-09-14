// ============================================================
// Radar do Algoritmo — Instagram — "✨ TRANSFORMAR TENDÊNCIA EM CONTEÚDO"
//
// Camada pura (sem I/O, sem React) que transforma UMA tendência
// real do Radar em uma IDEIA DE CONTEÚDO estruturada (blueprint).
//
// Honestidade (regras do projeto):
//   - NADA aqui inventa métrica, tendência, legenda, roteiro ou
//     publicação de terceiros. O blueprint é uma ORIENTAÇÃO
//     ESTRUTURAL derivada dos sinais REAIS da tendência.
//   - Gancho/estrutura/direção visual/CTA são orientações por
//     regra (formatos × objetivos), nunca copy pronta.
//   - Se um sinal não existe na linha, ele é omitido (null) ou
//     rotulado "não informado" — nunca preenchido com chute.
//   - A adaptação reutiliza `adaptacao`/`motivo` reais quando
//     existem e só gera orientação estrutural no fallback.
//   - Não copia conteúdo de terceiros: usa o PADRÃO observado
//     para sugerir uma adaptação original.
//
// A redação final com IA é uma etapa FUTURA. Este arquivo já
// exporta `prepareBlueprintPayload` com o payload exato que a IA
// deverá consumir.
// ============================================================

import {
  type InstaCiclo,
  type InstaNicheConfidence,
  type InstaSignalQuality,
  type InstaTrend,
  type InstaTrendSource,
} from "@/lib/instagram-radar";
import {
  INSTA_CICLO_LABELS,
  INSTA_FORMATS,
  INSTA_NICHE_CONFIDENCE_LABELS,
  INSTA_SIGNAL_QUALITY_LABELS,
  INSTA_TREND_SOURCE_LABELS,
} from "@/lib/instagram-radar";
import { normalizeTrendFormat, normPhrase } from "@/lib/instagram-quality";
import { signalQualityOf, trendNichoEfetivo } from "@/lib/instagram-formatos";
import { INSTA_OBJETIVOS, type InstaObjetivo } from "@/lib/instagram-recommend";

// ------------------------------------------------------------
// Tipos públicos
// ------------------------------------------------------------

export type InstaBlueprintNiche = {
  /** Keyword do nicho usada no blueprint (null = nenhuma). */
  niche: string | null;
  /** Confiança do vínculo tendência ↔ nicho (detecção ou escolha). */
  confidence: InstaNicheConfidence;
  /** Origem da decisão: apoiada na detecção, escolhida manualmente ou ausente. */
  origin: "detected" | "manual" | "unknown";
};

export type InstaBlueprintObjective = {
  key: InstaObjetivo;
  label: string;
  emoji: string;
  desc: string;
};

export type InstaBlueprintStep = {
  rotulo: string;
  descricao: string;
};

export type InstaBlueprintCta = {
  text: string;
  /** Por que este CTA foi escolhido (vínculo com o objetivo). */
  reason: string;
};

export type InstaBlueprintAdaptation = {
  text: string;
  /** Origem do texto usado: conteúdo real da tendência ou orientação estrutural. */
  origem: "adaptacao" | "motivo" | "estrutural";
};

/**
 * Evidências REAIS preservadas e expostas no blueprint.
 * Cada campo é um sinal que efetivamente existe na linha — nada é chute.
 */
export type InstaBlueprintEvidence = {
  formato: string | null;
  subformato: string | null;
  tendencia: string;
  score: number;
  ciclo: InstaCiclo;
  cicloLabel: string;
  nicho: string | null;
  nichoConfidence: InstaNicheConfidence | null;
  nichoOrigem: InstaBlueprintNiche["origin"];
  compat: number | null;
  crescimento: number | null;
  primeiraVista: string | null;
  ultimaVista: string | null;
  seenCount: number | null;
  qualidade: InstaSignalQuality;
  qualidadeLabel: string;
  source: InstaTrendSource | null;
  fonte: string | null;
  /** Dias desde a primeira vez que o Radar viu a tendência (timestamp real). */
  recenciaDias: number | null;
};

export type ContentBlueprint = {
  /** Objeto COMPLETO da tendência original (nunca só o nome). */
  trend: InstaTrend;
  niche: InstaBlueprintNiche;
  objective: InstaBlueprintObjective;
  /** Formato escolhido (padrão: o detectado na tendência). */
  format: string;
  subformat: string | null;
  /** Formato original da tendência (preservado, mesmo se o usuário trocar). */
  originalFormat: string | null;
  originalSubformat: string | null;
  /** Orientação estrutural de gancho (não é copy final). */
  hook: string;
  /** Estrutura adaptada ao formato (passos + orientação). */
  structure: InstaBlueprintStep[];
  /** Orientação de desenvolvimento/entrega para o formato. */
  delivery: string;
  cta: InstaBlueprintCta;
  /** Orientações visuais compatíveis com o formato. */
  visualDirection: string[];
  adaptation: InstaBlueprintAdaptation;
  /** Sinais reais utilizados (para a seção "Por que esta ideia foi criada?"). */
  evidence: InstaBlueprintEvidence;
  /** Linha-síntese da ideia (reuso no planejamento / salvar ideia). */
  ideia: string;
  /** Frase de transparência exigida. */
  transparency: string;
  /** true quando a base está limitada (sinal fraco / nicho não confirmado / sem formato). */
  dadosLimitados: boolean;
};

export type ContentBlueprintInput = {
  trend: InstaTrend;
  /** Nicho escolhido manualmente (null = usar detecção). */
  niche?: string | null;
  objective: InstaObjetivo;
  /** Formato escolhido (padrão: o detectado na tendência). */
  format?: string;
  subformat?: string | null;
  /** Keywords do nicho do usuário (config do Radar). */
  keywords?: string[];
  /** Evidências pré-calculadas (opcional — padrão: derivadas da própria tendência). */
  availableSignals?: InstaBlueprintEvidence | null;
};

/** Payload exato da próxima etapa (redação por IA) — NÃO é executado ainda. */
export type ContentBlueprintPayload = {
  /** Id determinístico deste blueprint (rastreabilidade da geração por IA). */
  id?: string;
  trend: InstaTrend;
  niche: InstaBlueprintNiche;
  objective: InstaBlueprintObjective;
  format: string;
  subformat: string | null;
  hook: string;
  structure: InstaBlueprintStep[];
  delivery: string;
  cta: InstaBlueprintCta;
  visualDirection: string[];
  evidence: InstaBlueprintEvidence;
};

/**
 * Id determinístico e estável de um blueprint: derivado dos elementos
 * que definem a geração (tendência + nicho + objetivo + formato + subformato).
 * Mesmo input ⇒ mesmo id; permite provar "este conteúdo veio desta tendência".
 */
export function makeBlueprintPayloadId(input: {
  trendId?: string | null;
  niche?: string | null;
  objectiveKey?: string | null;
  format?: string | null;
  subformat?: string | null;
}): string {
  const base = [
    input.trendId ?? "",
    input.niche ?? "",
    input.objectiveKey ?? "",
    input.format ?? "",
    input.subformat ?? "",
  ].join("|");
  let h = 2166136261; // FNV-1a 32-bit
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `bp_${(h >>> 0).toString(36)}`;
}

export const INSTA_BLUEPRINT_TRANSPARENCIA =
  "Esta sugestão é uma adaptação da tendência detectada pelo Radar. Ela não representa garantia de alcance, viralização, engajamento ou vendas.";

export const INSTA_BLUEPRINT_PREPARACAO =
  "Gerador de conteúdo — em preparação. A redação final com IA chega na próxima etapa; por enquanto o blueprint estruturado já está pronto.";

// ------------------------------------------------------------
// Estruturas por formato (específicas, nunca uma única p/ todos)
// ------------------------------------------------------------

const ESTRUTURAS_POR_FORMATO: Record<string, InstaBlueprintStep[]> = {
  Reels: [
    {
      rotulo: "Gancho",
      descricao: "Abrir nos 3 primeiros segundos com o ponto central da tendência.",
    },
    {
      rotulo: "Desenvolvimento",
      descricao:
        "Mostrar o contexto ou passo a passo ancorado no tema observado, uma ideia por cena.",
    },
    {
      rotulo: "Demonstração/entrega",
      descricao: "Fechar com a resposta ou frase-chave que a tendência sustenta.",
    },
    {
      rotulo: "CTA",
      descricao: "Fechar com a ação do objetivo (comentar, salvar, enviar ou acessar).",
    },
  ],
  Carrossel: [
    {
      rotulo: "Capa",
      descricao: "Slide 1 (4:5) com o título e a promessa do tema — precisa parar o scroll.",
    },
    { rotulo: "Problema", descricao: "Apresentar a dúvida/problema que a tendência toca." },
    {
      rotulo: "Desenvolvimento",
      descricao: "2 a 4 slides explicando o tema em ordem lógica, pouco texto por slide.",
    },
    { rotulo: "Solução", descricao: "Entregar a resposta/consolidação ligada à tendência." },
    { rotulo: "Conclusão", descricao: "Slide final com resumo ou a frase-chave." },
    {
      rotulo: "CTA",
      descricao: "Último slide com a ação do objetivo (salvar, comentar, enviar ou acessar).",
    },
  ],
  Stories: [
    {
      rotulo: "Contexto",
      descricao: "Primeira story apresentando o tema da tendência de forma direta.",
    },
    {
      rotulo: "Interação",
      descricao: "Story seguinte com pergunta/caixa interativa para prender o público.",
    },
    { rotulo: "Entrega", descricao: "Story final com a conclusão ou resposta da tendência." },
    { rotulo: "CTA", descricao: "Fechar com a ação do objetivo na última story." },
  ],
  "Feed + Reels": [
    { rotulo: "Gancho", descricao: "Abrir com o ponto de atenção do tema (reels curto)." },
    { rotulo: "Valor", descricao: "Desenvolver a informação útil ligada à tendência." },
    { rotulo: "Conexão", descricao: "Amarrar com o feed/carrossel para aprofundar o tema." },
    {
      rotulo: "CTA",
      descricao: "Direcionar para a ação do objetivo (perfil, comentário ou envio).",
    },
  ],
  Colab: [
    { rotulo: "Introdução", descricao: "Apresentar quem participa e qual o tema da tendência." },
    { rotulo: "Colaboração", descricao: "Mostrar o tema em conjunto, com valor de cada parte." },
    { rotulo: "Entrega", descricao: "Fechar com o resultado da parceria." },
    { rotulo: "CTA", descricao: "Encerrar com a ação do objetivo." },
  ],
};

const ESTRUTURA_GENERICA: InstaBlueprintStep[] = [
  { rotulo: "Gancho", descricao: "Começar pelo ponto de atenção do tema." },
  {
    rotulo: "Desenvolvimento",
    descricao: "Desenvolver o tema na ordem natural, ancorado na tendência observada.",
  },
  { rotulo: "Entrega", descricao: "Encerrar com a conclusão do tema." },
  { rotulo: "CTA", descricao: "Fechar com a ação clara alinhada ao objetivo." },
];

/** Estrutura de passos ESPECÍFICA do formato (determinística, por regra). */
export function contentStructureForFormat(
  formato: string | null | undefined,
): InstaBlueprintStep[] {
  const key = normPhrase(formato ?? "");
  if (!key) return ESTRUTURA_GENERICA;
  const cano = INSTA_FORMATS.find((f) => normPhrase(f) === key);
  if (cano && ESTRUTURAS_POR_FORMATO[cano]) return ESTRUTURAS_POR_FORMATO[cano];
  for (const [f, steps] of Object.entries(ESTRUTURAS_POR_FORMATO)) {
    if (key.includes(normPhrase(f))) return steps;
  }
  return ESTRUTURA_GENERICA;
}

// ------------------------------------------------------------
// Gancho (orientação estrutural, não copy)
// ------------------------------------------------------------

function buildHookGuidance(formato: string, objetivo: InstaObjetivo): string {
  const f = normPhrase(formato);
  const venda = objetivo === "vendas";
  if (f.includes("carrossel")) {
    return venda
      ? "Use a CAPA com a promessa principal — o primeiro slide deve deixar claro o que o leitor ganha ao continuar."
      : "Abra pela capa com o ponto central ou a resposta da tendência — o primeiro slide precisa parar o scroll.";
  }
  if (ehStory(f)) {
    return venda
      ? "Comece a primeira story com o problema central ligado à tendência e a promessa de resposta."
      : "Na primeira story, apresente o tema da tendência com uma afirmação que desperte curiosidade.";
  }
  if (f.includes("reels") || f.includes("video") || f.includes("feed")) {
    return venda
      ? "Mostre nos 3 primeiros segundos o resultado concreto ligado à tendência — depois explique como chegar até ele."
      : "Mostre nos 3 primeiros segundos o ponto central ou resultado da tendência — depois explique o caminho.";
  }
  if (f.includes("colab")) {
    return "Apresente o contexto da colaboração e o que cada parte agrega, de forma curta e direta.";
  }
  return venda
    ? "Comece apresentando o problema principal que a tendência toca e a promessa de resposta."
    : "Comece apresentando o problema principal que a tendência toca para abrir curiosidade.";
}

// ------------------------------------------------------------
// Entrega/desenvolvimento (orientação por formato × objetivo)
// ------------------------------------------------------------

function buildDeliveryGuidance(formato: string, objetivo: InstaObjetivo): string {
  const f = normPhrase(formato);
  let base: string;
  if (f.includes("carrossel")) {
    base =
      "Do slide 2 ao penúltimo, desenvolva problema → solução com pouco texto por slide e hierarquia visual clara.";
  } else if (ehStory(f)) {
    base =
      "Conecte o tema em 2 a 4 stories, uma ideia por story, terminando com a entrega na última.";
  } else if (f.includes("reels") || f.includes("video")) {
    base = "Desenvolva uma ideia por cena, texto curto na tela, sempre ancorado no tema observado.";
  } else if (f.includes("colab")) {
    base = "Conduza o tema em conjunto, mostrando o valor real de cada parte da parceria.";
  } else {
    base = "Desenvolva o tema em blocos curtos, ancorado no ponto central da tendência.";
  }
  const objetivoParte: Record<InstaObjetivo, string> = {
    alcance: "Mantenha o ritmo rápido e informação fácil de consumir para estender a retenção.",
    engajamento: "Deixe uma abertura para o público opinar durante o desenvolvimento.",
    seguidores: "Mostre o tema de forma leve e acessível, de preferência seguindo uma sequência.",
    vendas: "Encerre conectando o tema a uma entrega/solução sua, sem prometer resultado.",
    autoridade: "Traga passo a passo e clareza, mostrando domínio sem inventar dado.",
    conexao: "Use tom pessoal e próximo, falando com o público como interlocutor.",
    trafego: "Priorize a clareza do tema para quem encontra o conteúdo de fora.",
  };
  const objetivoBase: Record<InstaObjetivo, string> = {
    alcance: "Priorize clareza e enxurrada de valor nos primeiros segundos.",
    engajamento: "Priorize clareza e espaço para opinião do público.",
    seguidores: "Priorize clareza e leveza para o conteúdo ser fácil de acompanhar.",
    vendas: "Priorize clareza do benefício sem prometer resultados.",
    autoridade: "Priorize exatidão e profundidade do tema.",
    conexao: "Priorize proximidade e tom de conversa.",
    trafego: "Priorize título/abertura claros e navegação simples.",
  };
  const nuance = objetivo === "vendas" ? objetivoBase[objetivo] : objetivoParte[objetivo];
  return `${base} ${nuance}`;
}

// ------------------------------------------------------------
// CTA central (por objetivo, modulado pelo formato)
// ------------------------------------------------------------

const CTA_POR_OBJETIVO: Record<InstaObjetivo, { text: string; reason: string }> = {
  alcance: {
    text: "Envie para alguém que precisa ver isso.",
    reason: "Compartilhamento é a ação que mais expande alcance.",
  },
  engajamento: {
    text: "Qual desses você escolheria? Comenta abaixo.",
    reason: "Pergunta aberta convida o público a comentar.",
  },
  seguidores: {
    text: "Siga para acompanhar essa trend para os próximos passos.",
    reason: "Acompanhar a sequência incentiva a seguir o perfil.",
  },
  vendas: {
    text: "Confira a solução no perfil.",
    reason: "Direciona a atenção para a oferta sem prometer resultado.",
  },
  autoridade: {
    text: "Salve para consultar depois.",
    reason: "Salvar reforça a percepção de conteúdo útil/confiável.",
  },
  conexao: {
    text: "Conta aqui como você faz isso — sem certo ou errado.",
    reason: "Resposta pessoal cria vínculo com o público.",
  },
  trafego: {
    text: "Compartilhe com quem vai gostar do que vem a seguir.",
    reason: "O compartilhamento focado leva novas visitas ao perfil.",
  },
};

/** true para "Stories"/"Story" (e variações), já que "stories" não contém "story". */
function ehStory(f: string): boolean {
  return f === "story" || f === "stories" || f.startsWith("story") || f.startsWith("storie");
}

/** CTA sugerido: texto central do objetivo + modulação de posição por formato. */
export function buildCtaForObjective(objetivo: InstaObjetivo, formato: string): InstaBlueprintCta {
  const base = CTA_POR_OBJETIVO[objetivo] ?? CTA_POR_OBJETIVO.engajamento;
  const f = normPhrase(formato);
  if (f.includes("carrossel")) {
    return { text: `No último slide: ${base.text}`, reason: base.reason };
  }
  if (ehStory(f)) {
    return { text: `Na última story: ${base.text}`, reason: base.reason };
  }
  if (f.includes("colab")) {
    return { text: `Depois da entrega: ${base.text}`, reason: base.reason };
  }
  return base;
}

// ------------------------------------------------------------
// Direção visual por formato (sem gerar imagens)
// ------------------------------------------------------------

export function buildVisualDirection(formato: string | null | undefined): string[] {
  const f = normPhrase(formato ?? "");
  if (f.includes("carrossel")) {
    return [
      "capa forte em formato 4:5",
      "hierarquia visual clara (título → conteúdo → conclusão)",
      "pouco texto por slide",
      "CTA final com botão/pegada visual",
    ];
  }
  if (ehStory(f)) {
    return [
      "abrir com motion text",
      "sequência curta (2 a 4 stories)",
      "uma ideia por story",
      "CTA com caixa interativa na última",
    ];
  }
  if (f.includes("reels") || f.includes("video")) {
    return [
      "cenas rápidas",
      "texto na tela acompanhando a fala",
      "demonstração/contexto visual",
      "fechamento com CTA em destaque",
    ];
  }
  if (f.includes("colab")) {
    return [
      "identidade visual das duas partes",
      "enquadramento compartilhado",
      "corte dinâmico entre as cenas",
      "CTA final alinhado ao objetivo",
    ];
  }
  if (f.includes("feed")) {
    return [
      "gancho consistente entre feed e reels",
      "estética/cores coerentes com o perfil",
      "CTA alinhado ao objetivo",
      "linha de leitura clara",
    ];
  }
  return [
    "hierarquia de leitura definida",
    "poucos elementos por tela",
    "texto legível em mobile",
    "CTA visível no fechamento",
  ];
}

// ------------------------------------------------------------
// Adaptação ao nicho (reuso real + fallback estrutural)
// ------------------------------------------------------------

function buildAdaptation(
  t: InstaTrend,
  niche: string | null,
  objetivoLabel: string,
): InstaBlueprintAdaptation {
  if (t.adaptacao && String(t.adaptacao).trim()) {
    return { text: t.adaptacao, origem: "adaptacao" };
  }
  if (t.motivo && String(t.motivo).trim()) {
    return { text: t.motivo, origem: "motivo" };
  }
  if (niche) {
    return {
      text: `Use a ESTRUTURA observada na tendência para falar sobre "${niche}". Adapte o contexto de origem ao seu nicho — sem copiar a publicação específica.`,
      origem: "estrutural",
    };
  }
  return {
    text: `O Radar não vinculou esta tendência a uma keyword do seu nicho. Aproveite o formato e o padrão dela, adaptando o tema à sua linguagem (sem copiar a publicação observada).`,
    origem: "estrutural",
  };
}

// ------------------------------------------------------------
// Evidências (somente sinais reais da linha)
// ------------------------------------------------------------

const DIAS_MS = 86_400_000;

function diasParaAtras(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.max(0, Math.round((Date.now() - d) / DIAS_MS));
}

function buildEvidence(
  t: InstaTrend,
  nichoUsado: { niche: string | null; confidence: InstaNicheConfidence },
  nichoOrigem: InstaBlueprintNiche["origin"],
  formato: string,
  subformato: string | null,
  detectRaw: { niche: string | null; confidence: InstaNicheConfidence },
): InstaBlueprintEvidence {
  const qualidade = signalQualityOf(t);
  return {
    formato,
    subformato,
    tendencia: t.nome,
    score: t.score,
    ciclo: t.ciclo,
    cicloLabel: INSTA_CICLO_LABELS[t.ciclo],
    nicho: nichoUsado.niche ?? detectRaw.niche ?? null,
    nichoConfidence: nichoUsado.niche
      ? nichoUsado.confidence
      : detectRaw.niche
        ? detectRaw.confidence
        : nichoUsado.confidence,
    nichoOrigem,
    compat: t.compat,
    crescimento: t.crescimento,
    primeiraVista: t.first_seen_at ?? t.created_at ?? t.coletado_em,
    ultimaVista: t.last_seen_at ?? t.coletado_em,
    seenCount: t.seen_count ?? null,
    qualidade,
    qualidadeLabel: INSTA_SIGNAL_QUALITY_LABELS[qualidade],
    source: t.source ?? null,
    fonte: t.source ? INSTA_TREND_SOURCE_LABELS[t.source] : t.fonte || null,
    recenciaDias: diasParaAtras(t.first_seen_at ?? t.created_at ?? t.coletado_em),
  };
}

// ------------------------------------------------------------
// Motor central
// ------------------------------------------------------------

/**
 * Transforma UMA tendência real em ContentBlueprint.
 *
 * Fluxo: normaliza o formato → resolve nicho (detecção ou escolha
 * manual) → objetiva objetivo → gera gancho, estrutura, entrega,
 * CTA, visual, adaptação e evidências — tudo por regra determinística
 * sobre os sinais que existem. A redação final (IA) NÃO é feita aqui.
 */
export function buildContentBlueprint(input: ContentBlueprintInput): ContentBlueprint {
  const t = input.trend;
  const objetivoItem =
    INSTA_OBJETIVOS.find((o) => o.key === input.objective) ?? INSTA_OBJETIVOS[0]!;

  const normTrend = normalizeTrendFormat(t.formato);
  const detectado = normTrend.formato;
  const format = input.format?.trim() || (detectado ?? INSTA_FORMATS[0]!);

  const formatMudou = normPhrase(format) !== normPhrase(detectado ?? "");
  const subformat =
    input.subformat !== undefined
      ? input.subformat
      : formatMudou
        ? null
        : (normTrend.subformato ?? t.subformato ?? null);

  // Nicho: detecção honesta ou escolha manual do usuário.
  // Confiança BAIXA ou DESCONHECIDA NÃO é exibida como "detectada":
  // o usuário escolhe manualmente (seção "nicho" da spec).
  const detect = trendNichoEfetivo(t, input.keywords ?? []);
  let nicheResolvido: { niche: string | null; confidence: InstaNicheConfidence };
  let nicheOrigem: InstaBlueprintNiche["origin"];
  if (input.niche) {
    nicheResolvido = { niche: input.niche, confidence: "high" };
    nicheOrigem = "manual";
  } else if (detect.niche && (detect.confidence === "high" || detect.confidence === "medium")) {
    nicheResolvido = detect;
    nicheOrigem = "detected";
  } else {
    nicheResolvido = { niche: null, confidence: "unknown" };
    nicheOrigem = "unknown";
  }

  const evidence =
    input.availableSignals ??
    buildEvidence(t, nicheResolvido, nicheOrigem, format, subformat, detect);

  const structure = contentStructureForFormat(format);
  const hook = buildHookGuidance(format, objetivoItem.key);
  const cta = buildCtaForObjective(objetivoItem.key, format);

  const ideia =
    `Conteúdo em ${format}${subformat ? ` (${subformat})` : ""} baseado na tendência "${t.nome}" ` +
    `(score ${t.score}/100, ${INSTA_CICLO_LABELS[t.ciclo].toLowerCase()}) para ${objetivoItem.label.toLowerCase()} — adaptação original, sem copiar a publicação observada.`;

  const dadosLimitados =
    evidence.qualidade === "insuficiente" ||
    evidence.qualidade === "baixa" ||
    evidence.nicho == null ||
    evidence.nichoConfidence == null ||
    evidence.nichoConfidence === "unknown" ||
    evidence.nichoConfidence === "low" ||
    !detectado;

  return {
    trend: t,
    niche: {
      niche: nicheResolvido.niche,
      confidence: nicheResolvido.confidence,
      origin: nicheOrigem,
    },
    objective: objetivoItem,
    format,
    subformat,
    originalFormat: detectado ?? t.formato ?? null,
    originalSubformat: normTrend.subformato ?? t.subformato ?? null,
    hook,
    structure,
    delivery: buildDeliveryGuidance(format, objetivoItem.key),
    cta,
    visualDirection: buildVisualDirection(format),
    adaptation: buildAdaptation(t, nicheResolvido.niche, objetivoItem.label),
    evidence,
    ideia,
    transparency: INSTA_BLUEPRINT_TRANSPARENCIA,
    dadosLimitados,
  };
}

/**
 * Payload exato da próxima etapa (redação final por IA).
 * Hoje é apenas preparado/persistido — NÃO chama nenhuma IA.
 */
export function prepareBlueprintPayload(b: ContentBlueprint): ContentBlueprintPayload {
  return {
    id: makeBlueprintPayloadId({
      trendId: b.trend.id ?? null,
      niche: b.niche.niche ?? null,
      objectiveKey: b.objective.key,
      format: b.format,
      subformat: b.subformat,
    }),
    trend: b.trend,
    niche: b.niche,
    objective: b.objective,
    format: b.format,
    subformat: b.subformat,
    hook: b.hook,
    structure: b.structure,
    delivery: b.delivery,
    cta: b.cta,
    visualDirection: b.visualDirection,
    evidence: b.evidence,
  };
}
