import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { instaRadarAiGenerate } from "@/lib/instagram-ai-server";
import type { GeneratedContent } from "@/lib/instagram-ai";
import type { ContentBlueprintPayload } from "@/lib/instagram-content";

export type AiContentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; content: GeneratedContent; usedModel: string }
  | { status: "error"; message: string; configurada: boolean };

async function getToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

/**
 * Gera "conteúdo completo" via IA a partir do payload do blueprint.
 *
 * A chamada vai para a server function `instaRadarAiGenerate` (Worker),
 * onde a chave da IA é lida via `process.env.LLM_API_KEY` — o frontend
 * não conhece nenhuma credencial. Permitir cancelar (ignorando a
 * resposta de chamadas anteriores / desmontagem) e rodar novamente
 * variações. Honesto: `done` só chega com conteúdo normalizado;
 * qualquer falha vira `error` com mensagem amigável (sem detalhe de
 * chave/URL). `configurada` indica se o servidor tem a chave.
 */
export function useInstagramAi() {
  const [state, setState] = useState<AiContentState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const runIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const run = useCallback(
    async (payload: ContentBlueprintPayload, opts?: { variation?: string | null }) => {
      controllerRef.current?.abort();
      const ctrl = new AbortController();
      controllerRef.current = ctrl;
      const runId = ++runIdRef.current;
      setState({ status: "loading" });

      let token = "";
      try {
        token = await getToken();
      } catch {
        token = "";
      }
      if (!token) {
        if (mountedRef.current && runId === runIdRef.current) {
          setState({
            status: "error",
            message: "Sessão expirada. Entre novamente.",
            configurada: false,
          });
        }
        return;
      }

      const res = await instaRadarAiGenerate({
        data:
          opts?.variation != null
            ? { token, payload, variation: opts.variation }
            : { token, payload },
      });

      if (!mountedRef.current || runId !== runIdRef.current) return;
      if (res.status === "cancelled") {
        setState({ status: "idle" });
        return;
      }
      if (res.status === "ok") {
        setState({ status: "done", content: res.content, usedModel: res.usedModel });
        return;
      }
      setState({
        status: "error",
        message: res.error,
        configurada: Boolean(res.configurada),
      });
    },
    [],
  );

  const cancel = useCallback(() => {
    runIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: "idle" });
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: "idle" });
  }, []);

  return { state, run, cancel, reset };
}
