import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUp,
  Box,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Flame,
  Info,
  Instagram,
  ListMusic,
  Loader2,
  MessageSquare,
  Music2,
  Play,
  Radar,
  RefreshCw,
  Sparkles,
  Tags,
  Trash2,
  TrendingUp,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  INSTA_ALERT_TIPO_LABELS,
  INSTA_CATEGORIA_LABELS,
  INSTA_CICLO_CLASSES,
  INSTA_CICLO_LABELS,
  INSTA_CICLO_ORDER,
  INSTA_CICLO_SCORE_COLOR,
  INSTA_DIAS,
  INSTA_FONTE_CLASSES,
  INSTA_FONTE_LABELS,
  INSTA_FORMATS,
  INSTA_GANCHOS,
  formatHora,
  scoreLabel,
  type InstaAlert,
  type InstaAudio,
  type InstaCiclo,
  type InstaContent,
  type InstaPlan,
  type InstaTrend,
} from "@/lib/instagram-radar";
import {
  useInstaAlertsMark,
  useInstaPlanDelete,
  useInstaPlanSave,
  useInstaRadarAudioPreview,
  useInstaRadarContent,
  useInstaRadarRun,
  useInstaRadarWipe,
  useInstaSaveKeywords,
  useInstagramRadar,
} from "@/hooks/useInstagramRadar";

export const Route = createFileRoute("/painel/instagram")({
  head: () => ({
    meta: [{ title: "Radar do Algoritmo — Instagram" }, { name: "robots", content: "noindex" }],
  }),
  component: RadarInstagramPage,
});

function StatusPill({ message, tone }: { message: string; tone: "ok" | "idle" | "err" | "run" }) {
  const cls =
    tone === "ok"
      ? "border-green-300 bg-green-50 text-green-700"
      : tone === "run"
        ? "border-amber-300 bg-amber-50 text-amber-700"
        : tone === "err"
          ? "border-red-300 bg-red-50 text-red-700"
          : "border-slate-300 bg-slate-100 text-slate-600";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        cls,
      )}
    >
      {tone === "run" ? <Loader2 className="size-3 animate-spin" /> : null}
      {message}
    </span>
  );
}

function FonteBadge({
  fonte,
  detalhe,
}: {
  fonte: InstaTrend["fonte"] | InstaAudio["fonte"];
  detalhe?: string | null;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(INSTA_FONTE_CLASSES[fonte])}
      title={detalhe ?? undefined}
    >
      <Info className="mr-1 size-3" />
      {INSTA_FONTE_LABELS[fonte]}
    </Badge>
  );
}

function ScoreBar({ score, ciclo }: { score: number; ciclo: InstaCiclo }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", INSTA_CICLO_SCORE_COLOR[ciclo])}
          style={{ width: `${Math.max(2, score)}%` }}
        />
      </div>
      <span className="text-xs font-semibold" title={`Score ${score}/100 — ${scoreLabel(score)}`}>
        {score}/100
      </span>
    </div>
  );
}

function TrendCard({
  t,
  onTransform,
  onAgendar,
}: {
  t: InstaTrend;
  onTransform: (t: InstaTrend) => void;
  onAgendar: (t: InstaTrend) => void;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={INSTA_CICLO_CLASSES[t.ciclo]}>{INSTA_CICLO_LABELS[t.ciclo]}</Badge>
              <Badge variant="outline">{INSTA_CATEGORIA_LABELS[t.categoria]}</Badge>
              <FonteBadge fonte={t.fonte} detalhe={t.fonte_detalhe} />
            </div>
            <p className="mt-1.5 break-words text-sm font-semibold text-foreground">{t.nome}</p>
          </div>
        </div>

        <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
          <ScoreBar score={t.score} ciclo={t.ciclo} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span title="Compatibilidade com as palavras-chave do seu nicho">
              🎯 compat {t.compat}%
            </span>
            {t.crescimento > 0 ? (
              <span
                className="flex items-center gap-1 text-green-600"
                title="Sinal de crescimento observado (estimativa, não é dado oficial)"
              >
                <TrendingUp className="size-3" /> crescimento {t.crescimento}
              </span>
            ) : (
              <span className="text-[11px]">crescimento: dado não disponível</span>
            )}
            {t.formato && <span>┊ formato: {t.formato}</span>}
          </div>
          {t.motivo && (
            <p className="flex items-start gap-1 text-[11px]">
              <Info className="mt-0.5 size-3 shrink-0" />
              {t.motivo}
            </p>
          )}
          {t.adaptacao && (
            <p className="rounded-md border border-[#DD2A7B]/25 bg-[#E1306C]/5 px-2 py-1.5 text-[11px] text-foreground">
              💡 {t.adaptacao}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white hover:from-[#DD2A7B] hover:via-[#C13584] hover:to-[#962FBF]"
            onClick={() => onTransform(t)}
          >
            <Wand2 className="size-3.5" /> Transformar trend
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAgendar(t)}>
            <Calendar className="size-3.5" /> Agendar
          </Button>
          {t.url && (
            <a
              href={t.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground hover:text-[#E1306C]"
              title="Origem observada (busca pública)"
            >
              <ExternalLink className="size-3.5" /> Fonte
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AudioCard({
  a,
  onPreview,
}: {
  a: InstaAudio;
  onPreview: (id: string) => Promise<InstaAudio | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [play, setPlay] = useState(false);

  const nomeReels = (a.track_name && a.track_name.trim()) || a.nome;
  const artistLabel = (a.artist_name && a.artist_name.trim()) || a.artista;
  const preview = a.preview_url;

  async function handlePlay() {
    if (preview) {
      setPlay(true);
      setNotice(null);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const updated = await onPreview(a.id);
      if (updated?.preview_url) {
        setPlay(true);
        setNotice(null);
      } else {
        setNotice(
          "Prévia não encontrada para esse nome — use os links abaixo para localizar o áudio e pesquisar no editor de Reels.",
        );
      }
    } catch {
      setNotice("Não consegui buscar a prévia agora. Tente de novo em instantes.");
    } finally {
      setBusy(false);
    }
  }

  function copyName() {
    void navigator.clipboard?.writeText(nomeReels);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${nomeReels}${artistLabel ? ` ${artistLabel}` : ""}`,
  )}`;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={INSTA_CICLO_CLASSES[a.ciclo]}>{INSTA_CICLO_LABELS[a.ciclo]}</Badge>
          <FonteBadge fonte={a.fonte} detalhe={a.fonte_detalhe} />
        </div>

        <div className="mt-2 flex items-start gap-3">
          {a.artwork_url ? (
            <img
              src={a.artwork_url}
              alt={`Capa de ${nomeReels}`}
              className="size-14 shrink-0 rounded-lg object-cover ring-1 ring-border"
              loading="lazy"
            />
          ) : (
            <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF]">
              <Music2 className="size-6 text-white" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-start gap-1.5 break-words text-sm font-bold text-foreground">
              <ListMusic className="mt-0.5 size-4 shrink-0 text-[#E1306C]" />
              {nomeReels}
              {a.track_name && a.track_name.trim() !== a.nome && (
                <span
                  className="rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground"
                  title={`Nome encontrado nos sinais públicos: ${a.nome}`}
                >
                  {a.nome.slice(0, 40)}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              🎤 {artistLabel ? artistLabel : "Artista não identificado"}
            </p>
          </div>
        </div>

        {/* Player */}
        <div className="mt-3">
          {play && preview ? (
            <audio className="w-full" src={preview} controls preload="none" autoPlay />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-[#E1306C]/40 text-[#E1306C] hover:bg-[#E1306C]/10 hover:text-[#E1306C]"
                onClick={() => void handlePlay()}
                disabled={busy}
                title={
                  preview
                    ? "Reproduzir a prévia oficial (30s)"
                    : "Buscar a faixa real no iTunes e reproduzir a prévia"
                }
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {preview ? "Ouvir prévia" : busy ? "Buscando…" : "Ouvir prévia"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={copyName}
                title="Copia o nome da música para colar no editor de Reels"
              >
                {copied ? (
                  <Check className="size-3.5 text-green-600" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copied ? "Nome copiado!" : "Copiar nome p/ Reels"}
              </Button>
            </div>
          )}
          {notice && <p className="mt-2 text-[11px] text-muted-foreground">{notice}</p>}
        </div>

        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          <ScoreBar score={a.score} ciclo={a.ciclo} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {a.usos != null && a.usos > 0 ? (
              <span title="Valor observado na fonte pública">
                ▶ usos observados: {a.usos.toLocaleString("pt-BR")}
              </span>
            ) : (
              <span className="text-[11px]">usos: dado não disponível</span>
            )}
            {a.crescimento > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <ArrowUp className="size-3" /> sinal de alta
              </span>
            )}
            <span>🎯 compat {a.compat}%</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {a.itunes_url && (
            <a
              href={a.itunes_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-muted-foreground hover:border-[#E1306C]/50 hover:text-[#E1306C]"
            >
              <ExternalLink className="size-3.5" /> Apple Music
            </a>
          )}
          <a
            href={ytSearch}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-muted-foreground hover:border-[#E1306C]/50 hover:text-[#E1306C]"
          >
            <ExternalLink className="size-3.5" /> Achar no YouTube
          </a>
        </div>

        <p className="mt-2 rounded-md bg-[#E1306C]/5 px-2 py-1.5 text-[11px] text-muted-foreground">
          💡 No app do Instagram: Reels → 🎵 → pesquisar <strong>“{nomeReels}”</strong> e usar no
          seu vídeo.
        </p>
      </CardContent>
    </Card>
  );
}

function RadarInstagramPage() {
  const { data, isLoading, error } = useInstagramRadar();
  const run = useInstaRadarRun();
  const saveKw = useInstaSaveKeywords();
  const genContent = useInstaRadarContent();
  const planSave = useInstaPlanSave();
  const planDelete = useInstaPlanDelete();
  const alertsMark = useInstaAlertsMark();
  const audioPreview = useInstaRadarAudioPreview();
  const wipe = useInstaRadarWipe();

  const [kwInput, setKwInput] = useState("");
  const [cycleFilter, setCycleFilter] = useState<"todos" | InstaCiclo>("todos");
  type StatFilter = null | "auge" | "compat70" | "oport";
  const [statFilter, setStatFilter] = useState<StatFilter>(null);
  const [contentDialog, setContentDialog] = useState(false);
  const [content, setContent] = useState<InstaContent | null>(null);
  const [planDialog, setPlanDialog] = useState(false);
  const [planDraft, setPlanDraft] = useState({
    dia: "seg",
    formato: "Reels",
    trend: "",
    audio: "",
    ideia: "",
    gancho: "",
    objetivo: "Engajamento",
  });
  const [confirmWipe, setConfirmWipe] = useState(false);
  const alertsRef = useRef<HTMLDivElement>(null);
  const trendsRef = useRef<HTMLDivElement>(null);
  const audiosRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentDialog === false) setContent(null);
  }, [contentDialog]);

  const trends = useMemo(() => data?.trends ?? [], [data]);
  const audios = useMemo(() => data?.audios ?? [], [data]);
  const alerts = useMemo(() => data?.alerts ?? [], [data]);
  const plans = useMemo(() => data?.plans ?? [], [data]);
  const history = useMemo(() => data?.history ?? [], [data]);
  const config = data?.config;
  const stats = data?.stats;

  const viewedTrends = useMemo(() => {
    let out = trends;
    if (cycleFilter !== "todos") out = out.filter((t) => t.ciclo === cycleFilter);
    if (statFilter === "auge")
      out = out.filter((t) => t.ciclo === "auge" || t.ciclo === "crescendo");
    if (statFilter === "compat70") out = out.filter((t) => t.compat >= 70);
    if (statFilter === "oport")
      out = out.filter((t) => t.score >= 65 && t.compat >= 40 && t.ciclo !== "caindo");
    return out;
  }, [trends, cycleFilter, statFilter]);

  function applyStatFilter(f: StatFilter, scrollTo: "trends" | "audios" | "alerts") {
    setStatFilter(f === statFilter ? null : f);
    setCycleFilter("todos");
    const ref = scrollTo === "alerts" ? alertsRef : scrollTo === "audios" ? audiosRef : trendsRef;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearTrendsFilters() {
    setStatFilter(null);
    setCycleFilter("todos");
  }

  const emergentes = useMemo(
    () =>
      trends.filter((t) => (t.ciclo === "surgindo" || t.ciclo === "crescendo") && t.score >= 40),
    [trends],
  );
  const saturadas = useMemo(
    () => trends.filter((t) => t.ciclo === "saturando" || t.ciclo === "caindo"),
    [trends],
  );

  async function handleRun() {
    const res = await run.mutateAsync();
    if (!res.success) {
      if (res.tooSoon) toast.info(res.error);
      else toast.error(res.error);
      return;
    }
    const r = res.result;
    const rs = r?.resumo;
    toast.success(
      `Radar atualizado: ${rs?.total ?? 0} tendências (${rs?.novo ?? 0} novas), ${rs?.audio_count ?? 0} áudios, ${rs?.alertas ?? 0} alertas.`,
    );
  }

  function addKeyword() {
    const v = kwInput.trim().toLowerCase();
    if (!v) return;
    const cur = config?.keywords ?? [];
    if (cur.includes(v)) return;
    const next = [...cur, v].slice(0, 20);
    setKwInput("");
    void saveKw.mutateAsync(next).then((res) => {
      if (res.success) toast.success("Nicho atualizado.");
      else toast.error(res.error);
    });
  }

  function removeKeyword(k: string) {
    const next = (config?.keywords ?? []).filter((x) => x !== k);
    void saveKw.mutateAsync(next).then((res) => {
      if (res.success) toast.success("Nicho atualizado.");
      else toast.error(res.error);
    });
  }

  async function openContent(trend?: InstaTrend) {
    setContentDialog(true);
    try {
      const c = await genContent.mutateAsync(trend?.id);
      setContent(c);
    } catch (e) {
      toast.error("Falha ao gerar conteúdo.");
      setContentDialog(false);
    }
  }

  function openPlanForTrend(trend: InstaTrend) {
    setPlanDraft({
      dia: "seg",
      formato: trend.formato ?? "Reels",
      trend: trend.nome,
      audio: trend.categoria === "audio" ? trend.nome.replace(/^🎵\s*/, "") : "",
      ideia: `Conteúdo sobre "${trend.nome}" adaptado ao nicho.`,
      gancho: "",
      objetivo: "Engajamento",
    });
    setPlanDialog(true);
  }

  function openPlanFromContent(c: InstaContent) {
    setPlanDraft({
      dia: "seg",
      formato: c.formato,
      trend: c.trend ?? "",
      audio: c.audio ?? "",
      ideia: c.ideia,
      gancho: c.gancho,
      objetivo: c.objetivo,
    });
    setContentDialog(false);
    setPlanDialog(true);
  }

  function changeDraft<K extends keyof typeof planDraft>(k: K, v: (typeof planDraft)[K]) {
    setPlanDraft((p) => ({ ...p, [k]: v }));
  }

  async function savePlan() {
    if (!planDraft.ideia.trim()) {
      toast.error("Escreva a ideia do conteúdo.");
      return;
    }
    const res = await planSave.mutateAsync({
      dia: planDraft.dia,
      formato: planDraft.formato,
      trend: planDraft.trend.trim() || null,
      audio: planDraft.audio.trim() || null,
      ideia: planDraft.ideia.trim(),
      gancho: planDraft.gancho.trim() || null,
      objetivo: planDraft.objetivo || "Engajamento",
    });
    if (res.success) {
      toast.success("Adicionado ao planejamento.");
      setPlanDialog(false);
    } else toast.error(res.error);
  }

  async function handleWipe() {
    const res = await wipe.mutateAsync();
    if (res.success) {
      toast.success("Radar limpo (somente seus dados).");
      setConfirmWipe(false);
    } else toast.error(res.error);
  }

  if (isLoading) {
    return (
      <div className="px-5 pb-10 pt-5">
        <div className="space-y-4">
          <Skeleton className="h-8 w-72" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-5 pb-10 pt-5">
        <Card>
          <CardContent className="grid place-items-center gap-2 p-8 text-center">
            <AlertTriangle className="size-6 text-destructive" />
            <p className="text-sm font-medium">Não foi possível carregar o radar do Instagram.</p>
            <p className="text-xs text-muted-foreground">{error?.message ?? "Erro desconhecido"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cicloCounts = INSTA_CICLO_ORDER.map((c) => ({
    c,
    n: trends.filter((t) => t.ciclo === c).length,
  }));

  return (
    <div className="px-5 pb-10 pt-5">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Instagram className="size-7 bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] bg-clip-text text-transparent" />
            Radar do Algoritmo
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Tendências do Instagram semanais para o seu nicho. Scan automático via busca pública
            (Tavily/Brave/DDG/Bing) —{" "}
            <strong>nenhum número de views ou engajamento é inventado</strong>. Score/ciclo são{" "}
            <em>estimativas</em> derivadas de sinais reais observados.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            tone={
              run.isPending
                ? "run"
                : config?.status === "ok"
                  ? "ok"
                  : config?.status === "erro"
                    ? "err"
                    : "idle"
            }
            message={
              run.isPending
                ? "Varrendo a web…"
                : config?.status === "ok"
                  ? "Pronto"
                  : config?.status === "erro"
                    ? "Erro na última execução"
                    : "Aguardando primeira execução"
            }
          />
          <Button
            size="sm"
            className="bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white hover:from-[#DD2A7B] hover:via-[#C13584] hover:to-[#962FBF]"
            onClick={() => void handleRun()}
            disabled={run.isPending}
          >
            {run.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Rodar radar
          </Button>
          <Button
            size="sm"
            className="bg-gradient-to-r from-fuchsia-600 via-pink-600 to-orange-500 text-white hover:from-fuchsia-700 hover:via-pink-700 hover:to-orange-600"
            onClick={() => void openContent()}
            disabled={genContent.isPending || trends.length === 0}
            title="Gera hoje uma sugestão de conteúdo com base nas tendências observadas"
          >
            {genContent.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            O que postar hoje?
          </Button>
        </div>
      </header>

      {/* Estatísticas rápidas */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          {
            label: "Tendências salvas",
            value: stats?.total_trends ?? 0,
            icon: Radar,
            active: statFilter === null && cycleFilter === "todos",
            onClick: () => {
              clearTrendsFilters();
              trendsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            },
          },
          {
            label: "No auge/crescendo",
            value: stats?.na_auge ?? 0,
            icon: Flame,
            active: statFilter === "auge",
            onClick: () => applyStatFilter("auge", "trends"),
          },
          {
            label: "Compat 70%+",
            value: stats?.nicho_alta ?? 0,
            icon: Tags,
            active: statFilter === "compat70",
            onClick: () => applyStatFilter("compat70", "trends"),
          },
          {
            label: "Áudios em alta",
            value: stats?.audio_em_alta ?? 0,
            icon: ListMusic,
            active: false,
            onClick: () =>
              audiosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
          },
          {
            label: "Alertas não lidos",
            value: stats?.alertas_nao_lidos ?? 0,
            icon: MessageSquare,
            active: false,
            onClick: () =>
              alertsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
          },
          {
            label: "Oportunidades hoje",
            value: stats?.oport_hoje ?? 0,
            icon: TrendingUp,
            active: statFilter === "oport",
            onClick: () => applyStatFilter("oport", "trends"),
          },
        ].map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={s.onClick}
            title="Clique para ver o conteúdo"
            className={cn(
              "rounded-xl border p-4 text-left shadow-sm transition-all",
              s.active
                ? "border-transparent bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white"
                : "border-border bg-card hover:border-[#E1306C]",
            )}
          >
            <s.icon className={cn("size-5", s.active ? "text-white" : "text-[#E1306C]")} />
            <span className="mt-2 block text-2xl font-bold leading-none">{s.value}</span>
            <span
              className={cn(
                "mt-1 block text-xs",
                s.active ? "text-white/90" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>Radar do nicho:</span>
        {config?.keywords.length
          ? config.keywords.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs"
              >
                #{k}
                <button
                  type="button"
                  onClick={() => removeKeyword(k)}
                  title={`Remover ${k}`}
                  className="text-destructive hover:underline"
                >
                  ×
                </button>
              </span>
            ))
          : "nenhuma palavra-chave ainda"}
        <span className="inline-flex items-center gap-1">
          <Input
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addKeyword()}
            placeholder="adicionar nicho…"
            className="h-7 w-44 px-2 text-xs"
          />
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={addKeyword}>
            +
          </Button>
        </span>
        <span className="ml-1 text-[11px] text-muted-foreground">
          atualização: {formatHora(config?.last_run_at)} · próxima:{" "}
          {formatHora(config?.next_run_at)}
        </span>
      </div>

      {/* Content dialog below header (when opened) */}
      <ContentDialog
        open={contentDialog}
        content={content}
        loading={genContent.isPending}
        onOpenChange={setContentDialog}
        onAgendar={openPlanFromContent}
      />

      {/* Tendências */}
      <section ref={trendsRef} className="mt-8 scroll-mt-24">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Radar className="size-5 text-[#E1306C]" />
            Tendências do momento
            {viewedTrends.length !== trends.length && (
              <span className="text-sm font-normal text-muted-foreground">
                ({viewedTrends.length} de {trends.length})
              </span>
            )}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {statFilter && (
              <button
                type="button"
                onClick={() => clearTrendsFilters()}
                title="Limpar filtro do card de estatística"
                className="inline-flex items-center gap-1 rounded-full border border-[#DD2A7B]/40 bg-[#E1306C]/10 px-2.5 py-0.5 text-xs font-medium text-[#C13584] transition-colors hover:bg-[#E1306C]/20"
              >
                <TrendingUp className="size-3" />
                {statFilter === "auge"
                  ? "No auge/crescendo"
                  : statFilter === "compat70"
                    ? "Compat 70%+"
                    : "Oportunidades hoje"}
                <span className="text-[#C13584]">×</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setCycleFilter("todos")}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                cycleFilter === "todos"
                  ? "border-transparent bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white"
                  : "border-border bg-background text-muted-foreground hover:border-[#E1306C]/50",
              )}
            >
              Todas ({trends.length})
            </button>
            {cicloCounts.map(({ c, n }) => (
              <button
                key={c}
                type="button"
                onClick={() => setCycleFilter(cycleFilter === c ? "todos" : c)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  cycleFilter === c
                    ? "border-transparent bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white"
                    : "border-border bg-background text-muted-foreground hover:border-[#E1306C]/50",
                )}
              >
                {INSTA_CICLO_LABELS[c]} ({n})
              </button>
            ))}
          </div>
        </div>
        {viewedTrends.length === 0 ? (
          <EmptyRadar
            hasSaved={trends.length > 0}
            onRun={() => void handleRun()}
            searching={run.isPending}
          />
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {viewedTrends.map((t) => (
              <TrendCard
                key={t.id}
                t={t}
                onTransform={(tr) => void openContent(tr)}
                onAgendar={openPlanForTrend}
              />
            ))}
          </div>
        )}
      </section>

      {/* Áudios em alta */}
      <section ref={audiosRef} className="mt-8 scroll-mt-24">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <ListMusic className="size-5 text-[#E1306C]" />
          Áudios em alta
        </h2>
        {audios.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Ainda sem áudios mapeados — dados observados aparecem após rodar o radar. Música/áudio
            de Reels é identificado por sinais públicos de "áudio em alta".
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {audios.map((a) => (
              <AudioCard key={a.id} a={a} onPreview={(id) => audioPreview.mutateAsync(id)} />
            ))}
          </div>
        )}
      </section>

      {/* Emergentes & Saturadas */}
      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-[#C13584]">
            <ArrowUp className="size-5" />
            Emergentes (aproveitar agora)
          </h2>
          {emergentes.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Sem tendências emergentes ainda.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {emergentes.slice(0, 6).map((t) => (
                <EmergenteRow
                  key={t.id}
                  t={t}
                  onTransform={(tr) => void openContent(tr)}
                  onAgendar={openPlanForTrend}
                />
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-red-700">
            <AlertTriangle className="size-5" />
            Saturadas / em queda (cuidado)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Postar igual a todo mundo não rende. Se usar, traga um ângulo próprio.
          </p>
          {saturadas.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nada em queda no momento.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {saturadas.slice(0, 6).map((t) => (
                <EmergenteRow
                  key={t.id}
                  t={t}
                  onTransform={(tr) => void openContent(tr)}
                  onAgendar={openPlanForTrend}
                  warn
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Ganchos */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <Play className="size-5 text-[#E1306C]" />
          Ganchos que funcionam (acele sua abertura)
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {INSTA_GANCHOS.map((g) => (
            <Card key={g.id}>
              <CardContent className="p-3">
                <p className="text-sm font-semibold text-foreground">{g.nome}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {g.exemplo.replace("{tema}", config?.keywords[0] ?? "seu tema")}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Alertas */}
      <section ref={alertsRef} className="mt-8 scroll-mt-20">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <MessageSquare className="size-5 text-[#E1306C]" />
            Alertas automáticos
            {(stats?.alertas_nao_lidos ?? 0) > 0 && (
              <Badge className="bg-gradient-to-r from-[#DD2A7B] to-[#8134AF] text-white">
                {stats?.alertas_nao_lidos} novos
              </Badge>
            )}
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void alertsMark.mutateAsync()}
            disabled={alerts.length === 0}
          >
            <CheckCircle2 className="size-3.5" /> Marcar lidos
          </Button>
        </div>
        {alerts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Sem alertas ainda. Eles aparecem quando o radar encontra tendências novas.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {alerts.map((a) => (
              <AlertRow key={a.id} a={a} />
            ))}
          </div>
        )}
      </section>

      {/* Histórico */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <RefreshCw className="size-5 text-[#E1306C]" />
          Histórico de análises
        </h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma execução registrada ainda.</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {history.slice(0, 9).map((h) => (
              <Card key={h.id}>
                <CardContent className="p-3">
                  <p className="text-sm font-semibold text-foreground">{formatHora(h.criado_em)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {h.resumo.total ?? 0} tendências · {h.resumo.novo ?? 0} novas ·{" "}
                    {h.resumo.audio_count ?? 0} áudios · {h.resumo.alertas ?? 0} alertas
                  </p>
                  {h.resumo.top?.[0] && (
                    <p
                      className="mt-1 truncate text-xs text-muted-foreground"
                      title={h.resumo.top[0].nome}
                    >
                      Top: {h.resumo.top[0].nome} ({h.resumo.top[0].score}/100)
                    </p>
                  )}
                  {h.resumo.por_ciclo ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {INSTA_CICLO_ORDER.filter((c) => (h.resumo.por_ciclo?.[c] ?? 0) > 0).map(
                        (c) => (
                          <Badge key={c} variant="outline" className={INSTA_CICLO_CLASSES[c]}>
                            {INSTA_CICLO_LABELS[c].split(" ")[1]}: {h.resumo.por_ciclo?.[c]}
                          </Badge>
                        ),
                      )}
                    </div>
                  ) : null}
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    fonte: {h.resumo.fonte ?? "—"} · {h.resumo.duracao ?? 0}s
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Planejamento / calendário */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Calendar className="size-5 text-[#E1306C]" />
            Calendário da semana
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPlanDraft({
                dia: "seg",
                formato: "Reels",
                trend: "",
                audio: "",
                ideia: "",
                gancho: "",
                objetivo: "Engajamento",
              });
              setPlanDialog(true);
            }}
          >
            + Adicionar conteúdo
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {INSTA_DIAS.map((d) => {
            const items = plans.filter((p) => p.dia === d.key);
            return (
              <div key={d.key} className="rounded-xl border border-border bg-card p-3">
                <p className="text-xs font-semibold text-muted-foreground">{d.label}</p>
                <div className="mt-2 space-y-2">
                  {items.length === 0 && (
                    <p className="text-[11px] text-muted-foreground/70">livre</p>
                  )}
                  {items.map((p) => (
                    <div key={p.id} className="rounded-md border border-border bg-background p-2">
                      <p className="text-[11px] font-medium text-foreground">{p.formato}</p>
                      <p className="mt-0.5 line-clamp-3 text-[11px] text-muted-foreground">
                        {p.ideia}
                      </p>
                      {(p.trend || p.audio) && (
                        <p className="mt-1 truncate text-[10px] text-[#E1306C]">
                          {p.trend ? `trend: ${p.trend}` : `áudio: ${p.audio}`}
                        </p>
                      )}
                      {p.objetivo && (
                        <p className="text-[10px] text-muted-foreground">objetivo: {p.objetivo}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => void planDelete.mutateAsync(p.id)}
                        className="mt-1 text-[10px] text-destructive hover:underline"
                      >
                        remover
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Conexão oficial */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <Box className="size-5 text-[#E1306C]" />
          Conectar Instagram (dados oficiais)
        </h2>
        <Card className="mt-3">
          <CardContent className="p-4">
            {data.conexao.length ? (
              data.conexao.map((c) => (
                <div key={c.label} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {c.conectado ? (
                        <CheckCircle2 className="size-4 text-green-600" />
                      ) : (
                        <Box className="size-4 text-muted-foreground" />
                      )}
                      {c.label ?? "Instagram oficial"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{c.instrucao}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    Não conectado (e ok ser honesto: nenhum dado é fabricado).
                  </p>
                  <p>
                    O acesso aos dados oficiais do Instagram exige um App Meta com as permissões{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">instagram_basic</code>,{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      instagram_manage_insights
                    </code>{" "}
                    e{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      pages_read_engagement
                    </code>
                    , além do vínculo Business com sua conta. Sem isso, o plano usa somente sinais
                    públicos — sempre rotulados.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled
                  title="Requisições de OAuth/insights exigem App Meta configurado (fora do escopo atual)"
                >
                  Conectar (em breve)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Rodapé / fonte / limpeza */}
      <section className="mt-8 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium">Legenda de confiabilidade:</span>
          {(
            [
              ["oficial", "dado real da API (nenhum ainda sem conexão)"],
              ["observado", "sinal visto em página/busca pública"],
              ["estimativa", "score/ciclo inferidos de sinais observados"],
              ["inferencia", "gerado por regras (MEELL) — sem números inventados"],
            ] as const
          ).map(([k, d]) => (
            <Badge key={k} variant="outline" className={INSTA_FONTE_CLASSES[k]} title={d}>
              {INSTA_FONTE_LABELS[k]}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">
            Seus dados ficam isolados por usuário (RLS). O radar respeita intervalo de {`10 min`}{" "}
            entre execuções.
          </p>
          {confirmWipe ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void handleWipe()}
              disabled={wipe.isPending}
            >
              {wipe.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Confirmar limpar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmWipe(true)}
              title="Apaga TODOS os dados do radar do Instagram (sua conta)"
              disabled={wipe.isPending}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function EmergenteRow({
  t,
  onTransform,
  onAgendar,
  warn,
}: {
  t: InstaTrend;
  onTransform: (t: InstaTrend) => void;
  onAgendar: (t: InstaTrend) => void;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={INSTA_CICLO_CLASSES[t.ciclo]}>{INSTA_CICLO_LABELS[t.ciclo]}</Badge>
            <Badge variant="outline">{INSTA_CATEGORIA_LABELS[t.categoria]}</Badge>
            <FonteBadge fonte={t.fonte} detalhe={t.fonte_detalhe} />
          </div>
          <p className="mt-1.5 text-sm font-medium text-foreground">{t.nome}</p>
          <div className="mt-1 flex items-center gap-2">
            <ScoreBar score={t.score} ciclo={t.ciclo} />
            <span className="text-xs text-muted-foreground">compat {t.compat}%</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onTransform(t)}
          >
            <Wand2 className="size-3.5" /> transformar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onAgendar(t)}
          >
            <Calendar className="size-3.5" /> agendar
          </Button>
        </div>
      </div>
      {warn && t.adaptacao && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          💡 {t.adaptacao}
        </p>
      )}
    </div>
  );
}

function AlertRow({ a }: { a: InstaAlert }) {
  return (
    <div
      className={cn("rounded-xl border bg-card p-3 shadow-sm", !a.lido && "border-[#E1306C]/40")}
    >
      <div className="flex flex-wrap items-center gap-2">
        {!a.lido && (
          <span className="size-2 animate-pulse rounded-full bg-[#E1306C]" title="Não lido" />
        )}
        <p className="text-sm font-medium text-foreground">{a.titulo}</p>
        <Badge variant="outline" className="text-[10px]">
          {INSTA_ALERT_TIPO_LABELS[a.tipo]}
        </Badge>
        <span className="ml-auto text-[11px] text-muted-foreground">{formatHora(a.criado_em)}</span>
      </div>
      {a.descricao && <p className="mt-1 text-xs text-muted-foreground">{a.descricao}</p>}
    </div>
  );
}

function EmptyRadar({
  hasSaved,
  searching,
  onRun,
}: {
  hasSaved: boolean;
  searching: boolean;
  onRun: () => void;
}) {
  return (
    <div className="mt-3 grid place-items-center rounded-xl border border-dashed py-14 text-center">
      <div className="space-y-2">
        {searching ? (
          <Loader2 className="mx-auto size-8 animate-spin text-[#E1306C]" />
        ) : (
          <Radar className="mx-auto size-8 text-muted-foreground" />
        )}
        <p className="text-sm font-medium text-foreground">
          {hasSaved ? "Nenhuma tendência para este filtro." : "Ainda não há tendências mapeadas."}
        </p>
        <p className="max-w-sm px-4 text-xs text-muted-foreground">
          Rode o radar para varrer a web pública por trends/áudios alinhados ao seu nicho. A
          primeira execução pode levar ~30s.
        </p>
        {!searching && (
          <Button size="sm" variant="outline" onClick={onRun}>
            <RefreshCw className="size-3.5" /> Rodar agora
          </Button>
        )}
      </div>
    </div>
  );
}

function ContentDialog({
  open,
  content,
  loading,
  onOpenChange,
  onAgendar,
}: {
  open: boolean;
  content: InstaContent | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onAgendar: (c: InstaContent) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [content]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-[#E1306C]" />
            {content?.sugestao ?? "Gerando…"}
          </DialogTitle>
          <DialogDescription>
            Roteiro e ideia criados por regras (MEELL) a partir das tendências observadas. Ajuste
            antes de publicar.
          </DialogDescription>
        </DialogHeader>
        {loading || !content ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={INSTA_CICLO_CLASSES[(content.trend_ciclo as InstaCiclo) ?? "crescendo"]}
              >
                {content.trend_ciclo ? INSTA_CICLO_LABELS[content.trend_ciclo as InstaCiclo] : "—"}
              </Badge>
              <Badge variant="outline">{content.formato}</Badge>
              <Badge variant="outline">score {content.score}/100</Badge>
              <Badge variant="outline">objetivo: {content.objetivo}</Badge>
            </div>
            {content.trend && (
              <p className="text-sm text-muted-foreground">Trend: {content.trend}</p>
            )}
            {content.audio && (
              <p className="text-sm text-muted-foreground">Áudio: {content.audio}</p>
            )}
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Gancho de abertura</p>
              <p className="mt-1 text-sm text-foreground">{content.gancho}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Ideia</p>
              <p className="mt-1 text-sm text-foreground">{content.ideia}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Texto na tela</p>
              <p className="mt-1 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
                {content.texto_tela}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Roteiro</p>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-sm text-foreground">
                {content.roteiro.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Legenda</p>
              <p className="mt-1 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
                {content.legenda}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">CTA</p>
              <p className="mt-1 text-sm text-foreground">{content.cta}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Hashtags</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {content.hashtags.map((h) => (
                  <Badge
                    key={h}
                    variant="outline"
                    className="border-[#DD2A7B]/30 bg-[#E1306C]/5 text-[#E1306C]"
                  >
                    {h}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Capa</p>
              <p className="mt-1 text-sm text-foreground">{content.capa}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white hover:from-[#DD2A7B] hover:via-[#C13584] hover:to-[#962FBF]"
                onClick={() => onAgendar(content)}
              >
                <Calendar className="size-4" /> Adicionar ao planejamento
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const txt = [
                    `Trend: ${content.trend ?? "—"}`,
                    `Formato: ${content.formato}`,
                    `Gancho: ${content.gancho}`,
                    `Ideia: ${content.ideia}`,
                    `Texto na tela: ${content.texto_tela}`,
                    `Roteiro:\n${content.roteiro.map((s) => `- ${s}`).join("\n")}`,
                    `Legenda: ${content.legenda}`,
                    `CTA: ${content.cta}`,
                    `Hashtags: ${content.hashtags.join(" ")}`,
                  ].join("\n");
                  void navigator.clipboard?.writeText(txt);
                  setCopied(true);
                }}
              >
                {copied ? <CheckCircle2 className="size-4" /> : <ExternalLink className="size-4" />}
                {copied ? "Copiado!" : "Copiar tudo"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlanDialog({
  open,
  draft,
  onDraftChange,
  onSave,
  onOpenChange,
  saving,
}: {
  open: boolean;
  draft: {
    dia: string;
    formato: string;
    trend: string;
    audio: string;
    ideia: string;
    gancho: string;
    objetivo: string;
  };
  onDraftChange: <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => void;
  onSave: () => void;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="size-4 text-[#E1306C]" />
            Adicionar ao planejamento
          </DialogTitle>
          <DialogDescription>Agende o conteúdo do dia. Você ajusta depois.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Dia</span>
              <select
                value={draft.dia}
                onChange={(e) => onDraftChange("dia", e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
              >
                {INSTA_DIAS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Formato</span>
              <select
                value={draft.formato}
                onChange={(e) => onDraftChange("formato", e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
              >
                {INSTA_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Trend (opcional)</span>
              <Input
                value={draft.trend}
                onChange={(e) => onDraftChange("trend", e.target.value)}
                placeholder="trend relacionada"
                className="text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Áudio (opcional)</span>
              <Input
                value={draft.audio}
                onChange={(e) => onDraftChange("audio", e.target.value)}
                placeholder="áudio em alta"
                className="text-sm"
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Ideia</span>
            <Textarea
              value={draft.ideia}
              onChange={(e) => onDraftChange("ideia", e.target.value)}
              rows={3}
              placeholder="O que gravar/postar"
              className="text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Gancho</span>
              <Input
                value={draft.gancho}
                onChange={(e) => onDraftChange("gancho", e.target.value)}
                placeholder="gancho da abertura"
                className="text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Objetivo</span>
              <select
                value={draft.objetivo}
                onChange={(e) => onDraftChange("objetivo", e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
              >
                {["Engajamento", "Alcance", "Conversão", "Conexão"].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button
            className="w-full bg-gradient-to-r from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white hover:from-[#DD2A7B] hover:via-[#C13584] hover:to-[#962FBF]"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Calendar className="size-4" />}
            Salvar no planejamento
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
