// ============================================================
// Radar do Algoritmo — Instagram — "💡 O QUE POSTAR HOJE?"
//
// Camada de RECOMENDAÇÃO sobre os dados que o Radar JÁ tem.
// Zero buscas novas, zero dados inventados: consome somente os
// sinais reais das tendências (src/lib/instagram-radar.ts),
// da análise de formatos (src/lib/instagram-formatos.ts) e do
// snapshot histórico que o próprio Radar gravou em execuções
// anteriores (InstaTrendSnapshot).
//
// Honestidade:
//   - Nenhuma afirmação de que um formato "gera alcance/vendas".
//     O objetivo apenas REORDENA com base em quais sinais REAIS
//     são mais compatíveis com ele (linguagem "mais indicado com
//     base nos sinais coletados").
//   - Se um sinal não existe na linha, ele é ignorado e os pesos
//     são renormalizados sobre os sinais disponíveis (nunca é
//     preenchido com chute).
//   - Momentum/recência só existem quando há timestamp REAL
//     (first_seen_at/coletado_em) ou snapshot anterior (bate-papo
//     por key). updated_at NUNCA é usado (representa atualização
//     do registro, não mudança de comportamento da tendência).
// ============================================================

import {
  analyzeFormatos,
  trendEmPeriodo,
  trendMencionaNicho,
  type InstaFormatoAnalise,
  type InstaFormatoPeriodo,
  type InstaFormatoResult,
} from "@/lib/instagram-formatos";
import { type InstaCiclo, type InstaTrend, type InstaTrendSnapshot } from "@/lib/instagram-radar";

// ------------------------------------------------------------
// Objetivo do conteúdo
// ------------------------------------------------------------

export type InstaObjetivo =
  "alcance" | "engajamento" | "seguidores" | "vendas" | "autoridade" | "conexao" | "trafego";

export type InstaObjetivoItem = {
  key: InstaObjetivo;
  emoji: string;
  label: string;
  /** Descrição honesta de QUAIS sinais são priorizados (não promete resultado). */
  desc: string;
};

export const INSTA_OBJETIVOS: InstaObjetivoItem[] = [
  {
    key: "alcance",
    emoji: "🔥",
    label: "Alcance",
    desc: "Prioriza força do formato, ciclo ativo e recência dos sinais.",
  },
  {
    key: "engajamento",
    emoji: "💬",
    label: "Engajamento",
    desc: "Prioriza ciclo ativo, sinais ricos e afinidade com o nicho.",
  },
  {
    key: "seguidores",
    emoji: "👥",
    label: "Atrair seguidores",
    desc: "Prioriza tendências novas e pouco consolidadas que o Radar acompanha.",
  },
  {
    key: "vendas",
    emoji: "💰",
    label: "Vendas",
    desc: "Prioriza o que tem maior afinidade com a palavra-chave do seu nicho.",
  },
  {
    key: "autoridade",
    emoji: "📚",
    label: "Autoridade",
    desc: "Prioriza tendências com página/evidência observável pelo Radar.",
  },
  {
    key: "conexao",
    emoji: "❤️",
    label: "Conexão",
    desc: "Prioriza novidade e recorrência acompanhada ao longo de execuções.",
  },
  {
    key: "trafego",
    emoji: "🎯",
    label: "Tráfego",
    desc: "Prioriza formatos em força com recência recente no Radar.",
  },
];

// ------------------------------------------------------------
// Oportunidade (classificação INTERNA, nunca previsão)
// ------------------------------------------------------------

export type InstaOportunidadeNivel = "alta" | "boa" | "moderada" | "insuficiente";

export const INSTA_OPORTUNIDADE_LABEL: Record<InstaOportunidadeNivel, string> = {
  alta: "🔥 Alta oportunidade",
  boa: "📈 Boa oportunidade",
  moderada: "➡️ Oportunidade moderada",
  insuficiente: "⚪ Dados insuficientes",
};

export const INSTA_OPORTUNIDADE_CLASS: Record<InstaOportunidadeNivel, string> = {
  alta: "border-red-300 bg-red-50 text-red-700",
  boa: "border-green-300 bg-green-50 text-green-700",
  moderada: "border-slate-300 bg-slate-200 text-slate-700",
  insuficiente: "border-slate-300 bg-slate-100 text-slate-500",
};

/** Tooltip exigido: é classificação interna, não previsão de viralização. */
export const INSTA_OPORTUNIDADE_TOOLTIP =
  "Indicador interno baseado nos sinais disponíveis no Radar. Não representa previsão de viralização.";

// ------------------------------------------------------------
// Confiança
// ------------------------------------------------------------

export type InstaConfiancaNivel = "alta" | "media" | "baixa";

export const INSTA_CONFIANCA_LABEL: Record<InstaConfiancaNivel, string> = {
  alta: "🟢 Alta",
  media: "🟡 Média",
  baixa: "🔴 Baixa",
};

export const INSTA_CONFIANCA_CLASS: Record<InstaConfiancaNivel, string> = {
  alta: "border-emerald-300 bg-emerald-50 text-emerald-700",
  media: "border-amber-300 bg-amber-50 text-amber-800",
  baixa: "border-red-300 bg-red-50 text-red-700",
};

// ------------------------------------------------------------
// Sinais (vetor normalizado 0..1; null = sinal NÃO existe)
// ------------------------------------------------------------

export type InstaSinalVector = {
  mFormatos: number;
  mTendencia: number;
  mCiclo: number;
  mRecencia: number | null;
  mNovidade: number | null;
  mRecorrencia: number;
  mHistorico: number | null;
  mNichomatch: number;
  mQualidade: number;
  mEvidencia: number;
  mCrescimento: number;
};

const SINAL_WEIGHTS: Record<keyof InstaSinalVector, number> = {
  mFormatos: 0.2,
  mTendencia: 0.16,
  mCiclo: 0.1,
  mRecencia: 0.12,
  mNovidade: 0.1,
  mRecorrencia: 0.1,
  mHistorico: 0.08,
  mNichomatch: 0.12,
  mQualidade: 0.1,
  mEvidencia: 0.04,
  mCrescimento: 0.08,
};

/** Peso 0-1 do sinal para a afinidade com o objetivo (soma=1 por objetivo). */
const OBJETIVO_SINAL_PESO: Record<
  InstaObjetivo,
  Partial<Record<keyof InstaSinalVector, number>>
> = {
  alcance: { mFormatos: 0.35, mCiclo: 0.3, mRecencia: 0.2, mRecorrencia: 0.15 },
  engajamento: { mCiclo: 0.3, mQualidade: 0.25, mTendencia: 0.25, mNichomatch: 0.2 },
  seguidores: { mNovidade: 0.35, mRecencia: 0.25, mCrescimento: 0.2, mRecorrencia: 0.2 },
  vendas: { mNichomatch: 0.4, mEvidencia: 0.2, mQualidade: 0.2, mTendencia: 0.2 },
  autoridade: { mEvidencia: 0.4, mQualidade: 0.25, mTendencia: 0.2, mNichomatch: 0.15 },
  conexao: { mNovidade: 0.3, mRecorrencia: 0.25, mNichomatch: 0.25, mCiclo: 0.2 },
  trafego: { mFormatos: 0.35, mRecencia: 0.25, mCiclo: 0.2, mNichomatch: 0.1, mEvidencia: 0.1 },
};

const QUALIDADE_PESO: Record<string, number> = {
  alta: 1,
  media: 0.7,
  baixa: 0.4,
  insuficiente: 0.15,
};

export const INSTA_OBJETIVO_FRASE: Record<InstaObjetivo, string> = {
  alcance: "força do formato, ciclo ativo e recência",
  engajamento: "ciclo, qualidade dos sinais e afinidade com o nicho",
  seguidores: "novidade, recência e recorrência acompanhada",
  vendas: "afinidade com o nicho e evidência observável",
  autoridade: "evidência observável e qualidade dos sinais",
  conexao: "novidade e recorrência acompanhada",
  trafego: "força do formato e recência",
};

// ------------------------------------------------------------
// Estruturas (GANCHO → DESENVOLVIMENTO → ENTREGA → CTA)
// ------------------------------------------------------------

export type InstaEstruturaPasso = { rotulo: string; descricao: string };

const ESTRUTURA_POR_FORMATO: Record<string, InstaEstruturaPasso[]> = {
  Reels: [
    {
      rotulo: "GANCHO",
      descricao: "Abrir nos 3 primeiros segundos com o ponto de atenção do tema.",
    },
    {
      rotulo: "DESENVOLVIMENTO",
      descricao:
        "Mostrar o contexto/passo a passo sem enrolação, sempre ancorado no tema da tendência.",
    },
    {
      rotulo: "ENTREGA",
      descricao: "Fechar com a resposta ou frase-chave escolhida pela tendência.",
    },
    {
      rotulo: "CTA",
      descricao: "Convidar a comentar, salvar ou compartilhar de forma alinhada ao objetivo.",
    },
  ],
  Carrossel: [
    {
      rotulo: "CAPA / GANCHO",
      descricao: "Slide 1 com o título e a promessa do tema (foto/arte 4:5).",
    },
    { rotulo: "DESENVOLVIMENTO", descricao: "2 a 6 slides explicando o tema em ordem lógica." },
    { rotulo: "ENTREGA", descricao: "Último slide com o resumo ou a resposta final." },
    { rotulo: "CTA", descricao: "Indicar salvar/compartilhar, conforme o objetivo escolhido." },
  ],
  Stories: [
    { rotulo: "GANCHO", descricao: "Primeira story com pergunta/afirmação provocativa." },
    { rotulo: "DESENVOLVIMENTO", descricao: "2 a 4 stories mostrando o contexto do tema." },
    { rotulo: "ENTREGA", descricao: "Story final com a conclusão." },
    { rotulo: "CTA", descricao: "Caixa de resposta/pergunta para iniciar conversa." },
  ],
};

const ESTRUTURA_GENERICA: InstaEstruturaPasso[] = [
  { rotulo: "GANCHO", descricao: "Começar pelo ponto de atenção do tema." },
  {
    rotulo: "DESENVOLVIMENTO",
    descricao: "Desenvolver o conteúdo ancorado na tendência observada.",
  },
  { rotulo: "ENTREGA", descricao: "Encerrar com a conclusão do tema." },
  { rotulo: "CTA", descricao: "Fechar com uma ação clara alinhada ao objetivo." },
];

/** Estrutura sugerida (sempre determinística — NÃO é texto criativo por IA). */
export function estruturaDoFormato(formato: string | null | undefined): InstaEstruturaPasso[] {
  const base = (formato ?? "").trim();
  return ESTRUTURA_POR_FORMATO[base] ?? ESTRUTURA_GENERICA;
}

// ------------------------------------------------------------
// Recomendação
// ------------------------------------------------------------

export type InstaMomentumRec = {
  recorrencia: boolean;
  historicoDelta: number | null;
  crescimento: number;
  seenCount: number;
};

export type InstaRecomendacao = {
  rank: number;
  formato: string;
  subformato: string | null;
  formatoScore: number;
  countFormato: number;
  tendencia: InstaTrend;
  nicho: string | null;
  objetivo: InstaObjetivo;
  motivo: string;
  oportunidade: {
    nivel: InstaOportunidadeNivel;
    score: number;
    scoreBase: number;
    afinidadeObjetivo: number;
  };
  confianca: { nivel: InstaConfiancaNivel; score: number };
  momentum: InstaMomentumRec;
  evidencia: {
    formatScore: number;
    trendScore: number;
    ciclo: InstaCiclo;
    crescimento: number;
    compat: number;
    recente: boolean;
    recorrencia: boolean;
    comHistorico: boolean;
    qualidadeGrupo: number;
    qualidadeTendencia: number;
  };
  estrutura: InstaEstruturaPasso[];
  adaptacao: { texto: string; origem: "adaptacao" | "motivo" } | null;
  /** Próxima etapa (IA) ainda NÃO é implementada — payload já preparado. */
  iaInput: {
    niche: string | null;
    objective: InstaObjetivo;
    format: string;
    trend: string;
    trendScore: number;
    momentum: InstaMomentumRec;
    evidence: InstaRecomendacao["evidencia"];
    suggestedStructure: string[];
  };
};

export type InstaRecomendacaoAnalise = {
  estado: "disponivel" | "insuficiente" | "vazio";
  motivo: string;
  confianca: { nivel: InstaConfiancaNivel; score: number } | null;
  recomendacoes: InstaRecomendacao[];
  resumo: {
    totalTrends: number;
    recentes: number;
    recorrentes: number;
    comHistorico: number;
    qualidadeMediaAltaFracao: number;
    formatos: number;
  };
};

// ------------------------------------------------------------
// Helpers de tempo (apenas timestamps REAIS)
// ------------------------------------------------------------

const DIAS_MS = 86_400_000;
const HORIZONTE_DIAS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, todos: 30 };

function min(a: number, b: number): number {
  return a < b ? a : b;
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function round(v: number): number {
  return Math.round(v);
}

/** Dias desde o primeiro registro REAL (first_seen_at → coletado_em → created_at). null se não há. */
export function diasDesdePrimeiraVista(t: InstaTrend): number | null {
  const ts = t.first_seen_at ?? t.coletado_em ?? t.created_at;
  if (!ts) return null;
  const d = new Date(ts).getTime();
  if (Number.isNaN(d)) return null;
  return Math.max(0, (Date.now() - d) / DIAS_MS);
}

/** Descrição relativa ("hoje", "há 2 dias"...). */
export function relativoDias(dias: number): string {
  if (dias < 1) return "hoje";
  if (dias < 2) return "ontem";
  if (dias < 7) return `há ${round(dias)} dias`;
  if (dias < 30) return `há cerca de ${round(dias / 7)} semana${round(dias / 7) === 1 ? "" : "s"}`;
  if (dias < 365)
    return `há cerca de ${round(dias / 30)} ${round(dias / 30) === 1 ? "mês" : "meses"}`;
  return `há mais de 1 ano`;
}

// ------------------------------------------------------------
// Vetor de sinais de UMA tendência dentro do seu formato
// ------------------------------------------------------------

type InputPorCandidato = {
  t: InstaTrend;
  formatoScore: number;
  countFormato: number;
  nichoResolvidoFracao: number;
  qualidadeGrupo: number;
  horizonteDias: number;
  historicoMap: Map<string, InstaTrendSnapshot>;
};

function fracaoQualidadeGrupo(
  q: Partial<Record<string, number> | undefined> | null | undefined,
  count: number,
): number {
  if (!q || count <= 0) return 0;
  const boas = (q["media"] ?? 0) + (q["alta"] ?? 0);
  return boas / count;
}

function buscarHistorico(
  t: InstaTrend,
  historicoMap: Map<string, InstaTrendSnapshot>,
): InstaTrendSnapshot | null {
  return historicoMap.get(t.nome.toLowerCase()) ?? null;
}

function buildVector(inp: InputPorCandidato): InstaSinalVector {
  const { t, formatoScore, countFormato, nichoResolvidoFracao, qualidadeGrupo, horizonteDias } =
    inp;

  const dias = diasDesdePrimeiraVista(t);
  const recorrencia = t.seen_count != null && Number(t.seen_count) >= 2 ? true : false;
  const snap = buscarHistorico(t, inp.historicoMap);
  const historicoDelta =
    snap && snap.score != null && snap.score !== t.score
      ? clamp01(0.5 + (t.score - snap.score) / 200)
      : null;

  const ciclo =
    t.ciclo === "auge"
      ? 1
      : t.ciclo === "crescendo"
        ? 0.85
        : t.ciclo === "surgindo"
          ? 0.6
          : t.ciclo === "saturando"
            ? 0.3
            : 0.1;

  const recencia = dias != null ? clamp01(1 - dias / horizonteDias) : null;
  const novidade = recencia != null ? clamp01(recencia * (recorrencia ? 0.7 : 1)) : null;

  const qTrend = QUALIDADE_PESO[String(t.signal_quality ?? "")] ?? 0.35;
  const nichoMatch = clamp01((t.compat / 100) * 0.6 + nichoResolvidoFracao * 0.4);

  return {
    mFormatos: clamp01(formatoScore / 100),
    mTendencia: clamp01(t.score / 100),
    mCiclo: ciclo,
    mRecencia: recencia,
    mNovidade: novidade,
    mRecorrencia: recorrencia ? 1 : 0,
    mHistorico: historicoDelta,
    mNichomatch: nichoMatch,
    mQualidade: clamp01(qTrend * 0.4 + qualidadeGrupo * 0.6),
    mEvidencia: t.url && String(t.url).length > 0 ? 1 : 0,
    mCrescimento: clamp01(t.crescimento / 100),
  };
}

/** Média ponderada dos sinais DISPONÍVEIS (nulos ignorados, pesos renormalizados). */
function mediaDisponivel(
  v: InstaSinalVector,
  pesos: Partial<Record<keyof InstaSinalVector, number>>,
): number {
  let soma = 0;
  let pesoTotal = 0;
  for (const key of Object.keys(SINAL_WEIGHTS) as (keyof InstaSinalVector)[]) {
    const w = pesos[key];
    if (w == null || w <= 0 || v[key] == null) continue;
    soma += w * Number(v[key]);
    pesoTotal += w;
  }
  return pesoTotal > 0 ? soma / pesoTotal : 0;
}

// ------------------------------------------------------------
// SCORE DE OPORTUNIDADE
// ------------------------------------------------------------

export type InstaOpportunityInput = {
  sinais: InstaSinalVector;
  objetivo: InstaObjetivo;
  /** Fração (0-1) de sinais media/alta no grupo do formato. Define "dados fracos". */
  qualidadeGrupo: number;
};

export type InstaOpportunityResult = {
  score: number;
  scoreBase: number;
  afinidadeObjetivo: number;
  nivel: InstaOportunidadeNivel;
  dadosFracos: boolean;
};

/**
 * Score de OPORTUNIDADE (0-100) — classificação INTERNA, nunca previsão.
 *
 * Fórmula (documentada):
 *
 *   scoreBase = média ponderada dos sinais DISPONÍVEIS do vetor usando
 *               SINAL_WEIGHTS (0.20 força do formato, 0.16 força da
 *               tendência, 0.12 recência, 0.12 afinidade de nicho, 0.10
 *               ciclo, 0.10 recorrência, 0.10 qualidade, 0.08 crescimento,
 *               0.08 histórico, 0.04 evidência).
 *               Sinais que NÃO existem (null) são ignorados e os pesos
 *               renormalizados — nada é inventado.
 *
 *   afinidadeObjetivo = média ponderada (mesma renormalização) sobre o
 *                       subconjunto de sinais que o OBJETIVO enfatiza
 *                       (OBJETIVO_SINAL_PESO).
 *
 *   score = round( scoreBase * 0.75 + afinidadeObjetivo * 0.25 ) * 100
 *
 * Nível do indicador (INTERNO):
 *   - dados fracos (qualidadeGrupo < 0.25)      → "insuficiente"
 *   - score >= 75 "alta" | >= 55 "boa" | >= 32 "moderada" | senão "insuficiente"
 */
export function calculateOpportunityScore(input: InstaOpportunityInput): InstaOpportunityResult {
  const base = mediaDisponivel(input.sinais, SINAL_WEIGHTS);
  const afinidade = mediaDisponivel(input.sinais, OBJETIVO_SINAL_PESO[input.objetivo]);
  const score = round((base * 0.75 + afinidade * 0.25) * 100);
  const dadosFracos = input.qualidadeGrupo < 0.25;

  let nivel: InstaOportunidadeNivel;
  if (dadosFracos) nivel = "insuficiente";
  else if (score >= 75) nivel = "alta";
  else if (score >= 55) nivel = "boa";
  else if (score >= 32) nivel = "moderada";
  else nivel = "insuficiente";

  return {
    score: Math.max(0, Math.min(100, score)),
    scoreBase: round(base * 100),
    afinidadeObjetivo: round(afinidade * 100),
    nivel,
    dadosFracos,
  };
}

// ------------------------------------------------------------
// Confiança da recomendação (qualidade + quantidade dos sinais)
// ------------------------------------------------------------

/** Confiança por candidato, derivada SOMENTE dos sinais reais do grupo. */
function confiancaCandidato(params: {
  qualidadeGrupo: number;
  count: number;
  recente: boolean;
  recorrencia: boolean;
  comHistorico: boolean;
}): { nivel: InstaConfiancaNivel; score: number } {
  let score = 0;
  score += params.qualidadeGrupo * 45;
  score += min(1, params.count / 6) * 25;
  score += params.recente ? 15 : 0;
  score += params.recorrencia || params.comHistorico ? 15 : 0;
  score = round(Math.max(0, Math.min(100, score)));
  const nivel: InstaConfiancaNivel = score >= 70 ? "alta" : score >= 45 ? "media" : "baixa";
  return { nivel, score };
}

// ------------------------------------------------------------
// Motivo dinâmico — "por que o Radar está sugerindo isso?"
// ------------------------------------------------------------

function buildMotivo(params: {
  formato: string;
  count: number;
  formatoScore: number;
  t: InstaTrend;
  objetivo: InstaObjetivo;
  objetivoLabel: string;
  periodo: "todos" | "24h" | "7d" | "30d";
  nicho: string | null;
  recorrencia: boolean;
  historicoDelta: number | null;
}): string {
  const partes: string[] = [];

  const força =
    params.periodo === "todos"
      ? `${params.formato} é um dos formatos de maior força no histórico coletado (Format Score ${params.formatoScore}/100, ${params.count} tendência${params.count > 1 ? "s" : ""}).`
      : `${params.formato} é um dos formatos de maior força no período (Format Score ${params.formatoScore}/100, ${params.count} tendência${params.count > 1 ? "s" : ""} no recorte).`;
  partes.push(força);

  const dias = diasDesdePrimeiraVista(params.t);
  if (dias != null) {
    partes.push(`"${params.t.nome}" foi vista pela primeira vez pelo Radar ${relativoDias(dias)}.`);
  }

  if (params.nicho) {
    const compat =
      params.t.compat != null
        ? `, com ${params.t.compat}% de compatibilidade com a palavra-chave do seu nicho`
        : "";
    partes.push(`Ela está vinculada ao nicho "${params.nicho}"${compat}.`);
  }

  if (params.historicoDelta != null) {
    const variacao = round((params.historicoDelta - 0.5) * 200);
    partes.push(
      variacao >= 5
        ? `Desde a última execução do Radar, o score subiu ${Math.abs(variacao)} pontos.`
        : variacao <= -5
          ? `Na última execução o score caiu ${Math.abs(variacao)} pontos — sinal em queda.`
          : `O score se manteve estável em relação à última execução do Radar.`,
    );
  }

  if (params.recorrencia && params.historicoDelta == null) {
    partes.push("O Radar já gravou esta tendência em mais de uma execução (recorrência real).");
  }

  partes.push(
    `Para o objetivo "${params.objetivoLabel}" foram priorizados: ${INSTA_OBJETIVO_FRASE[params.objetivo]}.`,
  );

  return partes.filter(Boolean).join(" ");
}

// ------------------------------------------------------------
// Adaptação ao nicho (conteúdo EXISTENTE, nunca inventado)
// ------------------------------------------------------------

function adaptacaoDoTrend(t: InstaTrend): { texto: string; origem: "adaptacao" | "motivo" } | null {
  if (t.adaptacao && String(t.adaptacao).trim()) return { texto: t.adaptacao, origem: "adaptacao" };
  if (t.motivo && String(t.motivo).trim()) return { texto: t.motivo, origem: "motivo" };
  return null;
}

// ------------------------------------------------------------
// Recomendações
// ------------------------------------------------------------

export type InstaRecomendacaoInput = {
  trends: InstaTrend[];
  /** Análise de formatos PRÉ-calculada sobre o MESMO conjunto de trends.
   *  Se fornecida com nicho/periodo "todos", nada é re-filtrado. */
  formatos?: InstaFormatoAnalise | null;
  nicho?: "todos" | string;
  objetivo: InstaObjetivo;
  periodo?: InstaFormatoPeriodo;
  keywords?: string[];
  /** Snapshot da execução ANTERIOR do Radar (histórico real). */
  historico?: InstaTrendSnapshot[];
};

/**
 * Constrói as recomendações "O que postar hoje?".
 *
 * Fluxo (exigido): Dados do Radar → normalização → filtros (nicho/período)
 * → avaliação dos sinais → ranking → diversificação → recomendações.
 *
 * Regras de honestidade:
 *   - < 5 tendências OU nenhum grupo de formato → estado "insuficiente"
 *     (não gera recomendação inventada).
 *   - Se > 85% das tendências do recorte têm sinal baixo/insuficiente e
 *     nenhum histórico, o estado é "insuficiente".
 *   - Diversidade: no máximo 2 recomendações do mesmo formato; uma
 *     tendência é usada uma única vez; mínimo de 3 recomendações para
 *     considerar "disponivel" (3-5 cards).
 */
export function buildContentRecommendations(
  input: InstaRecomendacaoInput,
): InstaRecomendacaoAnalise {
  const periodo = input.periodo ?? "todos";
  const nicho = input.nicho ?? "todos";
  const keywords = input.keywords ?? [];

  const filtradas = input.trends.filter((t) => {
    if (periodo !== "todos" && !trendEmPeriodo(t, periodo)) return false;
    if (nicho !== "todos" && !trendMencionaNicho(t, nicho)) return false;
    return true;
  });

  if (filtradas.length === 0) {
    return {
      estado: "vazio",
      motivo:
        "Não há sinais suficientes para recomendar o que postar hoje. Rode o radar para coletar tendências reais de formatos compatíveis com o seu nicho.",
      confianca: null,
      recomendacoes: [],
      resumo: resumoVazio(),
    };
  }

  const analise = input.formatos ?? analyzeFormatos(filtradas, keywords);

  if (!analise.suficiente || analise.results.length === 0) {
    return {
      estado: "insuficiente",
      motivo:
        "Não há sinais suficientes para recomendar o que postar hoje. O Radar precisa de mais dados recentes para gerar uma recomendação confiável.",
      confianca: null,
      recomendacoes: [],
      resumo: buildResumo(filtradas, analise),
    };
  }

  const historicoMap = new Map<string, InstaTrendSnapshot>();
  for (const h of input.historico ?? []) {
    const k = h.key.toLowerCase();
    if (!historicoMap.has(k)) historicoMap.set(k, h);
  }

  const horizonteDias = HORIZONTE_DIAS[periodo] ?? 30;
  const candidatos: { r: InstaRecomendacao; score: number }[] = [];

  for (const grupo of analise.results) {
    const qualidadeGrupo = fracaoQualidadeGrupo(grupo.qualidade, grupo.count);
    for (const t of grupo.trends) {
      const vetor = buildVector({
        t,
        formatoScore: grupo.score,
        countFormato: grupo.count,
        nichoResolvidoFracao: grupo.count > 0 ? grupo.nichoResolvido / grupo.count : 0,
        qualidadeGrupo,
        horizonteDias,
        historicoMap,
      });
      const opp = calculateOpportunityScore({
        sinais: vetor,
        objetivo: input.objetivo,
        qualidadeGrupo,
      });
      const snap = buscarHistorico(t, historicoMap);
      const recorrencia = t.seen_count != null && Number(t.seen_count) >= 2;
      const recente = vetor.mRecencia != null && vetor.mRecencia >= 0.5;

      const conf = confiancaCandidato({
        qualidadeGrupo,
        count: grupo.count,
        recente,
        recorrencia,
        comHistorico: grupo.comHistorico > 0,
      });

      const nichoRec = t.niche ?? null;
      const objetivoItem =
        INSTA_OBJETIVOS.find((o) => o.key === input.objetivo) ?? INSTA_OBJETIVOS[0]!;
      const estrutura = estruturaDoFormato(grupo.formato);

      const rec: InstaRecomendacao = {
        rank: 0,
        formato: grupo.formato,
        subformato: t.subformato ?? null,
        formatoScore: grupo.score,
        countFormato: grupo.count,
        tendencia: t,
        nicho: nichoRec,
        objetivo: input.objetivo,
        motivo: buildMotivo({
          formato: grupo.formato,
          count: grupo.count,
          formatoScore: grupo.score,
          t,
          objetivo: input.objetivo,
          objetivoLabel: objetivoItem.label,
          periodo,
          nicho: nichoRec ?? (nicho !== "todos" ? nicho : null),
          recorrencia,
          historicoDelta: vetor.mHistorico,
        }),
        oportunidade: {
          nivel: opp.nivel,
          score: opp.score,
          scoreBase: opp.scoreBase,
          afinidadeObjetivo: opp.afinidadeObjetivo,
        },
        confianca: conf,
        momentum: {
          recorrencia,
          historicoDelta: vetor.mHistorico,
          crescimento: t.crescimento,
          seenCount: t.seen_count ?? 0,
        },
        evidencia: {
          formatScore: grupo.score,
          trendScore: t.score,
          ciclo: t.ciclo,
          crescimento: t.crescimento,
          compat: t.compat,
          recente,
          recorrencia,
          comHistorico: grupo.comHistorico > 0,
          qualidadeGrupo: round(qualidadeGrupo * 100),
          qualidadeTendencia: round((QUALIDADE_PESO[String(t.signal_quality ?? "")] ?? 0.35) * 100),
        },
        estrutura,
        adaptacao: adaptacaoDoTrend(t),
        iaInput: {
          niche: nichoRec,
          objective: input.objetivo,
          format: grupo.formato,
          trend: t.nome,
          trendScore: t.score,
          momentum: {
            recorrencia,
            historicoDelta: vetor.mHistorico,
            crescimento: t.crescimento,
            seenCount: t.seen_count ?? 0,
          },
          evidence: {
            formatScore: grupo.score,
            trendScore: t.score,
            ciclo: t.ciclo,
            crescimento: t.crescimento,
            compat: t.compat,
            recente,
            recorrencia,
            comHistorico: grupo.comHistorico > 0,
            qualidadeGrupo: round(qualidadeGrupo * 100),
            qualidadeTendencia: round(
              (QUALIDADE_PESO[String(t.signal_quality ?? "")] ?? 0.35) * 100,
            ),
          },
          suggestedStructure: estrutura.map((s) => s.rotulo),
        },
      };

      candidatos.push({ r: rec, score: opp.score });
    }
  }

  // Estados honestos antes de rankear
  const totalSinalFraco = fraçãoSinaisFracos(analise);
  const temHistoricoReal = analise.results.some((g) => g.comHistorico > 0);
  if (totalSinalFraco > 0.85 && !temHistoricoReal) {
    return {
      estado: "insuficiente",
      motivo:
        "Não há sinais suficientes para recomendar o que postar hoje. As tendências atuais têm poucos sinais observados (baixa evidência) — rode novas varreduras para acumular dados.",
      confianca: null,
      recomendacoes: [],
      resumo: buildResumo(filtradas, analise),
    };
  }

  // Ranking (score desc) + DIVERSIDADE: máx. 2 por formato, tendência única.
  candidatos.sort(
    (a, b) => b.score - a.score || b.r.evidencia.trendScore - a.r.evidencia.trendScore,
  );
  const porFormato = new Map<string, number>();
  const usadas = new Set<string>();
  const escolhidas: InstaRecomendacao[] = [];
  for (const c of candidatos) {
    if (escolhidas.length >= 5) break;
    const keyT = c.r.tendencia.nome.toLowerCase();
    if (usadas.has(keyT)) continue;
    const cap = (porFormato.get(c.r.formato) ?? 0) + 1;
    if (cap > 2) continue;
    porFormato.set(c.r.formato, cap);
    usadas.add(keyT);
    escolhidas.push(c.r);
    if (escolhidas.length >= 5) break;
  }

  if (escolhidas.length < 3) {
    return {
      estado: "insuficiente",
      motivo:
        "Não há sinais suficientes para recomendar o que postar hoje. O Radar encontrou poucas oportunidades distintas — ajuste os filtros ou rode novas varreduras.",
      confianca: null,
      recomendacoes: [],
      resumo: buildResumo(filtradas, analise),
    };
  }

  escolhidas.forEach((r, i) => (r.rank = i + 1));

  // Confiança GLOBAL da análise (qualidade + quantidade dos sinais).
  const fracao = qualidadeGlobal(analise);
  let confNivel: InstaConfiancaNivel;
  let confScore: number;
  if (fracao >= 0.6 && temHistoricoReal) {
    confNivel = "alta";
    confScore = round(fracao * 100);
  } else if (fracao >= 0.35) {
    confNivel = "media";
    confScore = round(fracao * 100);
  } else {
    confNivel = "baixa";
    confScore = round(fracao * 100);
  }

  return {
    estado: "disponivel",
    motivo: "Recomendações geradas a partir dos sinais reais coletados pelo Radar.",
    confianca: { nivel: confNivel, score: confScore },
    recomendacoes: escolhidas,
    resumo: buildResumo(filtradas, analise),
  };
}

function fraçãoSinaisFracos(a: { results: InstaFormatoResult[]; total: number }): number {
  if (a.total <= 0) return 0;
  let fracos = 0;
  for (const r of a.results) {
    fracos +=
      (r.qualidade["baixa"] ?? 0) +
      (r.qualidade["insuficiente"] ?? 0) +
      // sinais sem classificação (null) contam como fracos — não há evidência
      Math.max(
        0,
        r.count -
          ((r.qualidade["alta"] ?? 0) +
            (r.qualidade["media"] ?? 0) +
            (r.qualidade["baixa"] ?? 0) +
            (r.qualidade["insuficiente"] ?? 0)),
      );
  }
  return fracos / a.total;
}

function qualidadeGlobal(a: { results: InstaFormatoResult[]; total: number }): number {
  if (a.total <= 0) return 0;
  let boas = 0;
  for (const r of a.results) {
    boas += (r.qualidade["media"] ?? 0) + (r.qualidade["alta"] ?? 0);
  }
  return boas / a.total;
}

function resumoVazio(): InstaRecomendacaoAnalise["resumo"] {
  return {
    totalTrends: 0,
    recentes: 0,
    recorrentes: 0,
    comHistorico: 0,
    qualidadeMediaAltaFracao: 0,
    formatos: 0,
  };
}

function buildResumo(
  trends: InstaTrend[],
  a: { results: InstaFormatoResult[]; total: number },
): InstaRecomendacaoAnalise["resumo"] {
  let recentes = 0;
  let recorrentes = 0;
  for (const t of trends) {
    const d = diasDesdePrimeiraVista(t);
    if (d != null && d <= 7) recentes++;
    if (t.seen_count != null && Number(t.seen_count) >= 2) recorrentes++;
  }

  let comHistorico = 0;
  for (const r of a.results) comHistorico += r.comHistorico;

  return {
    totalTrends: trends.length,
    recentes,
    recorrentes,
    comHistorico,
    qualidadeMediaAltaFracao: round(qualidadeGlobal(a) * 100) / 100,
    formatos: a.results.length,
  };
}
