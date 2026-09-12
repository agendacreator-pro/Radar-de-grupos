// ============================================================
// Radar do Algoritmo — Instagram
// Tipos e rótulos de apresentação do módulo.
// Todas as métricas são rotuladas por fonte: oficial (dado real
// da API), observado (sinal público da web), estimativa (inferido
// de sinais indiretos) ou inferencia (gerado por regras — MEELL).
// ============================================================

export type InstaCiclo = "surgindo" | "crescendo" | "auge" | "saturando" | "caindo";

export type InstaCategoria =
  | "reels"
  | "trend"
  | "audio"
  | "formato"
  | "tema"
  | "gancho"
  | "viral"
  | "emergente"
  | "saturada"
  | "vendas";

export type InstaFonte = "oficial" | "observado" | "estimativa" | "inferencia";

// ── Qualidade da base (etapa "qualidade dos sinais") ──

/**
 * Grau de certeza do vínculo tendência ↔ nicho (keyword do usuário).
 * - high   → a keyword aparece no TÍTULO observado (evidência mais forte)
 * - medium → a keyword aparece no snippet/motivo observado
 * - low    → só uma palavra de uma keyword composta apareceu (parcial)
 * - unknown → nenhuma keyword foi encontrada no texto observado
 */
export type InstaNicheConfidence = "high" | "medium" | "low" | "unknown";

/** Qualidade dos sinais reais disponíveis para uma tendência. */
export type InstaSignalQuality = "alta" | "media" | "baixa" | "insuficiente";

/** Origem de ONDE veio o dado (coleta), distinto de `fonte` (legitimidade da métrica). */
export type InstaTrendSource = "web_search" | "engine" | "manual" | "other" | "unknown";

/** Formato já normalizado: base canônica + variação (subformato). */
export type InstaFormatoNormalizado = {
  formato: string | null;
  subformato: string | null;
  raw: string | null;
};

export const INSTA_NICHE_CONFIDENCE_LABELS: Record<InstaNicheConfidence, string> = {
  high: "No título",
  medium: "Nos sinais",
  low: "Parcial",
  unknown: "Não identificado",
};

export const INSTA_NICHE_CONFIDENCE_CLASSES: Record<InstaNicheConfidence, string> = {
  high: "border-emerald-300 bg-emerald-50 text-emerald-700",
  medium: "border-sky-300 bg-sky-50 text-sky-700",
  low: "border-slate-300 bg-slate-100 text-slate-600",
  unknown: "border-slate-300 bg-slate-100 text-slate-500",
};

export const INSTA_SIGNAL_QUALITY_LABELS: Record<InstaSignalQuality, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
  insuficiente: "Insuficiente",
};

export const INSTA_SIGNAL_QUALITY_CLASSES: Record<InstaSignalQuality, string> = {
  alta: "border-emerald-300 bg-emerald-50 text-emerald-700",
  media: "border-amber-300 bg-amber-50 text-amber-800",
  baixa: "border-orange-300 bg-orange-50 text-orange-800",
  insuficiente: "border-slate-300 bg-slate-100 text-slate-500",
};

export const INSTA_TREND_SOURCE_LABELS: Record<InstaTrendSource, string> = {
  web_search: "Busca pública (web)",
  engine: "Derivado pelo Radar",
  manual: "Adicionado manualmente",
  other: "Outra origem",
  unknown: "Origem não identificada",
};

export const INSTA_CICLO_LABELS: Record<InstaCiclo, string> = {
  surgindo: "🆕 Surgindo",
  crescendo: "📈 Crescendo",
  auge: "🔥 No auge",
  saturando: "⚠️ Saturando",
  caindo: "📉 Perdendo força",
};

export const INSTA_CICLO_CLASSES: Record<InstaCiclo, string> = {
  surgindo: "border-cyan-300 bg-cyan-50 text-cyan-700",
  crescendo: "border-green-300 bg-green-50 text-green-700",
  auge: "border-amber-300 bg-amber-50 text-amber-800",
  saturando: "border-orange-300 bg-orange-50 text-orange-800",
  caindo: "border-red-300 bg-red-50 text-red-700",
};

export const INSTA_CICLO_SCORE_COLOR: Record<InstaCiclo, string> = {
  surgindo: "bg-cyan-400",
  crescendo: "bg-green-400",
  auge: "bg-amber-400",
  saturando: "bg-orange-400",
  caindo: "bg-red-400",
};

export const INSTA_CICLO_ORDER: InstaCiclo[] = [
  "surgindo",
  "crescendo",
  "auge",
  "saturando",
  "caindo",
];

export const INSTA_CATEGORIA_LABELS: Record<InstaCategoria, string> = {
  reels: "Reels",
  trend: "Trend",
  audio: "Áudio",
  formato: "Formato",
  tema: "Tema",
  gancho: "Gancho",
  viral: "Viral",
  emergente: "Emergente",
  saturada: "Saturada",
  vendas: "Vendas",
};

export const INSTA_FONTE_LABELS: Record<InstaFonte, string> = {
  oficial: "Dado oficial",
  observado: "Dado observado",
  estimativa: "Estimativa",
  inferencia: "Inferência da IA",
};

export const INSTA_FONTE_CLASSES: Record<InstaFonte, string> = {
  oficial: "border-blue-300 bg-blue-50 text-blue-700",
  observado: "border-teal-300 bg-teal-50 text-teal-700",
  estimativa: "border-violet-300 bg-violet-50 text-violet-700",
  inferencia: "border-slate-300 bg-slate-100 text-slate-600",
};

export type InstaTrend = {
  id: string;
  nome: string;
  categoria: InstaCategoria;
  ciclo: InstaCiclo;
  score: number;
  compat: number;
  crescimento: number;
  motivo: string | null;
  adaptacao: string | null;
  formato: string | null;
  fonte: InstaFonte;
  fonte_detalhe: string | null;
  url: string | null;
  coletado_em: string;
  // ── Qualidade da base (etapa atual) ──
  /** Variação do formato (ex.: "Áudio" dentro de "Reels"). */
  subformato?: string | null;
  /** Keyword do nicho que o texto observado melhor confirma (resolvida na coleta). */
  niche?: string | null;
  niche_confidence?: InstaNicheConfidence | null;
  /** Onde o dado foi obtido (busca pública web / derivado pelo Radar). */
  source?: InstaTrendSource | null;
  /** Qualidade dos sinais reais disponíveis. */
  signal_quality?: InstaSignalQuality | null;
  /** Primeiro instante em que o Radar viu a tendência (nunca sobrescrito). */
  first_seen_at?: string | null;
  /** Último instante em que o Radar viu a tendência. */
  last_seen_at?: string | null;
  seen_count?: number | null;
  created_at?: string | null;
};

export type InstaAudioStatus = "viral" | "crescendo" | "nova" | "consolidada" | "perdendo";

export const INSTA_AUDIO_STATUS_LABELS: Record<InstaAudioStatus, string> = {
  viral: "🔥 Viral",
  crescendo: "📈 Crescendo",
  nova: "🆕 Nova tendência",
  consolidada: "⭐ Consolidada",
  perdendo: "📉 Perdendo força",
};

export const INSTA_AUDIO_STATUS_CLASSES: Record<InstaAudioStatus, string> = {
  viral: "border-red-300 bg-red-50 text-red-700",
  crescendo: "border-green-300 bg-green-50 text-green-700",
  nova: "border-cyan-300 bg-cyan-50 text-cyan-700",
  consolidada: "border-amber-300 bg-amber-50 text-amber-800",
  perdendo: "border-slate-300 bg-slate-100 text-slate-600",
};

export function formatTrendChange(change: number | null | undefined, sig?: "▲" | "▼"): string {
  if (change == null) return "—";
  const n = Math.round(change);
  const arrow = sig ?? (n > 0 ? "▲" : n < 0 ? "▼" : "➡");
  if (n === 0) return "➡ 0";
  return `${arrow} ${Math.abs(n)}`;
}

export type InstaAudio = {
  id: string;
  nome: string;
  artista: string | null;
  genero?: string | null;
  usos: number | null;
  crescimento: number;
  ciclo: InstaCiclo;
  score: number;
  compat: number;
  motivo: string | null;
  fonte: InstaFonte;
  fonte_detalhe: string | null;
  url: string | null;
  coletado_em: string;
  preview_url?: string | null;
  artwork_url?: string | null;
  itunes_url?: string | null;
  track_name?: string | null;
  artist_name?: string | null;
  album?: string | null;
  provider_id?: string | null;
  track_url?: string | null;
  enrich_attempted_at?: string | null;
  provider?: string | null;
  trend_status?: InstaAudioStatus | null;
  rank?: number | null;
  previous_rank?: number | null;
  rank_change?: number | null;
  score_delta?: number | null;
  growth_rate?: number | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  seen_count?: number | null;
};

export type InstaAlertTipo =
  "nova_trend" | "audio_alta" | "nicho_alta" | "saturacao" | "oportunidade" | "formato";

export type InstaAlert = {
  id: string;
  tipo: InstaAlertTipo;
  titulo: string;
  descricao: string | null;
  lido: boolean;
  criado_em: string;
};

export const INSTA_ALERT_TIPO_LABELS: Record<InstaAlertTipo, string> = {
  nova_trend: "🆕 Nova tendência",
  audio_alta: "🎵 Áudio em alta",
  nicho_alta: "🎯 Trending do nicho",
  saturacao: "⚠️ Saturação",
  oportunidade: "🚀 Oportunidade",
  formato: "📹 Formato em alta",
};

export type InstaPlan = {
  id: string;
  dia: string;
  formato: string;
  trend: string | null;
  audio: string | null;
  ideia: string;
  gancho: string | null;
  objetivo: string | null;
  criado_em: string;
};

export const INSTA_DIAS = [
  { key: "seg", label: "Seg" },
  { key: "ter", label: "Ter" },
  { key: "qua", label: "Qua" },
  { key: "qui", label: "Qui" },
  { key: "sex", label: "Sex" },
  { key: "sab", label: "Sáb" },
  { key: "dom", label: "Dom" },
];

export type InstaConfig = {
  keywords: string[];
  disabled: boolean;
  status: "aguardando" | "ok" | "rodando" | "erro";
  last_error: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  alert_count: number;
  auto_update: boolean;
};

export type InstaAudioSnapshot = {
  key: string;
  nome: string;
  artista: string | null;
  score: number;
  usos: number | null;
  crescimento: number;
  rank: number;
};

/**
 * Snapshot histórico de UMA tendência, gravado a cada execução para que
 * análises futuras possam comparar entre coletas sem inventar variação.
 * `coletado_em`/`first_seen_at`/`last_seen_at` são timestamps REAIS.
 */
export type InstaTrendSnapshot = {
  key: string;
  nome: string;
  categoria: InstaCategoria;
  ciclo: InstaCiclo;
  score: number;
  compat: number;
  crescimento: number;
  formato: string | null;
  subformato: string | null;
  nicho: string | null;
  nichoConfidence: InstaNicheConfidence | null;
  source: InstaTrendSource | null;
  signalQuality: InstaSignalQuality | null;
  coletadoEm: string;
  primeiraColetaEm: string;
  ultimaColetaEm: string;
};

export type InstaHistory = {
  id: string;
  resumo: {
    top?: { nome: string; score: number }[];
    por_ciclo?: Partial<Record<InstaCiclo, number>>;
    total?: number;
    novo?: number;
    audio_count?: number;
    alertas?: number;
    fonte?: string;
    duracao?: number;
    audios?: InstaAudioSnapshot[];
    trends?: InstaTrendSnapshot[];
  };
  criado_em: string;
};

export type InstaContent = {
  sugestao: string;
  trend: string | null;
  trend_url: string | null;
  trend_ciclo: string | null;
  audio: string | null;
  formato: string;
  gancho: string;
  ideia: string;
  texto_tela: string;
  roteiro: string[];
  legenda: string;
  cta: string;
  hashtags: string[];
  capa: string;
  objetivo: string;
  score: number;
  fonte: "inferencia";
  motivo: string | null;
  horarios?: string[];
};

export type InstaAudioPost = {
  sugestao: string;
  nome: string;
  artista: string | null;
  nome_reels: string;
  preview_url: string | null;
  artwork_url: string | null;
  itunes_url: string | null;
  score: number;
  compat: number;
  ciclo: InstaCiclo;
  fonte: InstaFonte;
  fonte_detalhe: string | null;
  content: InstaContent;
};

export type InstaDashboard = {
  config: InstaConfig;
  trends: InstaTrend[];
  audios: InstaAudio[];
  alerts: InstaAlert[];
  plans: InstaPlan[];
  history: InstaHistory[];
  conexao: { conectado: boolean; label: string | null; instrucao: string | null }[];
  stats: {
    total_trends: number;
    na_auge: number;
    nicho_alta: number;
    audio_em_alta: number;
    audio_subindo: number;
    alertas_nao_lidos: number;
    oport_hoje: number;
  };
  auto_run_hint: string;
};

export const INSTA_DEFAULT_KEYWORDS = [
  "planilhas",
  "produtos digitais",
  "empreendedorismo",
  "automação",
  "agendas",
  "papelaria criativa",
];

export const INSTA_GANCHOS = [
  {
    id: "erro",
    nome: "Mostrar um erro comum",
    exemplo: "O erro que quase arruina seu feed (e como evitar)",
  },
  {
    id: "antes_depois",
    nome: "Antes e depois",
    exemplo: "Veja o retorno que essa estratégia gerou",
  },
  { id: "lista", nome: "Lista rápida", exemplo: "3 sinais de que a trend ainda vale a pena" },
  {
    id: "pergunta",
    nome: "Pergunta",
    exemplo: "Você ainda não postou sobre isso? Então veja isto",
  },
  {
    id: "mistério",
    nome: "Mistério/enrolation",
    exemplo: "Ninguém te contou isso sobre essa trend",
  },
  { id: "polêmica", nome: "Frase polêmica", exemplo: "Todo mundo posta isso errado" },
  { id: "tutorial", nome: "Passo a passo", exemplo: "Como adaptar essa trend para {tema}" },
  { id: "contagem", nome: "Contagem regressiva", exemplo: "3, 2, 1… a hora de postar" },
];

export const INSTA_FORMATS = ["Reels", "Carrossel", "Stories", "Feed + Reels", "Colab"];

export function scoreLabel(score: number): string {
  if (score >= 80) return "🔥 Quente";
  if (score >= 60) return "🚀 Promissor";
  if (score >= 40) return "📊 Estável";
  if (score >= 20) return "🧊 Morno";
  return "☠️ Frio";
}

export function scoreBarClass(score: number): string {
  if (score >= 80) return "bg-amber-500";
  if (score >= 60) return "bg-emerald-500";
  if (score >= 40) return "bg-sky-500";
  if (score >= 20) return "bg-slate-400";
  return "bg-rose-400";
}

export function formatHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function scoreToCiclo(score: number): InstaCiclo {
  if (score >= 85) return "auge";
  if (score >= 60) return "crescendo";
  if (score >= 40) return "surgindo";
  if (score >= 20) return "saturando";
  return "caindo";
}
