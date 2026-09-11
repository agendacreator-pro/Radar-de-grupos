import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  instaRadarAlertsMark,
  instaRadarAudioClientResolve,
  instaRadarAudioPost,
  instaRadarAudioPreview,
  instaRadarAudioResolve,
  instaRadarContent,
  instaRadarDashboard,
  instaRadarPlanDelete,
  instaRadarPlanSave,
  instaRadarRun,
  instaRadarSaveKeywords,
  instaRadarWipe,
} from "@/lib/instagram-radar-engine";
import type { InstaAudio, InstaContent, InstaDashboard } from "@/lib/instagram-radar";

async function getToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

export function useInstagramRadar() {
  return useQuery<InstaDashboard>({
    queryKey: ["instagram-radar"],
    queryFn: async () => {
      const token = await getToken();
      const res = await instaRadarDashboard({ data: { token } });
      if (!res.success || !res.data)
        throw new Error(res.error ?? "Falha ao carregar radar do Instagram");
      return res.data;
    },
  });
}

export function useInstaRadarRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const token = await getToken();
      return instaRadarRun({ data: { token } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-radar"] });
    },
  });
}

export function useInstaSaveKeywords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (keywords: string[]) => {
      const token = await getToken();
      return instaRadarSaveKeywords({ data: { token, keywords } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-radar"] });
    },
  });
}

export function useInstaRadarContent() {
  return useMutation({
    mutationFn: async (trend_id?: string): Promise<InstaContent> => {
      const token = await getToken();
      const res = await instaRadarContent({ data: { token, trend_id } });
      if (!res.success || !res.data) throw new Error(res.error ?? "Falha ao gerar conteúdo");
      return res.data;
    },
  });
}

export type InstaPlanDraft = {
  dia: string;
  formato: string;
  trend: string | null;
  audio: string | null;
  ideia: string;
  gancho: string | null;
  objetivo: string | null;
};

export function useInstaPlanSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: InstaPlanDraft) => {
      const token = await getToken();
      return instaRadarPlanSave({ data: { token, ...draft } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-radar"] });
    },
  });
}

export function useInstaPlanDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      return instaRadarPlanDelete({ data: { token, id } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-radar"] });
    },
  });
}

export function useInstaAlertsMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const token = await getToken();
      return instaRadarAlertsMark({ data: { token } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-radar"] });
    },
  });
}

export function useInstaRadarAudioPreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<InstaAudio | null> => {
      const token = await getToken();
      const res = await instaRadarAudioPreview({ data: { token, id } });
      if (!res.success) throw new Error(res.error ?? "Falha ao buscar a prévia da música");
      return res.audio ?? null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-radar"] });
    },
  });
}

export function useInstaRadarAudioResolve() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      term?: string;
      artista?: string;
    }): Promise<InstaAudio | null> => {
      const token = await getToken();
      const res = await instaRadarAudioResolve({ data: { token, ...input } });
      if (!res.success) throw new Error(res.error ?? "Falha ao buscar a faixa");
      return res.audio ?? null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-radar"] });
    },
  });
}

export function useInstaRadarAudioClientResolve() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      term?: string;
      artista?: string;
      preview_url?: string | null;
      artwork_url?: string | null;
      itunes_url?: string | null;
      track_name?: string | null;
      artist_name?: string | null;
      provider?: string | null;
    }): Promise<InstaAudio | null> => {
      const token = await getToken();
      const res = await instaRadarAudioClientResolve({ data: { token, ...input } });
      if (!res.success) throw new Error(res.error ?? "Falha ao vincular a prévia");
      return res.audio ?? null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-radar"] });
    },
  });
}

export function useInstaRadarAudioPost() {
  return useMutation({
    mutationFn: async (id: string): Promise<InstaContent> => {
      const token = await getToken();
      const res = await instaRadarAudioPost({ data: { token, id } });
      if (!res.success || !res.data)
        throw new Error(res.error ?? "Falha ao montar o post do áudio");
      return res.data.content;
    },
  });
}

export function useInstaRadarWipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const token = await getToken();
      return instaRadarWipe({ data: { token } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instagram-radar"] });
    },
  });
}
