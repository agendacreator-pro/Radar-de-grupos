// ============================================================
// Radar do Algoritmo — Instagram — "Formatos em Alta"
//
// Camada de ANÁLISE sobre os dados de tendências que o Radar já
// coletou (insta_radar_trends, via busca pública). Não faz novas
// buscas, não inventa métricas e não altera a coleta.
//
// Reutiliza as constantes e tipos existentes:
//   - InstaTrend (score, ciclo, crescimento, compat, formato,
//     motivo, coletado_em…) de instagram-radar.ts
//   - INSTA_FORMATS (ordem canônica conhecida dos formatos)
//
// Transparência: nenhum número aqui é dado oficial do Instagram.
// Tudo deriva dos sinais que o Radar registrou para cada tendência
// (score/ciclo/crescimento são estimativas do próprio Radar).
// ============================================================

import { INSTA_FORMATS, type InstaTrend } from "@/lib/instagram-radar";

export type InstaFormatoPeriodo = "todos" | "24h" | "7d" | "30d";

export const INSTA_FORMATO_PERIODOS: { key: InstaFormatoPeriodo; label: string }[] = [
  { key: "todos", label: "Todo o período" },
  { key: "24h", label: "Últimas 24 horas" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
];

export type InstaFormatoStatus = "alta" | "crescendo" | "estavel" | "perdendo";

export const INSTA_FORMATO_STATUS_LABELS: Record<InstaFormatoStatus, string> = {
  alta: "🔥 Em alta",
  crescendo: "📈 Crescendo",
  estavel: "➡️ Estável",
  perdendo: "📉 Perdendo força",
};

export const INSTA_FORMATO_STATUS_CLASSES: Record<InstaFormatoStatus, string> = {
  alta: "border-amber-300 bg-amber-50 text-amber-800",
  crescendo: "border-green-300 bg-green-50 text-green-700",
  estavel: "border-slate-300 bg-slate-100 text-slate-600",
  perdendo: "border-red-300 bg-red-50 text-red-700",
};

/** Resultado agregado de UM formato (um grupo de tendências com trends.formato = X). */
export type InstaFormatoResult = {
  /** Nome exato do formato como está gravado nas tendências (ex.: "Reels"). */
  formato: string;
  /** Posição no ranking (1 = maior Format Score). */
  rank: number;
  /** Tendências que compõem o formato (já filtradas por nicho/período na chamada). */
  trends: InstaTrend[];
  count: number;
  countAuge: number;
  countCrescendo: number;
  countEmAlta: number;
  countCaindo: number;
  /** Média do score das tendências do formato (0-100). */
  scoreMedio: number;
  /** Média do sinal de crescimento registrado (0-100, já clampado pelo Radar). */
  crescimentoMedio: number;
  /** Média da compatibilidade com o nicho (0-100). */
  compatMedio: number;
  /** Fração (0-1) de tendências em auge/crescendo dentro do formato. */
  shareEmAlta: number;
  /** Format Trend Score (0-100) — combinação ponderada dos sinais acima. */
  score: number;
  status: InstaFormatoStatus;
  /** Top 3 tendências por score (para os "principais sinais"). */
  top: InstaTrend[];
};

export type InstaFormatoAnalise = {
  /** false se houver poucas tendências para um ranking/insight confiável. */
  suficiente: boolean;
  total: number;
  results: InstaFormatoResult[];
  insights: string[];
};

const DIAS_MS = 86_400_000;

/**
 * Filtro por nicho: mantém apenas tendências cujo texto OBSERVADO (nome +
 * motivo: sinais reais que o Radar registrou) menciona a palavra-chave.
 * Espelha o mesmo critério que o Radar usa em computeCompat — é o único
 * vínculo tendência↔nicho que os dados expõem (as tendências não gravam qual
 * keyword acertou).
 *
 * IMPORTANTE: NÃO inclui `adaptacao` no texto de busca. `adaptacao` é texto
 * gerado pelo engine que repete automaticamente as 2 primeiras keywords —
 * incluí-lo tornaria o filtro artificial (quase tudo bateria). Aqui só vale
 * o que foi realmente observado na coleta.
 */
export function trendMencionaNicho(t: InstaTrend, keyword: string): boolean {
  const k = keyword.toLowerCase();
  return ` ${t.nome} ${t.motivo ?? ""} `.toLowerCase().includes(k);
}

/**
 * Filtro por período usando o instante em que a tendência foi coletada
 * (coletado_em, que corresponde à data de publicação observada ou à data da
 * coleta). Honesto: é uma janela sobre a coleta do Radar, não sobre métricas
 * oficiais do Instagram.
 */
export function trendEmPeriodo(t: InstaTrend, periodo: InstaFormatoPeriodo): boolean {
  if (periodo === "todos") return true;
  const d = new Date(t.coletado_em);
  if (Number.isNaN(d.getTime())) return false;
  const days = (Date.now() - d.getTime()) / DIAS_MS;
  if (periodo === "24h") return days <= 1;
  if (periodo === "7d") return days <= 7;
  return days <= 30;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * Agrupa as tendências existentes por trends.formato.
 * Somente os formatos QUE EXISTEM nos dados viram grupos — nada é criado
 * ou preenchido com valor fixo. Tendências sem formato (null) são ignoradas
 * (o card de tendência já informa "formato não identificado").
 */
export function groupTrendsByFormato(trends: InstaTrend[]): Map<string, InstaTrend[]> {
  const groups = new Map<string, InstaTrend[]>();
  for (const t of trends) {
    if (!t.formato) continue;
    groups.set(t.formato, [...(groups.get(t.formato) ?? []), t]);
  }
  return groups;
}

function indexCanonico(formato: string): number {
  const i = INSTA_FORMATS.findIndex((f) => f.toLowerCase() === formato.toLowerCase());
  return i === -1 ? INSTA_FORMATS.length : i;
}

/**
 * Format Trend Score (0-100).
 *
 * Combinação ponderada dos sinais QUE JÁ EXISTEM por grupo de tendências —
 * nenhuma métrica nova é inventada:
 *
 *   formatScore = round(
 *       scoreMedio        * 0.45   // força média das tendências do formato
 *     + shareEmAlta*100   * 0.25   // % de tendências em auge/crescendo no grupo
 *     + crescimentoMedio  * 0.15   // sinal médio de crescimento registrado
 *     + compatMedio       * 0.15   // relevância média para o nicho
 *   )  → clampado em 0-100
 */
export function computeFormatoScore(
  scoreMedio: number,
  shareEmAlta: number,
  crescimentoMedio: number,
  compatMedio: number,
): number {
  const v =
    scoreMedio * 0.45 + shareEmAlta * 100 * 0.25 + crescimentoMedio * 0.15 + compatMedio * 0.15;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Status do formato, derivado apenas dos ciclos reais das suas tendências.
 *
 *   shareEmAlta  = (auge + crescendo) / count
 *   shareCaindo  = (caindo + saturando) / count
 *   shareEmAlta >= 0.65            → alta
 *   shareEmAlta >= 0.40            → crescendo
 *   shareCaindo >= 0.50            → perdendo
 *   senão                         → estavel
 */
export function deriveFormatoStatus(shareEmAlta: number, shareCaindo: number): InstaFormatoStatus {
  if (shareEmAlta >= 0.65) return "alta";
  if (shareEmAlta >= 0.4) return "crescendo";
  if (shareCaindo >= 0.5) return "perdendo";
  return "estavel";
}

/**
 * Analisa as tendências e devolve o ranking de formatos + insights.
 * Consome APENAS os dados já coletados (sem buscas novas, sem chamadas duplicadas).
 */
export function analyzeFormatos(trends: InstaTrend[]): InstaFormatoAnalise {
  const total = trends.length;
  // Suficiente: precisa de tendências de verdade em mais de um formato.
  const suficiente = total >= 5;

  const groups = groupTrendsByFormato(trends);
  const resultados: InstaFormatoResult[] = [];

  for (const [formato, items] of groups.entries()) {
    const count = items.length;
    const countAuge = items.filter((t) => t.ciclo === "auge").length;
    const countCrescendo = items.filter((t) => t.ciclo === "crescendo").length;
    const countCaindo = items.filter((t) => t.ciclo === "caindo").length;
    const countEmAlta = countAuge + countCrescendo;
    const scoreMedio = avg(items.map((t) => t.score));
    const crescimentoMedio = avg(items.map((t) => t.crescimento));
    const compatMedio = avg(items.map((t) => t.compat));
    const shareEmAlta = count === 0 ? 0 : countEmAlta / count;
    const shareCaindo = count === 0 ? 0 : countCaindo / count;
    const score = computeFormatoScore(scoreMedio, shareEmAlta, crescimentoMedio, compatMedio);

    resultados.push({
      formato,
      rank: 0,
      trends: [...items].sort((a, b) => b.score - a.score),
      count,
      countAuge,
      countCrescendo,
      countEmAlta,
      countCaindo,
      scoreMedio,
      crescimentoMedio,
      compatMedio,
      shareEmAlta,
      score,
      status: deriveFormatoStatus(shareEmAlta, shareCaindo),
      top: [...items].sort((a, b) => b.score - a.score).slice(0, 3),
    });
  }

  resultados.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ci = indexCanonico(a.formato) - indexCanonico(b.formato);
    if (ci !== 0) return ci;
    return b.count - a.count;
  });
  resultados.forEach((r, i) => (r.rank = i + 1));

  return {
    suficiente,
    total,
    results: resultados,
    insights: buildFormatoInsights(resultados, suficiente, total),
  };
}

/**
 * Insight automático GERADO a partir dos dados do ranking. Regras (todas
 * dependem de números reais — nenhuma frase fixa sobre "estar em alta" sem
 * que os dados sustentem):
 *   - sem dados suficientes → frase de aviso padrão
 *   - formato com maior concentração → sua fração do total
 *   - formato com maior proporção de auge/crescendo (com 2+ tendências) → %
 *   - líder do Format Score → pontuação
 */
function buildFormatoInsights(
  results: InstaFormatoResult[],
  suficiente: boolean,
  total: number,
): string[] {
  if (!suficiente || results.length < 1) {
    return ["Não há dados suficientes para gerar um insight confiável."];
  }

  const lines: string[] = [];

  const primeiro = results[0]!;
  let maisConcentrado = primeiro;
  for (const r of results) {
    if (r.count > maisConcentrado.count) maisConcentrado = r;
  }
  if (total > 0) {
    const pct = Math.round((maisConcentrado.count / total) * 100);
    lines.push(
      `${maisConcentrado.formato} aparece com a maior concentração de tendências: ${maisConcentrado.count} de ${total} (${pct}%) neste período.`,
    );
  }

  let maisEmAlta: InstaFormatoResult | null = null;
  for (const r of results) {
    if (r.count < 2) continue;
    if (!maisEmAlta || r.shareEmAlta > maisEmAlta.shareEmAlta) maisEmAlta = r;
  }
  if (maisEmAlta && maisEmAlta.shareEmAlta >= 0.6) {
    lines.push(
      `${maisEmAlta.formato} está com ${Math.round(maisEmAlta.shareEmAlta * 100)}% das tendências em auge/crescendo — o sinal mais forte de movimento no período.`,
    );
  }

  const lider = results[0]!;
  if (lines.length === 1 && lider.count >= 2) {
    lines.push(
      `${lider.formato} lidera o Format Score (${lider.score}) entre ${results.length} formatos analisados.`,
    );
  }

  return lines;
}
