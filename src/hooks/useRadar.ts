import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { RadarGroup, RadarStatus } from "@/lib/radar";

type GrupoUsuario = {
  id: string;
  grupo_id: string;
  favorito: boolean;
  notas: string | null;
  permite_divulgacao: boolean;
  status: RadarStatus;
  tags: string[];
  updated_at: string;
};

type GrupoUsuarioJoined = RadarGroup & GrupoUsuario;

type RadarRow = Database["public"]["Tables"]["radar_grupos"]["Row"] & {
  radar_grupo_usuario?: Array<Partial<Omit<GrupoUsuario, "status">> & { status?: string }> | null;
};

function toJoined(row: RadarRow): GrupoUsuarioJoined {
  const { radar_grupo_usuario, ...rest } = row;
  const u = radar_grupo_usuario?.[0] ?? ({} as Partial<GrupoUsuario>);
  return {
    ...rest,
    grupo_id: u.grupo_id ?? "",
    status: (u.status ?? "salvo") as RadarStatus,
    favorito: u.favorito ?? false,
    notas: u.notas ?? null,
    tags: u.tags ?? [],
    permite_divulgacao: u.permite_divulgacao ?? false,
  };
}

export function useRadarGroups() {
  return useQuery<GrupoUsuarioJoined[]>({
    queryKey: ["radar-grupos"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("radar_grupos")
        .select("*, radar_grupo_usuario(*)")
        .eq("radar_grupo_usuario.user_id", user.id)
        .order("member_count", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map(toJoined);
    },
  });
}

export function useRadarGroupsByStatus(status: RadarStatus | "todos") {
  const q = useRadarGroups();
  const list = (q.data ?? []).filter((g) => status === "todos" || g.status === status);
  return { ...q, data: list };
}

export type EstadoRow = {
  favorito?: boolean;
  notas?: string | null;
  permite_divulgacao?: boolean;
  status?: RadarStatus;
  tags?: string[];
};

export function useRadarUpdateEstado() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ grupoId, patch }: { grupoId: string; patch: EstadoRow }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sem sessão");
      const { error } = await supabase
        .from("radar_grupo_usuario")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("grupo_id", grupoId)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-grupos"] });
    },
  });
}

export type RadList = {
  id: string;
  nome: string;
  icone: string | null;
  created_at: string;
};

export function useRadarLists() {
  return useQuery<RadList[]>({
    queryKey: ["radar-listasy"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("radar_listas")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRadarCreateLista() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ nome, icone }: { nome: string; icone?: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sem sessão");
      const { data, error } = await supabase
        .from("radar_listas")
        .insert({ user_id: user.id, nome, icone: icone ?? null })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-listasy"] });
    },
  });
}

export function useRadarListaGrupos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      listaId,
      grupos,
    }: {
      listaId: string;
      grupos: { grupoId: string; isIn: boolean }[];
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sem sessão");
      const grupIds = grupos.map((g) => g.grupoId);
      const { data: existing } = await supabase
        .from("radar_lista_grupos")
        .select("grupo_id")
        .eq("lista_id", listaId)
        .eq("user_id", user.id)
        .in("grupo_id", grupIds);
      const have = new Set((existing ?? []).map((r) => r.grupo_id));
      const toAdd = grupos.filter((g) => g.isIn && !have.has(g.grupoId));
      const toRemove = grupos.filter((g) => !g.isIn && have.has(g.grupoId));
      if (toAdd.length) {
        await supabase
          .from("radar_lista_grupos")
          .insert(toAdd.map((g) => ({ lista_id: listaId, user_id: user.id, grupo_id: g.grupoId })));
      }
      if (toRemove.length) {
        await supabase
          .from("radar_lista_grupos")
          .delete()
          .eq("lista_id", listaId)
          .eq("user_id", user.id)
          .in(
            "grupo_id",
            toRemove.map((g) => g.grupoId),
          );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-listasy"] });
    },
  });
}

export function useRadarGruposByLista(listaId: string | null) {
  const q = useRadarGroups();
  return useQuery({
    queryKey: ["radar-grupos-lista", listaId],
    enabled: !!listaId && q.isSuccess,
    queryFn: async () => {
      if (!listaId) return [];
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("radar_lista_grupos")
        .select("grupo_id")
        .eq("lista_id", listaId)
        .eq("user_id", user.id);
      if (error) throw error;
      const ids = new Set((data ?? []).map((r) => r.grupo_id));
      return (q.data ?? []).filter((g) => ids.has(g.id));
    },
  });
}

export { type GrupoUsuarioJoined };
export function useRadarBuscaHistory() {
  return useQuery({
    queryKey: ["radar-historia"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("radar_buscas")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRadarListaGruposMap() {
  return useQuery({
    queryKey: ["radar-lista-grupos-map"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return new Map<string, Set<string>>();
      const { data, error } = await supabase
        .from("radar_lista_grupos")
        .select("lista_id, grupo_id")
        .eq("user_id", user.id);
      if (error) throw error;
      const map = new Map<string, Set<string>>();
      for (const r of data ?? []) {
        const set = map.get(r.lista_id) ?? new Set<string>();
        set.add(r.grupo_id);
        map.set(r.lista_id, set);
      }
      return map;
    },
  });
}
