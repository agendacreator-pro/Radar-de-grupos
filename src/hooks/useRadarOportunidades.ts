import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Oportunidade, OportunidadeStatus } from "@/lib/radar-oportunidades";

type OportunidadeRow = Database["public"]["Tables"]["radar_oportunidades"]["Row"];

function toOpportunity(row: OportunidadeRow): Oportunidade {
  return {
    id: row.id,
    post_url: row.post_url,
    post_id: row.post_id,
    grupo_url: row.grupo_url,
    grupo_nome: row.grupo_nome,
    trecho: row.trecho,
    nicho: row.nicho,
    termos_relacionados: row.termos_relacionados ?? [],
    tipo_intencao: row.tipo_intencao,
    score: row.score,
    justificativa: row.justificativa,
    fonte: row.fonte,
    status: (row.status as OportunidadeStatus) ?? "nova",
    verificado: row.verificado ?? false,
    data_encontrada: row.data_encontrada,
    data_respondida: row.data_respondida,
    created_at: row.created_at,
  };
}

export function useOportunidades() {
  return useQuery<Oportunidade[]>({
    queryKey: ["radar-oportunidades"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("radar_oportunidades")
        .select("*")
        .eq("user_id", user.id)
        .order("data_encontrada", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toOpportunity);
    },
  });
}

export function useOportunidadeUpdateStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OportunidadeStatus }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sem sessão");
      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === "respondida") patch["data_respondida"] = new Date().toISOString();
      if (status !== "respondida") patch["data_respondida"] = null;
      const { error } = await supabase
        .from("radar_oportunidades")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-oportunidades"] });
    },
  });
}
