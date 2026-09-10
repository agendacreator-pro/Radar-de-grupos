import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Box,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileDown,
  Heart,
  History,
  Import,
  Info,
  LayoutGrid,
  LayoutList,
  List,
  Loader2,
  Megaphone,
  Radar,
  RefreshCw,
  Search,
  Star,
  Tags,
  Trash2,
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
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  formatMemberCount,
  formatCountry,
  COUNTRY_LABELS,
  RADAR_STATUS_CLASSES,
  RADAR_STATUS_LABELS,
  RADAR_SUGGESTED_TERMS,
  exportGroupsCsv,
  exportGroupsXls,
  type RadarGroup,
  type RadarStatus,
} from "@/lib/radar";
import { supabase } from "@/integrations/supabase/client";
import { radarImport, radarRecheck, radarSearch, radarWipe } from "@/lib/radar-engine";
import {
  useRadarGroups,
  useRadarLists,
  useRadarUpdateEstado,
  useRadarBuscaHistory,
  useRadarListaGrupos,
  useRadarListaGruposMap,
  useRadarCreateLista,
} from "@/hooks/useRadar";

export const Route = createFileRoute("/painel/grupos")({
  head: () => ({
    meta: [{ title: "Radar de Grupos" }, { name: "robots", content: "noindex" }],
  }),
  component: RadarGruposPage,
});

const TAMANHOS = [10000, 50000, 100000, 200000, 500000, 1000000] as const;

type Sort = "maiores" | "relevancia" | "recentes";
type Visibilidade = "todos" | "publico";
type StatusFilter = "todos" | RadarStatus;
type PostingFilter = "todos" | "posso" | "permite" | "com_regra";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "quero_entrar", label: "Quero entrar" },
  { value: "solicitado", label: "Solicitado" },
  { value: "aguardando", label: "Aguardando" },
  { value: "membro", label: "Membro" },
  { value: "nao_interesse", label: "Sem interesse" },
];

type PostingNivel = "sem_info" | "livre" | "regras" | "moderacao" | "ambos";

// Sinais automáticos de regras de postagem lidos da descrição do grupo
// (snippet que a busca do Facebook devolve). Não substitui a confirmação
// manual nas regras do grupo — é um aviso honesto quando a descrição deixa
// pistas de que a postagem pode ficar pendente ou ser reprovada.
const POST_FORBID_RE: RegExp[] = [
  /\bproibid[oa]\b/,
  /\bnao\s+permitid/,
  /\bsem\s+divulg/,
  /\bdivulg.{0,12}proibid/,
  /\bsem\s+spam\b/,
  /\bnao\s+post(?:e|ar|a)\b/,
  /\bvend.{0,12}proibid/,
  /\bpromo.{0,12}proibid/,
  /\bsilencio\b/,
];
const POST_CONTENT_RE: RegExp[] = [
  /\bregr(?:a|as)\b/,
  /\bregulamento\b/,
  /\bnorma(?:s)?\b/,
];
const POST_APPROVAL_RE: RegExp[] = [
  /\baprov(?:ad|ac)/,
  /\bmoderad\b/,
  /\bmoderador\b/,
  /\bpendente\b/,
  /\banalise\b/,
];

function grupoPostingInfo(group: Pick<RadarGroup, "description">): {
  nivel: PostingNivel;
  motivos: string[];
} {
  const raw = (group.description ?? "").trim();
  if (!raw) return { nivel: "sem_info", motivos: [] };
  const d = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const forb = POST_FORBID_RE.some((re) => re.test(d));
  const rules = POST_CONTENT_RE.some((re) => re.test(d));
  const appr = POST_APPROVAL_RE.some((re) => re.test(d));
  const motivos: string[] = [];
  if (forb) motivos.push("descrição proíbe divulgação/promoção");
  if (rules) motivos.push("descrição menciona regras de postagem");
  if (appr) motivos.push("posts passam por aprovação/moderação");
  if ((forb || rules) && appr) return { nivel: "ambos", motivos };
  if (forb || rules) return { nivel: "regras", motivos };
  if (appr) return { nivel: "moderacao", motivos };
  return { nivel: "livre", motivos };
}

function PostingBadges({ group, compact = false }: { group: RadarGroup; compact?: boolean }) {
  const info = grupoPostingInfo(group);
  const cls = compact ? "min-w-0 truncate" : "";
  if (info.nivel === "sem_info") {
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", cls)} title="Sem descrição visível para avaliar regras">
        Sem descrição para avaliar
      </Badge>
    );
  }
  const reason = info.motivos.join("; ");
  if (info.nivel === "ambos" || info.nivel === "regras") {
    return (
      <Badge variant="destructive" className={cls} title={reason}>
        Possíveis regras de postagem
      </Badge>
    );
  }
  if (info.nivel === "moderacao") {
    return (
      <Badge variant="secondary" className={cls} title={reason}>
        Posts passam por moderação
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn("border-green-300 bg-green-50 text-green-700", cls)}>
      Sem sinal de regra na descrição
    </Badge>
  );
}

function RadarGruposPage() {
  const queryClient = useQueryClient();
  const { data: gruposSalvos = [], isLoading: loadingSalvos } = useRadarGroups();
  const updateEstado = useRadarUpdateEstado();

  const [term, setTerm] = useState("");
  const [selectedTerms, setSelectedTerms] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [stage, setStage] = useState("procurando");
  const [lastResults, setLastResults] = useState<RadarGroup[] | null>(null);
  const [lastMeta, setLastMeta] = useState<{
    total_unique: number;
    total_cache_new: number;
    confirmed_count: number;
    unconfirmed_count: number;
    repetidos_ignorados?: number;
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const [minMembers, setMinMembers] = useState<number | null>(null);
  const [visibilidade, setVisibilidade] = useState<Visibilidade>("todos");
  const [sort, setSort] = useState<Sort>("maiores");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [countryFilter, setCountryFilter] = useState<string>("todos");
  const [postingFilter, setPostingFilter] = useState<PostingFilter>("posso");
  const [newOnly, setNewOnly] = useState(true);
  const [soFavoritos, setSoFavoritos] = useState(false);

  const [view, setView] = useState<"cards" | "tabela" | "resumo">("resumo");
  const [detail, setDetail] = useState<RadarGroup | null>(null);

  const stageTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const baseGroups = lastResults && lastResults.length > 0 ? lastResults : gruposSalvos;

  const countryOptions = useMemo(() => {
    const present = new Set(baseGroups.map((g) => g.country));
    return [...present].sort();
  }, [baseGroups]);

  const filtered = useMemo(() => {
    let list = baseGroups;
    if (minMembers)
      list = list.filter((g) => g.member_count != null && g.member_count >= minMembers);
    if (visibilidade === "publico") list = list.filter((g) => g.is_public === true);
    if (statusFilter !== "todos") list = list.filter((g) => g.status === statusFilter);
    if (countryFilter !== "todos") list = list.filter((g) => g.country === countryFilter);
    if (soFavoritos) list = list.filter((g) => g.favorito);
    if (postingFilter === "posso") {
      list = list.filter((g) => {
        const nivel = grupoPostingInfo(g).nivel;
        return (
          g.is_public === true &&
          (nivel === "livre" || (g.permite_divulgacao && nivel !== "regras" && nivel !== "ambos"))
        );
      });
    } else if (postingFilter === "permite") {
      list = list.filter((g) => g.permite_divulgacao);
    } else if (postingFilter === "com_regra") {
      list = list.filter((g) => {
        const nivel = grupoPostingInfo(g).nivel;
        return nivel === "regras" || nivel === "moderacao" || nivel === "ambos";
      });
    }
    const arr = [...list];
    if (sort === "maiores") {
      arr.sort((a, b) => (b.member_count ?? -1) - (a.member_count ?? -1));
    } else if (sort === "recentes") {
      arr.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    } else {
      arr.sort((a, b) => {
        const aConfirmed = a.member_count != null ? 1 : 0;
        const bConfirmed = b.member_count != null ? 1 : 0;
        if (aConfirmed !== bConfirmed) return bConfirmed - aConfirmed;
        return (b.member_count ?? -1) - (a.member_count ?? -1);
      });
    }
    return arr;
  }, [baseGroups, minMembers, visibilidade, statusFilter, countryFilter, sort, postingFilter, soFavoritos]);

  async function runSearch(preset?: string) {
    const termo = (preset ?? term).trim();
    if (!termo && selectedTerms.length === 0) return;
    setSearching(true);
    setLastResults(null);
    setLastMeta(null);
    setStage("procurando");
    const stages = ["procurando", "verificando", "salvando"];
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
    const res = await radarSearch({ data: { q: termo, terms: selectedTerms, token, newOnly } }).catch(
      (err: unknown) => {
        clearStage();
        setSearching(false);
        console.error("[radar] falha ao buscar:", err);
        toast.error("Falha ao buscar agora. Tente novamente em instantes.");
        return null;
      },
    );
    if (!res) return;
    clearStage();
    setSearching(false);
    if (!res.success || res.error) {
      toast.error(res.error ?? "Não foi possível buscar os grupos agora.");
      return;
    }
    setTerm("");
    setLastResults(res.groups);
    setLastMeta(res);
    queryClient.invalidateQueries({ queryKey: ["radar-grupos"] });
    if (res.total_unique === 0 && res.sources_ok === 0) {
      toast.warning(
        "Nenhum grupo encontrado agora — as fontes de busca podem estar bloqueando temporariamente. Tente novamente em instantes.",
      );
    } else if (res.total_unique === 0) {
      toast.info(
        res.filtered_dropped && res.filtered_dropped > 0
          ? `Foram encontrados ${res.filtered_dropped} grupos, mas nenhum era do seu nicho — tente termos mais específicos.`
          : "Nenhum grupo do seu nicho encontrado — tente outros termos.",
      );
    } else {
      toast.success(
        `Busca concluída: ${res.total_unique} grupos (${res.confirmed_count} com membros confirmados).`,
      );
    }
  }

  useEffect(
    () => () => {
      if (stageTimer.current) window.clearInterval(stageTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!confirmWipe) return;
    const t = window.setTimeout(() => setConfirmWipe(false), 6000);
    return () => window.clearTimeout(t);
  }, [confirmWipe]);

  async function handleWipe() {
    setSearching(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await radarWipe({ data: { token } });
      if (!res.success || res.error) {
        toast.error(res.error ?? "Não foi possível limpar agora. Tente novamente em instantes.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["radar-grupos"] });
      setLastResults(null);
      setLastMeta(null);
      toast.success(
        `${res.deleted ?? 0} grupo(s) zerado(s). Próxima busca vai trazer grupos novos do nicho.`,
      );
    } catch (err) {
      console.error("[radar] wipe:", err);
      toast.error("Falha ao limpar. Tente novamente em instantes.");
    } finally {
      setSearching(false);
      setConfirmWipe(false);
    }
  }

  function toggleTerm(t: string) {
    setSelectedTerms((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function handleImport(urls: string[]) {
    if (urls.length === 0) return;
    setSearching(true);
    setStage("importando");
    const session0 = await supabase.auth.getSession().catch((err: unknown) => {
      console.error("[radar] falha ao obter sessão:", err);
      throw err;
    });
    const token = session0.data.session?.access_token ?? "";
    let res: Awaited<ReturnType<typeof radarImport>>;
    try {
      res = await radarImport({ data: { urls, token } });
    } catch (err) {
      setSearching(false);
      console.error("[radar] falha ao importar:", err);
      toast.error("Falha ao importar agora. Tente novamente em instantes.");
      return;
    }
    setSearching(false);
    if (!res.success || res.error) {
      console.error("[radar] importação rejeitada:", res.error);
      toast.error(res.error ?? "Falha ao importar os links.");
      return;
    }
    setImportOpen(false);
    setLastResults(res.groups);
    setLastMeta(res);
    queryClient.invalidateQueries({ queryKey: ["radar-grupos"] });
    toast.success(`${res.total_unique} grupos importados.`);
  }

  async function handleRecheck(group: RadarGroup) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";
    let res: Awaited<ReturnType<typeof radarRecheck>>;
    try {
      res = await radarRecheck({ data: { url: group.url, token } });
    } catch (err) {
      console.error("[radar] falha ao verificar:", err);
      toast.error("Falha ao verificar agora. Tente novamente em instantes.");
      return;
    }
    if (!res.success || !res.group) {
      console.error("[radar] verificação rejeitada:", res.error);
      toast.error(res.error ?? "Falha ao verificar.");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["radar-grupos"] });
    setLastResults((prev) =>
      prev ? prev.map((g) => (g.id === res.group!.id ? res.group! : g)) : prev,
    );
    setDetail((prev) => (prev ? res.group! : prev));
    toast.success("Grupo verificado novamente.");
  }

  async function toggleFavorito(group: RadarGroup) {
    const favorito = !group.favorito;
    setLastResults((prev) =>
      prev ? prev.map((g) => (g.id === group.id ? { ...g, favorito } : g)) : prev,
    );
    setDetail((prev) => (prev && prev.id === group.id ? { ...prev, favorito } : prev));
    await updateEstado.mutateAsync({ grupoId: group.id, patch: { favorito } });
  }

  async function changeStatus(group: RadarGroup, status: RadarStatus) {
    setLastResults((prev) =>
      prev ? prev.map((g) => (g.id === group.id ? { ...g, status } : g)) : prev,
    );
    setDetail((prev) => (prev && prev.id === group.id ? { ...prev, status } : prev));
    await updateEstado.mutateAsync({ grupoId: group.id, patch: { status } });
  }

  const stats = useMemo(() => {
    const total = gruposSalvos.length;
    const favoritos = gruposSalvos.filter((g) => g.favorito).length;
    const maiores = gruposSalvos.filter(
      (g) => g.member_count != null && g.member_count >= 100000,
    ).length;
    const publicaveis = gruposSalvos.filter((g) => {
      const nivel = grupoPostingInfo(g).nivel;
      return g.is_public === true && (nivel === "livre" || g.permite_divulgacao);
    }).length;
    return { total, favoritos, maiores, publicaveis };
  }, [gruposSalvos]);

  function selectStat(key: "total" | "posso" | "favoritos" | "maiores") {
    if (key === "total") {
      setPostingFilter("todos");
      setVisibilidade("todos");
      setMinMembers(null);
      setSoFavoritos(false);
      setStatusFilter("todos");
      setCountryFilter("todos");
    } else if (key === "posso") {
      setPostingFilter("posso");
      setVisibilidade("todos");
      setMinMembers(null);
      setSoFavoritos(false);
      setStatusFilter("todos");
      setCountryFilter("todos");
    } else if (key === "favoritos") {
      setSoFavoritos(true);
      setPostingFilter("todos");
      setVisibilidade("todos");
      setMinMembers(null);
      setStatusFilter("todos");
      setCountryFilter("todos");
    } else {
      setMinMembers(100000);
      setSoFavoritos(false);
      setPostingFilter("todos");
      setVisibilidade("todos");
      setStatusFilter("todos");
      setCountryFilter("todos");
    }
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  return (
    <div className="px-5 pb-10 pt-10">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Radar className="size-6 text-primary" />
            Radar de Grupos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Encontre e organize grupos públicos do Facebook do seu nicho para divulgar seu trabalho.
          </p>
        </div>
        <div className="flex gap-2">
          {confirmWipe ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void handleWipe()}
              disabled={searching}
              title="Confirma: apaga TODOS os grupos salvos para reiniciar a descoberta"
            >
              {searching ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Confirmar limpar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmWipe(true)}
              disabled={searching}
              title="Limpar/zerar os grupos encontrados para listar grupos novos do nicho"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setHistoryOpen(true)}
            title="Histórico"
          >
            <History className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(true)}
            title="Importar links"
          >
            <Import className="size-4" />
          </Button>
        </div>
      </header>

      {/* Estatísticas rápidas */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { key: "total" as const, label: "Grupos salvos", value: stats.total, icon: Users },
          { key: "posso" as const, label: "Posso postar", value: stats.publicaveis, icon: Megaphone },
          { key: "favoritos" as const, label: "Favoritos", value: stats.favoritos, icon: Star },
          { key: "maiores" as const, label: "Mais de 100 mil membros", value: stats.maiores, icon: Radar },
        ].map((s) => {
          const active =
            (s.key === "total" &&
              postingFilter === "todos" &&
              visibilidade === "todos" &&
              minMembers == null &&
              !soFavoritos &&
              statusFilter === "todos" &&
              countryFilter === "todos") ||
            (s.key === "posso" && postingFilter === "posso" && !soFavoritos) ||
            (s.key === "favoritos" && soFavoritos) ||
            (s.key === "maiores" && minMembers === 100000 && !soFavoritos);
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
                placeholder="Buscar nicho, ex.: papelaria personalizada"
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
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Termos extra:</span>
            {RADAR_SUGGESTED_TERMS.slice(0, 8).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTerm(t)}
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
            <span className="text-xs font-medium text-muted-foreground">Modo:</span>
            <button
              type="button"
              onClick={() => setNewOnly((v) => !v)}
              title="Oculta e não re-salva grupos que você já tem na carteira — foca em descobertas sempre novas do nicho"
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                newOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50",
              )}
            >
              Só novos grupos
            </button>
            {newOnly && (
              <span className="text-[11px] text-muted-foreground">
                Grupos já salvos são ocultados; a busca prioriza grupos inéditos do nicho.
              </span>
            )}
          </div>

          {searching && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              {stage === "procurando" && "Procurando grupos públicos em fontes abertas..."}
              {stage === "verificando" && "Verificando páginas públicas e contagens de membros..."}
              {stage === "salvando" && "Salvando e organizando resultados..."}
              {stage === "importando" && "Importando links e verificando..."}
            </div>
          )}

          {lastMeta && !searching && (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">{lastMeta.total_unique} grupos encontrados</Badge>
              <Badge variant="secondary">{lastMeta.total_cache_new} novos</Badge>
              <Badge variant="secondary">{lastMeta.confirmed_count} com membros confirmados</Badge>
              {lastMeta.repetidos_ignorados && lastMeta.repetidos_ignorados > 0 && (
                <Badge variant="outline">
                  {lastMeta.repetidos_ignorados} repetidos ocultados (já salvos)
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card className="mt-3">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Mínimo de membros:</span>
            <Button
              size="sm"
              variant={minMembers == null ? "secondary" : "ghost"}
              onClick={() => setMinMembers(null)}
            >
              Todos
            </Button>
            {TAMANHOS.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={minMembers === t ? "secondary" : "ghost"}
                onClick={() => setMinMembers(minMembers === t ? null : t)}
              >
                {t >= 1000000 ? "1 mi" : `${t / 1000}k`}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Visibilidade:</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={visibilidade === "todos" ? "secondary" : "ghost"}
                  onClick={() => setVisibilidade("todos")}
                >
                  Todos
                </Button>
                <Button
                  size="sm"
                  variant={visibilidade === "publico" ? "secondary" : "ghost"}
                  onClick={() => setVisibilidade("publico")}
                >
                  Só públicos
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Posso postar:</span>
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant={postingFilter === "todos" ? "secondary" : "ghost"}
                  onClick={() => setPostingFilter("todos")}
                >
                  Todos
                </Button>
                <Button
                  size="sm"
                  variant={postingFilter === "posso" ? "secondary" : "ghost"}
                  title="Grupo público SEM sinal de regra de postagem na descrição (ou que você marcou como permitindo divulgação)"
                  onClick={() => setPostingFilter(postingFilter === "posso" ? "todos" : "posso")}
                >
                  Público e livre
                </Button>
                <Button
                  size="sm"
                  variant={postingFilter === "permite" ? "secondary" : "ghost"}
                  title="Grupos que você marcou como permitindo divulgação"
                  onClick={() => setPostingFilter(postingFilter === "permite" ? "todos" : "permite")}
                >
                  Permite divulgação (marcado)
                </Button>
                <Button
                  size="sm"
                  variant={postingFilter === "com_regra" ? "secondary" : "ghost"}
                  title="Descrição cita regras, proibição de divulgação ou aprovação de posts — evite ou confirme antes"
                  onClick={() => setPostingFilter(postingFilter === "com_regra" ? "todos" : "com_regra")}
                >
                  Com sinal de regra
                </Button>
              </div>
              <p className="max-w-[32rem] text-[11px] text-muted-foreground">
                Sinal lido da descrição que a busca do Facebook devolveu. Ainda assim, abra o grupo e
                confira as regras antes de postar.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Ordenar:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="maiores">Maiores confirmados</option>
                <option value="relevancia">Relevância</option>
                <option value="recentes">Mais recentes</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">País:</span>
              <select
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="todos">Todos</option>
                {countryOptions.map((c) => (
                  <option key={c} value={c}>
                    {formatCountry(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Meu status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex rounded-md border border-input">
                <button
                  onClick={() => setView("resumo")}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1.5 text-xs",
                    view === "resumo" ? "bg-muted text-foreground" : "text-muted-foreground",
                  )}
                >
                  <LayoutList className="size-3.5" /> Simples
                </button>
                <button
                  onClick={() => setView("cards")}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1.5 text-xs",
                    view === "cards" ? "bg-muted text-foreground" : "text-muted-foreground",
                  )}
                >
                  <LayoutGrid className="size-3.5" /> Cards
                </button>
                <button
                  onClick={() => setView("tabela")}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1.5 text-xs",
                    view === "tabela" ? "bg-muted text-foreground" : "text-muted-foreground",
                  )}
                >
                  <List className="size-3.5" /> Tabela
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportGroupsCsv(filtered)}
                disabled={filtered.length === 0}
                title="Exportar CSV"
              >
                <FileDown className="size-4" /> CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportGroupsXls(filtered)}
                disabled={filtered.length === 0}
                title="Exportar Excel"
              >
                <FileDown className="size-4" /> Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <div ref={listRef} className="mt-4 scroll-mt-4">
        {loadingSalvos && !lastResults ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            searching={searching}
            hasSaved={gruposSalvos.length > 0}
            onSearch={() => runSearch()}
          />
        ) : view === "resumo" ? (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {filtered.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-muted/40"
                  >
                    <a
                      href={g.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:text-primary"
                      title={g.name}
                    >
                      {g.name}
                    </a>
                    <MemberBadge group={g} />
                    {g.is_public == null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Badge variant={g.is_public ? "secondary" : "destructive"}>
                        {g.is_public ? "Público" : "Privado"}
                      </Badge>
                    )}
                    <button
                      type="button"
                      onClick={() => setDetail(g)}
                      className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Ver detalhes"
                    >
                      Detalhes
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : view === "cards" ? (
          <div className="grid gap-3">
            {filtered.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                onOpen={() => setDetail(g)}
                onFavorito={() => toggleFavorito(g)}
                onStatus={(s) => changeStatus(g, s)}
                onRecheck={() => handleRecheck(g)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-[10%]" />
                  <col className="w-[11%]" />
                  <col className="w-[18%]" />
                  <col className="w-[9%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Grupo</th>
                    <th className="px-3 py-2 font-medium">Membros</th>
                    <th className="px-3 py-2 font-medium">Visibilidade</th>
                    <th className="px-3 py-2 font-medium">Postagem</th>
                    <th className="px-3 py-2 font-medium">País</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((g) => (
                    <TableRow
                      key={g.id}
                      group={g}
                      onOpen={() => setDetail(g)}
                      onFavorito={() => toggleFavorito(g)}
                      onStatus={(s) => changeStatus(g, s)}
                      onRecheck={() => handleRecheck(g)}
                    />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      <GroupsDetailDialog
        open={!!detail}
        onOpenChange={(o) => setDetail(o ? detail : null)}
        group={detail}
        onStatus={(s) => detail && changeStatus(detail, s)}
        onRecheck={() => detail && handleRecheck(detail)}
        onFavorito={() => detail && toggleFavorito(detail)}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImport}
        busy={searching}
      />

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onReuse={(q) => {
          setHistoryOpen(false);
          runSearch(q);
        }}
      />
    </div>
  );
}

function MemberBadge({ group }: { group: RadarGroup }) {
  if (group.member_count != null) {
    return (
      <div className="flex items-center gap-1">
        <Users className="size-4 text-primary" />
        <span className="text-sm font-semibold">{formatMemberCount(group)}</span>
        {group.member_checked_at && (
          <span className="text-[10px] text-muted-foreground">
            {new Date(group.member_checked_at).toLocaleDateString("pt-BR")}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      <Info className="size-4" />
      <span className="text-xs">Não confirmado</span>
    </div>
  );
}

function MemberChip({
  group,
  onChange,
}: {
  group: RadarGroup;
  onChange: (s: RadarStatus) => void;
}) {
  const isMember = group.status === "membro";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void onChange(isMember ? "salvo" : "membro");
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        isMember
          ? "border-green-300 bg-green-100 text-green-700"
          : "border-border bg-muted text-muted-foreground hover:border-primary/40",
      )}
      title={isMember ? "Desmarcar como membro" : "Marcar que você já é membro deste grupo"}
    >
      {isMember ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
      {isMember ? "Você é membro" : "Você não é membro"}
    </button>
  );
}

function GroupCard({
  group,
  onOpen,
  onFavorito,
  onStatus,
  onRecheck,
}: {
  group: RadarGroup;
  onOpen: () => void;
  onFavorito: () => void;
  onStatus: (s: RadarStatus) => void;
  onRecheck: () => void;
}) {
  return (
    <Card className="cursor-pointer" onClick={onOpen}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold text-foreground">{group.name}</h3>
              <Badge
                variant={group.is_public === false ? "destructive" : "secondary"}
                className="shrink-0"
              >
                {group.is_public == null ? "Desconhecido" : group.is_public ? "Público" : "Privado"}
              </Badge>
              <Badge variant="outline" className="shrink-0 border-primary/30 bg-primary/5 text-primary">
                {formatCountry(group.country)}
              </Badge>
            </div>
            {group.categoria && (
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Tags className="size-3" /> {group.categoria}
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <PostingBadges group={group} />
              {group.permite_divulgacao && (
                <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
                  <Megaphone className="mr-1 size-3" /> Permite divulgação (marcado)
                </Badge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void onFavorito();
              }}
              className={cn(
                "rounded-md p-1.5 transition-colors",
                group.favorito ? "text-amber-500" : "text-muted-foreground hover:text-amber-500",
              )}
              title="Favorito"
            >
              <Heart className={cn("size-4", group.favorito && "fill-current")} />
            </button>
          </div>
        </div>

        {group.description && (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{group.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <MemberBadge group={group} />
          <MemberChip group={group} onChange={onStatus} />
          <Badge className={RADAR_STATUS_CLASSES[group.status]}>
            {RADAR_STATUS_LABELS[group.status]}
          </Badge>
        </div>

        <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <a
            href={group.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ExternalLink className="size-3.5" /> Ver no Facebook
          </a>
          <select
            value={group.status}
            onChange={(e) => void onStatus(e.target.value as RadarStatus)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            title="Atualizar meu status"
          >
            {Object.entries(RADAR_STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {group.member_count == null && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onRecheck()}
              title="Verificar novamente"
            >
              <RefreshCw className="size-3.5" /> Verificar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TableRow({
  group,
  onOpen,
  onFavorito,
  onStatus,
  onRecheck,
}: {
  group: RadarGroup;
  onOpen: () => void;
  onFavorito: () => void;
  onStatus: (s: RadarStatus) => void;
  onRecheck: () => void;
}) {
return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40" onClick={onOpen}>
      <td className="min-w-0 overflow-hidden px-3 py-2.5">
        <div className="truncate font-medium text-foreground">{group.name}</div>
        {group.categoria && (
          <div className="truncate text-xs text-muted-foreground">{group.categoria}</div>
        )}
      </td>
      <td className="min-w-0 overflow-hidden px-3 py-2.5">
        {group.member_count != null ? (
          <span className="font-medium">{formatMemberCount(group)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Não confirmado</span>
        )}
      </td>
      <td className="min-w-0 overflow-hidden px-3 py-2.5">
        {group.is_public == null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <Badge variant={group.is_public ? "secondary" : "destructive"}>
            {group.is_public ? "Público" : "Privado"}
          </Badge>
        )}
      </td>
      <td className="min-w-0 overflow-hidden px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1">
          <PostingBadges group={group} compact />
          {group.permite_divulgacao && (
            <span className="shrink-0 truncate text-[11px] text-green-700">
              <Megaphone className="mr-0.5 inline size-3" /> marcado
            </span>
          )}
        </div>
      </td>
      <td className="min-w-0 overflow-hidden px-3 py-2.5">
        <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
          {formatCountry(group.country)}
        </Badge>
      </td>
      <td className="min-w-0 overflow-hidden px-3 py-2.5">
        <div className="flex flex-col items-start gap-1">
          <Badge className={RADAR_STATUS_CLASSES[group.status]}>
            {RADAR_STATUS_LABELS[group.status]}
          </Badge>
          <MemberChip group={group} onChange={onStatus} />
        </div>
      </td>
      <td className="min-w-0 overflow-hidden px-3 py-2.5">
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <a
            href={group.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1.5 text-muted-foreground hover:text-primary"
            title="Ver no Facebook"
          >
            <ExternalLink className="size-4" />
          </a>
          <button
            onClick={() => void onFavorito()}
            className={cn(
              "rounded-md p-1.5 text-muted-foreground hover:text-amber-500",
              group.favorito && "text-amber-500",
            )}
            title="Favorito"
          >
            <Heart className={cn("size-4", group.favorito && "fill-current")} />
          </button>
          {group.member_count == null && (
            <button
              onClick={() => void onRecheck()}
              className="rounded-md p-1.5 text-muted-foreground hover:text-primary"
              title="Verificar novamente"
            >
              <RefreshCw className="size-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
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
          {hasSaved ? "Nenhum grupo corresponde aos filtros." : "Nenhum grupo salvo ainda."}
        </p>
        <p className="max-w-sm px-4 text-xs text-muted-foreground">
          Digite um nicho acima (ex.: “papelaria personalizada”) e busque em fontes públicas. Você
          também pode importar links colando URLs de grupos.
        </p>
        {!searching && hasSaved && onSearch ? (
          <Button size="sm" variant="outline" onClick={onSearch}>
            Buscar de novo
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function GroupsDetailDialog({
  open,
  onOpenChange,
  group,
  onStatus,
  onRecheck,
  onFavorito,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: RadarGroup | null;
  onStatus: (s: RadarStatus) => void;
  onRecheck: () => void;
  onFavorito: () => void;
}) {
  const queryClient = useQueryClient();
  const updateEstado = useRadarUpdateEstado();
  const { data: listas = [] } = useRadarLists();
  const { data: listaMap } = useRadarListaGruposMap();
  const [notas, setNotas] = useState("");
  const [tags, setTags] = useState("");
  const [permite, setPermite] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (group) {
      setNotas(group.notas ?? "");
      setTags((group.tags ?? []).join(", "));
      setPermite(group.permite_divulgacao);
    }
  }, [group]);

  if (!group) return null;

  async function salvarDetalhes() {
    if (!group) return;
    setSaving(true);
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await updateEstado.mutateAsync({
        grupoId: group.id,
        patch: { notas, tags: tagList, permite_divulgacao: permite },
      });
      queryClient.invalidateQueries({ queryKey: ["radar-grupos"] });
      toast.success("Detalhes salvos.");
    } catch {
      toast.error("Não foi possível salvar.");
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{group.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant={group.is_public === false ? "destructive" : "secondary"}>
              {group.is_public == null
                ? "Visibilidade desconhecida"
                : group.is_public
                  ? "Grupo público"
                  : "Grupo privado"}
            </Badge>
            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
              {formatCountry(group.country)}
            </Badge>
            <Badge className={RADAR_STATUS_CLASSES[group.status]}>
              {RADAR_STATUS_LABELS[group.status]}
            </Badge>
            <MemberBadge group={group} />
          </DialogDescription>
        </DialogHeader>

        {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <PostingBadges group={group} />
          {group.permite_divulgacao && (
            <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
              <Megaphone className="mr-1 size-3" /> Você marcou que permite divulgação
            </Badge>
          )}
        </div>
        {grupoPostingInfo(group).motivos.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {grupoPostingInfo(group).motivos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <a
            href={group.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ExternalLink className="size-4" /> Abrir no Facebook e solicitar entrada
          </a>
          {group.member_count == null && (
            <Button
              variant="outline"
              onClick={() => void onRecheck()}
              title="Verificar contagem novamente"
            >
              <RefreshCw className="size-4" />
            </Button>
          )}
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between text-sm">
            <label className="font-medium">Status de participação</label>
            <select
              value={group.status}
              onChange={(e) => void onStatus(e.target.value as RadarStatus)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {Object.entries(RADAR_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2
                className={cn(
                  "size-4",
                  group.status === "membro" ? "text-green-600" : "text-muted-foreground",
                )}
              />
              {group.status === "membro" ? "Você é membro deste grupo" : "Você não é membro deste grupo"}
            </div>
            <Switch
              checked={group.status === "membro"}
              onCheckedChange={(c) => void onStatus(c ? "membro" : "salvo")}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Heart className={cn("size-4", group.favorito && "fill-current text-amber-500")} />
              Favorito
            </div>
            <Switch checked={group.favorito} onCheckedChange={() => void onFavorito()} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Megaphone className="size-4 text-foreground" />O grupo permite divulgação?
            </div>
            <Switch checked={permite} onCheckedChange={setPermite} />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Notas</label>
          <Textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Observações, regras, contato do moderador..."
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Tags</label>
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="separadas por vírgula, ex.: papelaria, divulgacao, 100k"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Listas</label>
          {listas.length === 0 ? (
            <p className="text-xs text-muted-foreground">Você ainda não criou listas.</p>
          ) : (
            <div className="space-y-1.5">
              {listas.map((l) => (
                <ListaToggle
                  key={l.id}
                  listaId={l.id}
                  nome={l.nome}
                  icone={l.icone}
                  grupoId={group.id}
                  checked={listaMap?.get(l.id)?.has(group.id) ?? false}
                />
              ))}
            </div>
          )}
          <NovaListaInput
            onCriada={() => queryClient.invalidateQueries({ queryKey: ["radar-listasy"] })}
          />
        </div>

        <Button onClick={() => void salvarDetalhes()} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />} Salvar detalhes
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function ListaToggle({
  listaId,
  nome,
  icone,
  grupoId,
  checked,
}: {
  listaId: string;
  nome: string;
  icone: string | null;
  grupoId: string;
  checked: boolean;
}) {
  const queryClient = useQueryClient();
  const listaGrupos = useRadarListaGrupos();
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="flex items-center gap-2 text-sm">
        {icone ?? <Box className="size-4 text-muted-foreground" />} {nome}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={async (e) => {
          await listaGrupos.mutateAsync({ listaId, grupos: [{ grupoId, isIn: e.target.checked }] });
          queryClient.invalidateQueries({ queryKey: ["radar-lista-grupos-map"] });
        }}
        className="size-4 accent-primary"
      />
    </label>
  );
}

function NovaListaInput({ onCriada }: { onCriada: () => void }) {
  const createLista = useRadarCreateLista();
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex gap-2 pt-1">
      <Input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nova lista (ex.: Divulgação permitida)"
        onKeyDown={(e) => {
          if (e.key === "Enter" && nome.trim()) {
            e.preventDefault();
            void (async () => {
              setBusy(true);
              try {
                await createLista.mutateAsync({ nome: nome.trim() });
                setNome("");
                onCriada();
              } catch {
                toast.error("Não foi possível criar a lista.");
              }
              setBusy(false);
            })();
          }
        }}
      />
      <Button
        size="sm"
        disabled={busy || !nome.trim()}
        onClick={() => {
          void (async () => {
            setBusy(true);
            try {
              await createLista.mutateAsync({ nome: nome.trim() });
              setNome("");
              onCriada();
            } catch {
              toast.error("Não foi possível criar a lista.");
            }
            setBusy(false);
          })();
        }}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Criar"}
      </Button>
    </div>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  onImport,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImport: (urls: string[]) => void;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar links do Facebook</DialogTitle>
          <DialogDescription>
            Cole os links dos grupos que você já conhece (um por linha). O Radar vai verificar e
            salvar.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={
            "https://www.facebook.com/groups/12345\nhttps://www.facebook.com/groups/67890"
          }
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button
            className="flex-1"
            disabled={busy || !text.trim()}
            onClick={() => {
              const urls = text
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean);
              void onImport(urls);
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />} Importar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  open,
  onOpenChange,
  onReuse,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onReuse: (term: string) => void;
}) {
  const { data: history = [], isLoading } = useRadarBuscaHistory();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Histórico de buscas</DialogTitle>
          <DialogDescription>Repita uma busca anterior com um clique.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {isLoading && <Skeleton className="h-10 w-full" />}
          {!isLoading && history.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma busca até agora.</p>
          )}
          {history.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => onReuse(h.termo)}
              className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
            >
              <span className="truncate font-medium">{h.termo}</span>
              <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                {h.total_grupos} grupos · {new Date(h.created_at).toLocaleDateString("pt-BR")}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
