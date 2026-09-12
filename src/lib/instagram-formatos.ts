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

import {
  INSTA_FORMATS,
  type InstaTrend,
  type InstaSignalQuality,
  type InstaNicheConfidence,
} from "@/lib/instagram-radar";
import {
  calculateSignalQuality,
  normalizeTrendFormat,
  normPhrase,
  resolveTrendNiche,
} from "@/lib/instagram-quality";

export type InstaFormatoPeriodo = "todos" | "24h" | "7d" | "30d";

export const INSTA_FORMATO_PERIODOS: { key: InstaFormatoPeriodo; label: string }[] = [
  { key: "todos", label: "Todo o período" },
  { key: "24h", label: "Surgidas nas últimas 24 h" },
  { key: "7d", label: "Surgidas nos últimos 7 dias" },
  { key: "30d", label: "Surgidas nos últimos 30 dias" },
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

/** Resultado agregado de UM formato (as tendências cujo formato NORMALIZADO é X). */
export type InstaFormatoResult = {
  /** Nome canônico do formato (ex.: "Reels"). "Reels (áudio)" entra no grupo "Reels". */
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
  // ── Qualidade da base ──
  /** Frequência dos subformatos dentro do formato (ex.: Áudio 3 · sem variação 13). */
  subformatos: { subformato: string | null; count: number }[];
  /** Subformato mais frequente (null se não houver variação). */
  subformatoDominante: string | null;
  /** Tendências do grupo por qualidade de sinal. */
  qualidade: Partial<Record<InstaSignalQuality, number>>;
  /** Primeiro instante de coleta entre as tendências do grupo (first_seen). */
  dataInicio: string | null;
  /** Último instante de coleta entre as tendências do grupo (last_seen). */
  dataFim: string | null;
  /** Tendências com histórico REAL entre execuções (last_seen ≠ first_seen). */
  comHistorico: number;
  /** Tendências com nicho resolvido (não "unknown"). */
  nichoResolvido: number;
};

export type InstaFormatoAnalise = {
  /** false se houver poucas tendências para um ranking/insight confiável. */
  suficiente: boolean;
  total: number;
  results: InstaFormatoResult[];
  insights: string[];
  /** true quando os sinais observados são poucos — os números são estimativas pontuais. */
  dadosLimitados: boolean;
  /** true quando nenhum formato tem histórico entre execuções — crescimento não é medido no tempo. */
  semHistorico: boolean;
};

const DIAS_MS = 86_400_000;

/**
 * Nicho EFETIVO de uma tendência: prefere o nicho resolvido na COLEÇÃO
 * (campo `niche` + `niche_confidence` — usa título + snippet, evidência
 * mais forte); para linhas antigas sem nicho gravado, re-resolve agora
 * usando apenas o texto observado (nome + motivo). Nunca usa `adaptacao`.
 */
export function trendNichoEfetivo(
  t: InstaTrend,
  keywords: string[],
): { niche: string | null; confidence: InstaNicheConfidence } {
  if (t.niche && t.niche_confidence && t.niche_confidence !== "unknown")
    return { niche: t.niche, confidence: t.niche_confidence };
  return resolveTrendNiche({ nome: t.nome, motivo: t.motivo }, keywords ?? []);
}

/**
 * Uma tendência pertence a uma keyword quando:
 *   - seu nicho GRAVADO na coleta é essa keyword (evidência forte do título/
 *     snippet observados), ou
 *   - (linhas antigas) a keyword aparecer como palavra inteira no texto
 *     observado nome + motivo.
 *
 * Espelha o mesmo critério que o Radar usa em computeCompat — é o único
 * vínculo tendência↔nicho que os dados expõem. IMPORTANTE: NÃO inclui
 * `adaptacao` (texto gerado que repete as 2 primeiras keywords em toda
 * linha — tornaria o filtro artificial).
 */
export function trendMencionaNicho(t: InstaTrend, keyword: string): boolean {
  const target = normPhrase(keyword);
  if (!target) return false;
  if (t.niche && t.niche_confidence && t.niche_confidence !== "unknown")
    return normPhrase(t.niche) === target;
  const r = resolveTrendNiche({ nome: t.nome, motivo: t.motivo }, [keyword]);
  return r.niche !== null && r.confidence !== "unknown";
}

/**
 * Filtro por período usando o instante em que a tendência SURGIU no radar
 * (first_seen_at, que nunca é sobrescrito). Para linhas antigas sem
 * first_seen_at, cai em created_at (real) e só então em coletado_em.
 *
 * Isso corrige a janela que antes usava coletado_em — campo que o upsert
 * reescrevia a cada execução, fazendo TUDAS as tendências parecerem
 * "das últimas 24h". Honesto: é uma janela sobre a coleta do Radar, não
 * sobre métricas oficiais do Instagram.
 */
export function trendEmPeriodo(t: InstaTrend, periodo: InstaFormatoPeriodo): boolean {
  if (periodo === "todos") return true;
  const ref = t.first_seen_at ?? t.created_at ?? t.coletado_em;
  const d = new Date(ref);
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
 * Agrupa as tendências existentes pelo formato NORMALIZADO (base canônica):
 * "Reels (áudio)" e "Reels" caem no mesmo grupo "Reels" — o subformato fica
 * na coluna separada. Somente formatos QUE EXISTEM nos dados viram grupos —
 * nada é criado ou preenchido com valor fixo. Tendências sem formato (null)
 * são ignoradas (o card de tendência já informa "formato não identificado").
 */
export function groupTrendsByFormato(trends: InstaTrend[]): Map<string, InstaTrend[]> {
  const groups = new Map<string, InstaTrend[]>();
  for (const t of trends) {
    const { formato } = normalizeTrendFormat(t.formato);
    if (!formato) continue;
    const list = groups.get(formato) ?? [];
    list.push(t);
    groups.set(formato, list);
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
 * Qualidade de sinal de uma tendência: usa o valor resolvido na coleta
 * (`signal_quality`); para linhas antigas, mede de novo com os campos que
 * existem (link observado, texto, fonte). Nunca inventa sinal.
 */
export function signalQualityOf(t: InstaTrend): InstaSignalQuality {
  return (
    t.signal_quality ??
    calculateSignalQuality({
      url: t.url,
      fonte: t.fonte,
      text: `${t.nome} ${t.motivo ?? ""}`,
    })
  );
}

/**
 * Analisa as tendências e devolve o ranking de formatos + insights.
 * Consome APENAS os dados já coletados (sem buscas novas, sem chamadas duplicadas).
 * `keywords` serve para medir nicho resolvido de linhas antigas (opcional).
 */
export function analyzeFormatos(trends: InstaTrend[], keywords?: string[]): InstaFormatoAnalise {
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

    // Qualidade da base
    const subformatos = new Map<string | null, number>();
    let comHistorico = 0;
    let nichoResolvido = 0;
    let dataInicio: string | null = null;
    let dataFim: string | null = null;
    const qualidade: Partial<Record<InstaSignalQuality, number>> = {};

    for (const item of items) {
      const { subformato } = normalizeTrendFormat(item.formato);
      const key = subformato ?? null;
      subformatos.set(key, (subformatos.get(key) ?? 0) + 1);

      const fe = item.first_seen_at ?? item.created_at ?? item.coletado_em;
      const le = item.last_seen_at ?? item.coletado_em;
      if (fe && (!dataInicio || fe < dataInicio)) dataInicio = fe;
      if (le && (!dataFim || le > dataFim)) dataFim = le;
      const feAbs = fe ? new Date(fe).getTime() : null;
      const leAbs = le ? new Date(le).getTime() : null;
      if (feAbs != null && leAbs != null && leAbs !== feAbs) comHistorico++;

      const nichoE = trendNichoEfetivo(item, keywords ?? []);
      if (nichoE.niche && nichoE.confidence !== "unknown") nichoResolvido++;

      const q = signalQualityOf(item);
      qualidade[q] = (qualidade[q] ?? 0) + 1;
    }

    const subformatosSorted = [...subformatos.entries()]
      .map(([subformato, c]) => ({ subformato, count: c }))
      .sort((a, b) => b.count - a.count);

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
      subformatos: subformatosSorted,
      subformatoDominante: subformatosSorted[0]?.subformato ?? null,
      qualidade,
      dataInicio,
      dataFim,
      comHistorico,
      nichoResolvido,
    });
  }

  resultados.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ci = indexCanonico(a.formato) - indexCanonico(b.formato);
    if (ci !== 0) return ci;
    return b.count - a.count;
  });
  resultados.forEach((r, i) => (r.rank = i + 1));

  const dadosLimitados = !suficiente || fracaoSinaisFracos(resultados, total) > 0.5;
  const semHistorico =
    total > 0 && resultados.length > 0 && resultados.every((r) => r.comHistorico === 0);

  return {
    suficiente,
    total,
    results: resultados,
    insights: buildFormatoInsights(resultados, suficiente, total, dadosLimitados, semHistorico),
    dadosLimitados,
    semHistorico,
  };
}

/**
 * Fração (0-1) de tendências com qualidade de sinal baixa/insuficiente
 * (pouca evidência observada) em relação ao total analisado.
 */
function fracaoSinaisFracos(results: InstaFormatoResult[], total: number): number {
  if (total <= 0) return 0;
  let fracos = 0;
  for (const r of results) {
    fracos += (r.qualidade["baixa"] ?? 0) + (r.qualidade["insuficiente"] ?? 0);
  }
  return fracos / total;
}

/**
 * Insight automático GERADO a partir dos dados do ranking. Regras (todas
 * dependem de números reais — nenhuma frase fixa sobre "estar em alta" sem
 * que os dados sustentem):
 *   - sem dados suficientes → frase de aviso padrão
 *   - formato com maior concentração → sua fração do total
 *   - formato com maior proporção de auge/crescendo (com 2+ tendências) → %
 *   - líder do Format Score → pontuação
 *   - dados limitados (pouca evidência observada) → aviso honesto
 *   - sem histórico entre execuções → aviso de que crescimento é pontual
 */
function buildFormatoInsights(
  results: InstaFormatoResult[],
  suficiente: boolean,
  total: number,
  dadosLimitados: boolean,
  semHistorico: boolean,
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

  if (dadosLimitados) {
    lines.push(
      "Esta base tem poucos sinais observados por tendência — os números acima são estimativas pontuais do Radar, não métricas oficiais do Instagram.",
    );
  }

  if (semHistorico) {
    lines.push(
      "Ainda não há histórico entre execuções do Radar para medir crescimento real por formato — o 'crescimento' aparece como estimativa pontual.",
    );
  }

  return lines;
}
