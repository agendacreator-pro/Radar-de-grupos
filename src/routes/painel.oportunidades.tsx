import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Box,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  MessageCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tags,
  Users,
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
  OPORTUNIDADE_STATUS_CLASSES,
  OPORTUNIDADE_STATUS_LABELS,
  TIPO_INTENCAO_CLASSES,
  TIPO_INTENCAO_LABELS,
  TIPO_INTENCAO_ORDER,
  formatScore,
  suggestReply,
  type Oportunidade,
  type OportunidadeStatus,
} from "@/lib/radar-oportunidades";
import { RADAR_SUGGESTED_TERMS } from "@/lib/radar";
import { supabase } from "@/integrations/supabase/client";
import { oportunidadesSearch } from "@/lib/radar-oportunidades-engine";
import { useOportunidadeUpdateStatus, useOportunidades } from "@/hooks/useRadarOportunidades";
import { useRadarGroups } from "@/hooks/useRadar";

export const Route = createFileRoute("/painel/oportunidades")({
  head: () => ({
    meta: [{ title: "Oportunidades de Venda" }, { name: "robots", content: "noindex" }],
  }),
  component: RadarOportunidadesPage,
});

type TipoFilter = "todos" | Oportunidade["tipo_intencao"];
type StatusFilter = "todos" | OportunidadeStatus;
type DataFilter = "todas" | "1d" | "7d" | "30d";
type AnoFilter = "todos" | string;
type Sort = "score" | "recentes";

type MetaResult = {
  total_encontradas: number;
  novas: number;
  total_salvas: number;
  por_tipo: Record<string, number>;
  anuncios_ignorados: number;
  antigas_ignoradas: number;
  recent_mode: boolean;
  confirmadas: number;
  sources_ok: number;
  target_mode: boolean;
};

const DATA_FILTERS: { value: DataFilter; label: string }[] = [
  { value: "1d", label: "últimas 24h" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
];

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const min = Math.floor((Date.now() - d) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h atrás`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} d atrás`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function RadarOportunidadesPage() {
  const queryClient = useQueryClient();
  const { data: salvos = [], isLoading: loadingSalvos } = useOportunidades();
  const { data: grupos = [] } = useRadarGroups();
  const updateStatus = useOportunidadeUpdateStatus();

  const [term, setTerm] = useState("");
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [recentOnly, setRecentOnly] = useState(false);
  const [searching, setSearching] = useState(false);
  const [stage, setStage] = useState("buscando");
  const [lastResults, setLastResults] = useState<Oportunidade[] | null>(null);
  const [lastMeta, setLastMeta] = useState<MetaResult | null>(null);
  const [view, setView] = useState<"busca" | "salvas">("salvas");
  const [suggest, setSuggest] = useState<Oportunidade | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [tipoFilter, setTipoFilter] = useState<TipoFilter>("todos");
  const [dataFilter, setDataFilter] = useState<DataFilter>("todas");
  const [anoFilter, setAnoFilter] = useState<AnoFilter>("todos");
  const [sort, setSort] = useState<Sort>("score");

  const stageTimer = useRef<number | null>(null);
  const cancelRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selectedGroups = grupos.filter((g) => selectedGroupIds.includes(g.id));

  const years = useMemo(() => {
    const base = view === "busca" && lastResults ? lastResults : salvos;
    const set = new Set<string>();
    for (const o of base) {
      if (o.verificado && o.data_publicacao) {
        set.add(String(new Date(o.data_publicacao).getUTCFullYear()));
      }
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [salvos, lastResults, view]);

  const viewData = useMemo(() => {
    const base = view === "busca" && lastResults ? lastResults : salvos;
    let list = base;
    if (statusFilter !== "todos") list = list.filter((o) => o.status === statusFilter);
    if (tipoFilter !== "todos") list = list.filter((o) => o.tipo_intencao === tipoFilter);

    // Filtros de data REAL: só contam datas confirmadas (provedor/página). Não chutamos nada.
    const hasPeriod = dataFilter !== "todas" || anoFilter !== "todos";
    let semData: Oportunidade[] = [];
    if (hasPeriod) {
      const cutoff =
        dataFilter !== "todas" ? Date.now() - Number(dataFilter.slice(0, -1)) * 86400000 : 0;
      const naJanela: Oportunidade[] = [];
      const fora: Oportunidade[] = [];
      for (const o of list) {
        const dataReal = o.verificado && o.data_publicacao ? new Date(o.data_publicacao) : null;
        const okPeriodo =
          dataFilter === "todas" || (dataReal !== null && dataReal.getTime() >= cutoff);
        const okAno =
          anoFilter === "todos" ||
          (dataReal !== null &&
            String(dataReal.getUTCFullYear()) === anoFilter);
        (okPeriodo && okAno ? naJanela : fora).push(o);
      }
      list = naJanela;
      semData = fora;
    }

    const arr = [...list];
    if (sort === "score") {
      arr.sort((a, b) => {
        if (a.tipo_intencao === "anuncio_vendedor" && b.tipo_intencao !== "anuncio_vendedor")
          return 1;
        if (b.tipo_intencao === "anuncio_vendedor" && a.tipo_intencao !== "anuncio_vendedor")
          return -1;
        return b.score - a.score;
      });
    } else {
      arr.sort((a, b) => {
        const da =
          a.verificado && a.data_publicacao ? a.data_publicacao : a.data_encontrada;
        const db =
          b.verificado && b.data_publicacao ? b.data_publicacao : b.data_encontrada;
        return db.localeCompare(da);
      });
    }
    return { arr, semData, hasPeriod };
  }, [salvos, lastResults, view, statusFilter, tipoFilter, dataFilter, anoFilter, sort]);

  const stats = useMemo(() => {
    const total = salvos.length;
    const queroAtender = salvos.filter((o) => o.status === "quero_atender").length;
    const respondidas = salvos.filter((o) => o.status === "respondida").length;
    const quentes = salvos.filter((o) => o.tipo_intencao === "alta_compra").length;
    return { total, queroAtender, respondidas, quentes };
  }, [salvos]);

  function selectStat(key: "total" | "queroAtender" | "respondidas" | "quentes") {
    setView("salvas");
    setDataFilter("todas");
    setAnoFilter("todos");
    if (key === "total") {
      setStatusFilter("todos");
      setTipoFilter("todos");
    } else if (key === "queroAtender") {
      setStatusFilter("quero_atender");
      setTipoFilter("todos");
    } else if (key === "respondidas") {
      setStatusFilter("respondida");
      setTipoFilter("todos");
    } else {
      setStatusFilter("todos");
      setTipoFilter("alta_compra");
    }
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function runSearch() {
    const termo = term.trim();
    if (!termo && selectedTerms.length === 0) return;
    setSearching(true);
    cancelRef.current = false;
    setLastResults(null);
    setLastMeta(null);
    setView("busca");
    setAnoFilter("todos");
    setStage("buscando");
    const stages = ["buscando", "analisando", "salvando"];
    let i = 0;
    stageTimer.current = window.setInterval(() => {
      i = (i + 1) % stages.length;
      setStage(stages[i]!);
    }, 3500);
    const clearStage = () => {
      if (stageTimer.current) window.clearInterval(stageTimer.current);
    };
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";
    const res = await oportunidadesSearch({
      data: {
        q: termo,
        terms: selectedTerms,
        token,
        groups: selectedGroups.map((g) => ({ url: g.url, name: g.name })),
        recentDays: recentOnly ? 7 : 0,
      },
    }).catch((err: unknown) => {
      clearStage();
      if (cancelRef.current) return undefined;
      setSearching(false);
      console.error("[oportunidades] falha ao buscar:", err);
      toast.error("Falha ao buscar agora. Tente novamente em instantes.");
      return null;
    });
    clearStage();
    if (cancelRef.current) {
      setSearching(false);
      return;
    }
    if (!res) return;
    setSearching(false);
    if (!res.success || res.error) {
      toast.error(res.error ?? "Não foi possível buscar as oportunidades agora.");
      return;
    }
    setTerm("");
    setLastResults(
      res.oportunidades.map((o) => {
        const ro = o as unknown as Oportunidade;
        return {
          ...ro,
          id: ro.id || `b-${o.post_url}`,
          verificado:
            (o as { publicacao_confirmada?: boolean }).publicacao_confirmada ??
            ro.verificado ??
            false,
          data_encontrada: ro.data_encontrada ?? new Date().toISOString(),
          data_respondida: ro.data_respondida ?? null,
          created_at: ro.created_at ?? new Date().toISOString(),
        };
      }),
    );
    setLastMeta(res);
    queryClient.invalidateQueries({ queryKey: ["radar-oportunidades"] });
    if (res.total_salvas === 0 && res.sources_ok === 0) {
      toast.warning(
        "Nenhuma publicação encontrada agora — as fontes de busca podem estar bloqueando temporariamente. Tente novamente em instantes.",
      );
    } else if (res.total_salvas === 0) {
      toast.info("Nenhuma publicação com intenção de compra encontrada. Tente outros termos.");
    } else {
      toast.success(
        `${res.total_salvas} oportunidade(s) (${res.novas} novas, ${res.anuncios_ignorados} anúncios de vendedor ignorados${res.antigas_ignoradas ? `, ${res.antigas_ignoradas} antigas ocultadas` : ""}).`,
      );
    }
  }

  function cancelSearch() {
    cancelRef.current = true;
    setSearching(false);
    if (stageTimer.current) window.clearInterval(stageTimer.current);
    setLastResults(null);
    setLastMeta(null);
    toast.info("Busca cancelada. Os resultados já salvos continuam disponíveis.");
  }

  async function changeStatus(o: Oportunidade, status: OportunidadeStatus) {
    setLastResults((prev) =>
      prev ? prev.map((x) => (x.id === o.id ? { ...x, status } : x)) : prev,
    );
    await updateStatus.mutateAsync({ id: o.id, status });
  }

  const buyers = viewData.arr.filter((o) => o.tipo_intencao !== "anuncio_vendedor");
  const sellers = viewData.arr.filter((o) => o.tipo_intencao === "anuncio_vendedor");
  const semBuyers = viewData.semData.filter((o) => o.tipo_intencao !== "anuncio_vendedor");
  const semSellers = viewData.semData.filter((o) => o.tipo_intencao === "anuncio_vendedor");

  return (
    <div className="px-5 pb-10 pt-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <ShoppingBag className="size-6 text-primary" />
            Oportunidades de Venda
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Encontre publicações de quem está <strong>procurando</strong> o seu nicho em grupos do
            Facebook e organize sua carteira de atendimento.
          </p>
        </div>
      </header>

      {/* Estatísticas rápidas */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { key: "total" as const, label: "Oportunidades salvas", value: stats.total, icon: ShoppingBag },
          { key: "queroAtender" as const, label: "Quer atender", value: stats.queroAtender, icon: Sparkles },
          { key: "respondidas" as const, label: "Já respondidas", value: stats.respondidas, icon: CheckCircle2 },
          { key: "quentes" as const, label: "Quer comprar", value: stats.quentes, icon: Users },
        ].map((s) => {
          const active =
            view === "salvas" &&
            ((s.key === "total" && statusFilter === "todos" && tipoFilter === "todos") ||
              (s.key === "queroAtender" && statusFilter === "quero_atender") ||
              (s.key === "respondidas" && statusFilter === "respondida") ||
              (s.key === "quentes" && tipoFilter === "alta_compra"));
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => selectStat(s.key)}
              title={`Mostrar: ${s.label}`}
              className={cn(
                "rounded-xl border bg-card text-left shadow-sm transition-colors hover:border-primary hover:bg-accent",
                active ? "border-primary ring-1 ring-primary" : "border-border",
              )}
            >
              <span className="flex items-center gap-3 p-4">
                <s.icon className="size-5 shrink-0 text-primary" />
                <span>
                  <span className="block text-xl font-bold leading-none">{s.value}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{s.label}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Busca */}
      <Card className="mt-5">
        <CardContent className="space-y-3 p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Nicho, ex.: agenda personalizada, miolos, papelaria..."
                className="pl-9"
                disabled={searching}
              />
            </div>
            <Button
              onClick={() => runSearch()}
              disabled={searching || (!term.trim() && selectedTerms.length === 0)}
            >
              {searching ? <Loader2 className="size-4 animate-spin" /> : "Buscar"}
            </Button>
            {searching && (
              <Button variant="outline" onClick={cancelSearch} title="Cancelar busca">
                Cancelar
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Termos:</span>
            {RADAR_SUGGESTED_TERMS.slice(0, 8).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() =>
                  setSelectedTerms((prev) =>
                    prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                  )
                }
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  selectedTerms.includes(t)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50",
                )}
              >
                {t}
              </button>
            ))}
            {selectedTerms.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTerms([])}
                className="text-xs text-destructive underline"
              >
                limpar
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Frescor:</span>
            <button
              type="button"
              onClick={() => setRecentOnly((v) => !v)}
              title="Pede às fontes (Tavily/Brave/DDG) somente resultados recentes; datas confirmadas antigas são ocultadas"
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                recentOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50",
              )}
            >
              Somente últimas 7 dias
            </button>
            {recentOnly && (
              <span className="text-[11px] text-muted-foreground">
                Fontes de busca restritas aos últimos 7 dias; nada é descartado por data chutada.
              </span>
            )}
          </div>

          {grupos.length > 0 && (
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Procurar em grupos salvos:
                </span>
                {grupos.slice(0, 14).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleGroup(g.id)}
                    className={cn(
                      "max-w-[15rem] truncate rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                      selectedGroupIds.includes(g.id)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary/50",
                    )}
                    title={g.name}
                  >
                    {g.name}
                  </button>
                ))}
                {selectedGroupIds.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedGroupIds([])}
                      className="text-xs text-destructive underline"
                    >
                      limpar
                    </button>
                    <span className="ml-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Info className="size-3" /> sem grupos selecionados, a busca varre todo o
                      Facebook
                    </span>
                  </>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {selectedGroupIds.length > 0
                  ? "A busca é focada nas publicações desses grupos (alvo certo)."
                  : "Dica: selecionar grupos aumenta a chance de achar posts com alta intenção de compra."}
              </p>
            </div>
          )}

          {searching && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              {stage === "buscando" && "Procurando publicações com intenção de compra..."}
              {stage === "analisando" && "Analisando textos e classificando a intenção..."}
              {stage === "salvando" && "Salvando e organizando as oportunidades..."}
            </div>
          )}

          {lastMeta && !searching && (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">{lastMeta.total_salvas} oportunidades</Badge>
              <Badge variant="secondary">{lastMeta.novas} novas</Badge>
              <Badge variant="secondary">{lastMeta.anuncios_ignorados} anúncios ignorados</Badge>
              {lastMeta.recent_mode && (
                <Badge variant="secondary" className="border-primary/30 bg-primary/5 text-primary">
                  só últimas 7 dias
                </Badge>
              )}
              {lastMeta.antigas_ignoradas > 0 && (
                <Badge variant="outline">{lastMeta.antigas_ignoradas} antigas ocultadas</Badge>
              )}
              {lastMeta.confirmadas > 0 && (
                <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
                  {lastMeta.confirmadas} com data confirmada
                </Badge>
              )}
              {lastMeta.target_mode && <Badge variant="outline">Grupos selecionados</Badge>}
              {Object.entries(lastMeta.por_tipo ?? {}).length > 0 && (
                <span className="flex items-center gap-1">
                  {Object.entries(lastMeta.por_tipo).map(([tipo, n]) => (
                    <Badge
                      key={tipo}
                      variant="outline"
                      className={TIPO_INTENCAO_CLASSES[tipo as keyof typeof TIPO_INTENCAO_CLASSES]}
                    >
                      {TIPO_INTENCAO_LABELS[tipo as keyof typeof TIPO_INTENCAO_CLASSES]}: {n}
                    </Badge>
                  ))}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={view === "busca" ? "secondary" : "ghost"}
                onClick={() => setView("busca")}
              >
                Busca atual
              </Button>
              <Button
                size="sm"
                variant={view === "salvas" ? "secondary" : "ghost"}
                onClick={() => setView("salvas")}
              >
                Minhas oportunidades
              </Button>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="todos">Status: todos</option>
                {Object.entries(OPORTUNIDADE_STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <select
                value={tipoFilter}
                onChange={(e) => setTipoFilter(e.target.value as TipoFilter)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="todos">Intenção: todas</option>
                {TIPO_INTENCAO_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_INTENCAO_LABELS[t]}
                  </option>
                ))}
              </select>
              <select
                value={dataFilter}
                onChange={(e) => setDataFilter(e.target.value as DataFilter)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="todas">Período: todos</option>
                {DATA_FILTERS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <select
                value={anoFilter}
                onChange={(e) => setAnoFilter(e.target.value as AnoFilter)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                title="Filtra pela data real da publicação (somente datas confirmadas)"
              >
                <option value="todos">Ano: todos</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="score">Maior propensão</option>
                <option value="recentes">Mais recentes</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <div ref={listRef} className="mt-4 scroll-mt-4">
        {loadingSalvos && view === "salvas" && !lastResults ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : (
            view === "busca"
              ? (!lastResults && searching) || (lastResults && lastResults.length === 0)
              : savedEmpty(buyers, sellers, statusFilter)
          ) &&
          viewData.semData.length === 0 ? (
          <EmptyState
            searching={searching}
            hasSaved={salvos.length > 0}
            onSearch={() => runSearch()}
          />
        ) : (
          <div className="space-y-3">
            {buyers.map((o) => (
              <OpportunityCard
                key={o.id}
                opportunity={o}
                onStatus={(s) => changeStatus(o, s)}
                onSuggest={() => setSuggest(o)}
              />
            ))}
            {sellers.length > 0 && (
              <details className="rounded-xl border border-dashed p-3 text-sm">
                <summary className="flex cursor-pointer items-center gap-2 font-medium text-muted-foreground hover:text-foreground">
                  <ShieldAlert className="size-4" />
                  {sellers.length} anúncio(s) de vendedor — provavelmente não são compradores
                </summary>
                <div className="mt-2 space-y-2">
                  {sellers.map((o) => (
                    <OpportunityCard
                      key={o.id}
                      opportunity={o}
                      onStatus={(s) => changeStatus(o, s)}
                      onSuggest={() => setSuggest(o)}
                    />
                  ))}
                </div>
              </details>
            )}
            {viewData.hasPeriod && viewData.semData.length > 0 && (
              <details className="rounded-xl border border-dashed p-3 text-sm">
                <summary className="flex cursor-pointer items-center gap-2 font-medium text-muted-foreground hover:text-foreground">
                  <ShieldAlert className="size-4" />
                  {viewData.semData.length} sem data confirmada — fora do filtro de período/ano
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  Essas publicações não têm data real confirmada (o Facebook não expõe a data de
                  forma confiável na busca), então não são contadas no filtro acima — abra a
                  publicação para conferir a data real.
                </p>
                <div className="mt-2 space-y-2">
                  {semBuyers.map((o) => (
                    <OpportunityCard
                      key={o.id}
                      opportunity={o}
                      onStatus={(s) => changeStatus(o, s)}
                      onSuggest={() => setSuggest(o)}
                    />
                  ))}
                  {semSellers.map((o) => (
                    <OpportunityCard
                      key={o.id}
                      opportunity={o}
                      onStatus={(s) => changeStatus(o, s)}
                      onSuggest={() => setSuggest(o)}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      <SuggestDialog
        opportunity={suggest}
        onOpenChange={(open) => setSuggest(open ? suggest : null)}
      />
    </div>
  );
}

function savedEmpty(
  buyers: Oportunidade[],
  sellers: Oportunidade[],
  statusFilter: StatusFilter,
): boolean {
  return buyers.length === 0 && sellers.length === 0 && statusFilter !== "todos";
}

function OpportunityCard({
  opportunity: o,
  onStatus,
  onSuggest,
}: {
  opportunity: Oportunidade;
  onStatus: (s: OportunidadeStatus) => void;
  onSuggest: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={TIPO_INTENCAO_CLASSES[o.tipo_intencao]}>
                {TIPO_INTENCAO_LABELS[o.tipo_intencao]}
              </Badge>
              <Badge
                variant={o.score >= 85 ? "secondary" : "outline"}
                className={o.score >= 85 ? "bg-green-100 text-green-800" : ""}
                title={o.justificativa ?? ""}
              >
                {o.score}/100 · {formatScore(o.score)}
              </Badge>
              <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
                <Tags className="mr-1 size-3" />
                {o.nicho}
              </Badge>
              {o.verificado &&
                o.data_publicacao &&
                Date.now() - Date.parse(o.data_publicacao) <= 7 * 864e5 && (
                  <Badge
                    variant="outline"
                    className="border-green-300 bg-green-50 text-green-700"
                    title="Data real confirmada nos últimos 7 dias"
                  >
                    <CalendarDays className="mr-1 size-3" /> recente
                  </Badge>
                )}
            </div>
            {o.justificativa && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Info className="size-3 shrink-0" />
                {o.justificativa}
              </p>
            )}
            <p className="mt-2 line-clamp-3 text-sm text-foreground">{o.trecho}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarDays className="size-3" />
                {timeAgo(o.data_encontrada)}
              </span>
              {o.data_publicacao && (
                <span className="flex items-center gap-1">
                  <ShieldCheck className="size-3" />
                  Publicada {timeAgo(o.data_publicacao)}
                  {o.verificado ? " · verificada" : " (estimada)"}
                </span>
              )}
              {o.grupo_nome && (
                <span className="flex items-center gap-1">
                  <Users className="size-3" /> {o.grupo_nome}
                </span>
              )}
              {o.fonte && <span className="text-[11px]">fonte: {o.fonte}</span>}
              <Badge className={OPORTUNIDADE_STATUS_CLASSES[o.status]}>
                {OPORTUNIDADE_STATUS_LABELS[o.status]}
              </Badge>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={o.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ExternalLink className="size-3.5" /> Abrir publicação
          </a>
          <Button size="sm" variant="outline" onClick={onSuggest}>
            <MessageCircle className="size-3.5" /> Sugerir resposta
          </Button>
          <select
            value={o.status}
            onChange={(e) => onStatus(e.target.value as OportunidadeStatus)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            title="Atualizar status"
          >
            {Object.entries(OPORTUNIDADE_STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  searching,
  hasSaved,
  onSearch,
}: {
  searching: boolean;
  hasSaved: boolean;
  onSearch: () => void;
}) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed py-14 text-center">
      <div className="space-y-2">
        {searching ? (
          <Loader2 className="mx-auto size-8 animate-spin text-primary" />
        ) : (
          <Box className="mx-auto size-8 text-muted-foreground" />
        )}
        <p className="text-sm font-medium text-foreground">
          {hasSaved
            ? "Nenhuma oportunidade corresponde aos filtros."
            : "Nenhuma oportunidade salva ainda."}
        </p>
        <p className="max-w-sm px-4 text-xs text-muted-foreground">
          Digite seu nicho (ex.: “agenda personalizada”) e a busca encontra publicações de gente
          procurando exatamente isso nos grupos.
        </p>
        {!searching && !hasSaved && (
          <Button size="sm" variant="outline" onClick={onSearch}>
            Buscar agora
          </Button>
        )}
      </div>
    </div>
  );
}

function SuggestDialog({
  opportunity,
  onOpenChange,
}: {
  opportunity: Oportunidade | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const open = !!opportunity;
  useEffect(() => {
    if (opportunity) {
      setText(suggestReply(opportunity));
      setCopied(false);
    }
  }, [opportunity]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-4 text-primary" />
            Sugerir resposta
          </DialogTitle>
          <DialogDescription>
            {opportunity?.nicho
              ? `Baseado no nicho "${opportunity.nicho}" da publicação. Ajuste o texto antes de enviar no Facebook.`
              : "Ajuste o texto antes de enviar no Facebook."}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Preparando sugestão..."
        />
        <div className="flex items-center justify-end gap-2">
          {copied && <span className="text-xs text-green-600">Copiado!</span>}
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                toast.error("Não foi possível copiar.");
              }
            }}
          >
            Copiar
          </Button>
          {opportunity && (
            <a
              href={opportunity.post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <ExternalLink className="size-3.5" /> Responder no Facebook
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
