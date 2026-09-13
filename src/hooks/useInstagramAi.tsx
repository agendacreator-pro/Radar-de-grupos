import { useCallback, useEffect, useRef, useState } from "react";

import { generateAiContent, resolveAiConfig } from "@/lib/instagram-ai-engine";
import type { GeneratedContent } from "@/lib/instagram-ai";
import type { ContentBlueprintPayload } from "@/lib/instagram-content";

export type AiContentState =
  | { status: "idle" }
  | { status: "loading"; configurada: boolean }
  | { status: "done"; content: GeneratedContent; usedModel: string }
  | { status: "error"; message: string; configurada: boolean };

/**
 * Gera "conteúdo completo" via IA a partir do payload do blueprint.
 * Permite cancelar (AbortController) e rodar novamente/variações.
 * Honesto: estado `done` só chega com conteúdo normalizado; qualquer
 * falha vira `error` com mensagem amigável (sem detalhe de chave/URL).
 */
export function useInstagramAi() {
  const [state, setState] = useState<AiContentState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

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
      const config = resolveAiConfig();
      controllerRef.current?.abort();
      const ctrl = new AbortController();
      controllerRef.current = ctrl;
      setState({ status: "loading", configurada: Boolean(config.apiKey) });
      const res = await generateAiContent(
        payload,
        opts?.variation != null
          ? { variation: opts.variation, config, signal: ctrl.signal }
          : { config, signal: ctrl.signal },
      );
      if (!mountedRef.current) return;
      if (res.status === "cancelled") {
        setState({ status: "idle" });
        return;
      }
      if (res.status === "ok") {
        setState({ status: "done", content: res.content, usedModel: res.usedModel });
        return;
      }
      setState({ status: "error", message: res.error, configurada: Boolean(config.apiKey) });
    },
    [],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: "idle" });
  }, []);

  return { state, run, cancel, reset };
}
