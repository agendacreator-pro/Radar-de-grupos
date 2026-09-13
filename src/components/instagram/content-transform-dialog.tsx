import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, Save, Sparkles, Wand2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  INSTA_CICLO_CLASSES,
  INSTA_CICLO_LABELS,
  INSTA_FORMATS,
  INSTA_NICHE_CONFIDENCE_LABELS,
  INSTA_SIGNAL_QUALITY_CLASSES,
  INSTA_SIGNAL_QUALITY_LABELS,
  type InstaTrend,
} from "@/lib/instagram-radar";
import { INSTA_OBJETIVOS, type InstaObjetivo } from "@/lib/instagram-recommend";
import {
  INSTA_BLUEPRINT_TRANSPARENCIA,
  buildContentBlueprint,
  prepareBlueprintPayload,
  type ContentBlueprint,
} from "@/lib/instagram-content";
import { normalizeTrendFormat, normPhrase } from "@/lib/instagram-quality";
import { trendNichoEfetivo } from "@/lib/instagram-formatos";
import { AiContentGeneratorDialog } from "@/components/instagram/ai-content-generator-dialog";

// ------------------------------------------------------------
// "✨ Transformar tendência em conteúdo" — painel de blueprint
// ------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function EvidenciaLinha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-1 last:border-0">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <span className="text-right text-xs font-medium text-foreground">{valor}</span>
    </div>
  );
}

export function ContentTransformDialog({
  open,
  trend,
  keywords,
  onOpenChange,
  onSalvarIdeia,
}: {
  open: boolean;
  trend: InstaTrend | null;
  keywords: string[];
  onOpenChange: (open: boolean) => void;
  onSalvarIdeia: (b: ContentBlueprint) => void;
}) {
  const [objective, setObjective] = useState<InstaObjetivo>("engajamento");
  const [nicheChoice, setNicheChoice] = useState<string | null>(null);
  const [formatSel, setFormatSel] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  // Reseta o painel a cada tendência selecionada (objeto completo preservado).
  useEffect(() => {
    if (trend) {
      setObjective("engajamento");
      setNicheChoice(null);
      setFormatSel(null);
      setAiOpen(false);
    }
  }, [trend]);

  const detect = useMemo(
    () =>
      trend ? trendNichoEfetivo(trend, keywords) : { niche: null, confidence: "unknown" as const },
    [trend, keywords],
  );
  const detectedOk = detect.confidence === "high" || detect.confidence === "medium";

  const defaultFormat = useMemo(
    () => (trend ? (normalizeTrendFormat(trend.formato).formato ?? INSTA_FORMATS[0]) : null),
    [trend],
  );

  const blueprint = useMemo(() => {
    if (!trend) return null;
    const input: {
      trend: InstaTrend;
      objective: InstaObjetivo;
      niche?: string;
      format?: string;
      keywords: string[];
    } = { trend, objective, keywords };
    if (nicheChoice) input.niche = nicheChoice;
    if (formatSel) input.format = formatSel;
    return buildContentBlueprint(input);
  }, [trend, objective, nicheChoice, formatSel, keywords]);

  if (!trend || !blueprint) return null;

  const bp = blueprint;
  const formatoAtual = formatSel ?? bp.originalFormat ?? "";
  const mudouFormato = normPhrase(formatoAtual) !== normPhrase(bp.originalFormat ?? "");

  const evidenceLines: { rotulo: string; valor: string }[] = [
    { rotulo: "Formato identificado", valor: bp.evidence.formato ?? "—" },
    { rotulo: "Subformato", valor: bp.evidence.subformato ?? "—" },
    { rotulo: "Tendência encontrada", valor: bp.evidence.tendencia },
    { rotulo: "Score", valor: `${bp.evidence.score ?? "—"}/100` },
    { rotulo: "Ciclo", valor: bp.evidence.cicloLabel },
    {
      rotulo: "Nicho",
      valor:
        bp.evidence.nicho && bp.evidence.nichoConfidence
          ? `${bp.evidence.nicho} (${INSTA_NICHE_CONFIDENCE_LABELS[bp.evidence.nichoConfidence]})`
          : "Não identificado com confiança",
    },
    {
      rotulo: "Compatibilidade",
      valor: bp.evidence.compat != null ? `${bp.evidence.compat}%` : "não informado",
    },
    {
      rotulo: "Crescimento",
      valor: bp.evidence.crescimento != null ? `${bp.evidence.crescimento}` : "não informado",
    },
    {
      rotulo: "Recência (1ª vista)",
      valor:
        bp.evidence.recenciaDias != null
          ? `há ${bp.evidence.recenciaDias} dia(s)`
          : "sem timestamp real",
    },
    {
      rotulo: "Vezes vista",
      valor: bp.evidence.seenCount != null ? String(bp.evidence.seenCount) : "não informado",
    },
    { rotulo: "Qualidade do sinal", valor: bp.evidence.qualidadeLabel },
    { rotulo: "Origem do dado", valor: bp.evidence.fonte ?? "não informada" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-[#E1306C]/10 text-[#C13584]">
              <Wand2 className="size-5" />
            </span>
            Transformar em conteúdo
          </DialogTitle>
          <DialogDescription>
            Ideia estruturada (blueprint) criada por regras a partir da tendência real — sem redação
            final e sem IA por enquanto. Aperfeiçoe antes de produzir.
          </DialogDescription>
        </DialogHeader>

        {/* Tendência selecionada (objeto completo) */}
        <Card className="border-[#E1306C]/20 bg-gradient-to-r from-[#E1306C]/5 to-transparent">
          <CardContent className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Tendência selecionada
                </p>
                <p className="break-words text-sm font-bold text-foreground">{bp.trend.nome}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge className={INSTA_CICLO_CLASSES[bp.trend.ciclo]}>
                  {INSTA_CICLO_LABELS[bp.trend.ciclo]}
                </Badge>
                <Badge variant="outline">{bp.trend.score ?? "—"}/100</Badge>
              </div>
            </div>
            {bp.trend.signal_quality && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge
                  variant="outline"
                  className={INSTA_SIGNAL_QUALITY_CLASSES[bp.trend.signal_quality]}
                >
                  sinal {INSTA_SIGNAL_QUALITY_LABELS[bp.trend.signal_quality].toLowerCase()}
                </Badge>
                {bp.originalFormat && <Badge variant="outline">formato {bp.originalFormat}</Badge>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Aviso de base limitada (nicho/sinal) */}
        {bp.dadosLimitados && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>
              Base limitada: esta ideia não deve ser tratada como recomendação altamente confiável
              (nicho não confirmado e/ou qualidade de sinal insuficiente). Confirme antes de
              produzir.
            </span>
          </div>
        )}

        {/* Configuração */}
        <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
          {/* Objetivo */}
          <div>
            <SectionTitle>🎯 Objetivo</SectionTitle>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {INSTA_OBJETIVOS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setObjective(o.key)}
                  title={o.desc}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-left text-xs font-medium transition-colors",
                    objective === o.key
                      ? "border-[#E1306C]/60 bg-[#E1306C]/10 text-[#C13584]"
                      : "border-border bg-background text-muted-foreground hover:border-[#E1306C]/40",
                  )}
                >
                  <span className="block">{o.emoji}</span>
                  <span className="mt-0.5 block">{o.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Nicho */}
          <div>
            <SectionTitle>🎯 Nicho</SectionTitle>
            {detectedOk && detect.niche ? (
              <p className="mb-2 text-xs text-muted-foreground">
                Nicho detectado: <strong className="text-foreground">{detect.niche}</strong>{" "}
                (confiança {INSTA_NICHE_CONFIDENCE_LABELS[detect.confidence].toLowerCase()})
              </p>
            ) : (
              <p className="mb-2 text-xs text-amber-700">
                Nicho não identificado com confiança — selecione manualmente abaixo.
              </p>
            )}
            <select
              value={nicheChoice ?? ""}
              onChange={(e) => setNicheChoice(e.target.value || null)}
              className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
            >
              <option value="">
                {nicheChoice ? "Usar seleção manual" : "Usar nicho detectado"}
              </option>
              {keywords.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {keywords.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Nenhuma keyword configurada no Radar — a detecção de nicho fica limitada.
              </p>
            )}
          </div>

          {/* Formato */}
          <div>
            <SectionTitle>🎬 Formato</SectionTitle>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={formatoAtual}
                onChange={(e) => setFormatSel(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm sm:w-auto"
              >
                {(defaultFormat
                  ? [defaultFormat, ...INSTA_FORMATS.filter((f) => f !== defaultFormat)]
                  : INSTA_FORMATS
                ).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              {bp.subformat && <Badge variant="outline">subformato {bp.subformat}</Badge>}
            </div>
            {mudouFormato && bp.originalFormat && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Original da tendência preservado: {bp.originalFormat}
                {bp.originalSubformat ? ` (${bp.originalSubformat})` : ""}.
              </p>
            )}
          </div>
        </div>

        {/* PRÉVIA DA IDEIA */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-4 text-[#E1306C]" />
            <p className="text-sm font-bold text-foreground">Prévia da ideia</p>
            <Badge variant="secondary" className="ml-auto">
              {bp.objective.label}
            </Badge>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <SectionTitle>🪝 Gancho</SectionTitle>
            <p className="text-sm text-foreground">{bp.hook}</p>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <SectionTitle>📐 Estrutura do conteúdo</SectionTitle>
            <ol className="list-decimal space-y-1.5 pl-5">
              {bp.structure.map((s, i) => (
                <li key={`${s.rotulo}-${i}`} className="text-sm text-foreground">
                  <strong className="font-semibold">{s.rotulo}:</strong> {s.descricao}
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <SectionTitle>✍️ Entrega / Desenvolvimento</SectionTitle>
            <p className="text-sm text-foreground">{bp.delivery}</p>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <SectionTitle>🎯 Como adaptar ao seu nicho</SectionTitle>
            <p className="text-sm text-foreground">{bp.adaptation.text}</p>
            <Badge variant="outline" className="mt-1.5">
              {bp.adaptation.origem === "adaptacao"
                ? "adaptação real da tendência"
                : bp.adaptation.origem === "motivo"
                  ? "texto real do Radar (motivo)"
                  : "orientação estrutural"}
            </Badge>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <SectionTitle>📣 CTA sugerido</SectionTitle>
            <p className="text-sm font-semibold text-foreground">{bp.cta.text}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Por que: {bp.cta.reason}</p>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <SectionTitle>🎨 Direção visual</SectionTitle>
            <ul className="list-disc space-y-1 pl-5">
              {bp.visualDirection.map((v) => (
                <li key={v} className="text-sm text-foreground">
                  {v}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <SectionTitle>🔎 Por que esta ideia foi criada?</SectionTitle>
            <div>
              {evidenceLines.map((l) => (
                <EvidenciaLinha key={l.rotulo} rotulo={l.rotulo} valor={l.valor} />
              ))}
            </div>
          </div>

          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            {bp.transparency || INSTA_BLUEPRINT_TRANSPARENCIA}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button variant="outline" onClick={() => setAiOpen(true)}>
            <Bot className="size-4" />
            Gerar conteúdo completo
          </Button>
          <Button
            className="bg-gradient-to-r from-fuchsia-600 via-pink-600 to-orange-500 text-white hover:from-fuchsia-700 hover:via-pink-700 hover:to-orange-600"
            onClick={() => onSalvarIdeia(bp)}
          >
            <Save className="size-4" />
            Salvar ideia
          </Button>
        </div>
      </DialogContent>

      <AiContentGeneratorDialog
        open={aiOpen}
        payload={prepareBlueprintPayload(bp)}
        onOpenChange={setAiOpen}
      />
    </Dialog>
  );
}
