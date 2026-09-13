// ============================================================
// Radar do Algoritmo — Instagram — Motor de GERAÇÃO por IA
//
// Camada de I/O (sem React): chama um provedor de LLM compatível
// com a API OpenAI (chat/completions) usando a mensagem montada
// pela camada pura (src/lib/instagram-ai.ts). Toda REGRA honesta
// (prompt, separação dados×instruções, normalização da resposta)
// fica na camada pura — aqui só existe transporte + configuração.
//
// Configuração (Vite, via .env — nada de chave em código):
//   VITE_LLM_API_KEY   (obrigatório)  chave do provedor
//   VITE_LLM_BASE_URL  (opcional)     padrão https://api.openai.com/v1
//   VITE_LLM_MODEL     (opcional)     padrão gpt-4o-mini
//
// Honestidade: sem chave/configuração, NUNCA fabrica resposta —
// retorna erro claro pedindo a configuração.
// ============================================================

import {
  AiResponseError,
  buildAiMessages,
  normalizeGeneratedContent,
  parseLlmJson,
} from "@/lib/instagram-ai";
import type { GeneratedContent } from "@/lib/instagram-ai";
import type { ContentBlueprintPayload } from "@/lib/instagram-content";

export const INSTA_AI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const INSTA_AI_DEFAULT_MODEL = "gpt-4o-mini";
export const INSTA_AI_DEFAULT_TIMEOUT_MS = 60_000;

export interface AiEngineConfig {
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string | null;
  timeoutMs?: number;
  /** Injetável para testes (padrão: fetch global). */
  fetchImpl?: typeof fetch;
}

function readEnv(key: string): string | null {
  const value = import.meta.env?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Lê a configuração real do ambiente (Vite/.env). Não deixa chave
 * vazar para logs — apenas o erro de configuração é exposto.
 */
export function resolveAiConfig(): AiEngineConfig {
  return {
    apiKey: readEnv("VITE_LLM_API_KEY"),
    baseUrl: readEnv("VITE_LLM_BASE_URL") ?? INSTA_AI_DEFAULT_BASE_URL,
    model: readEnv("VITE_LLM_MODEL") ?? INSTA_AI_DEFAULT_MODEL,
    timeoutMs: INSTA_AI_DEFAULT_TIMEOUT_MS,
  };
}

export type AiResult =
  | { status: "ok"; content: GeneratedContent; usedModel: string }
  | { status: "error"; error: string }
  | { status: "cancelled" };

function combineSignals(
  timeoutMs: number,
  external?: AbortSignal | null,
): {
  signal: AbortSignal;
  timer: ReturnType<typeof setTimeout>;
} {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new AiResponseError("Tempo de geração esgotado.")),
    timeoutMs,
  );
  const signal =
    external && typeof AbortSignal.any === "function"
      ? AbortSignal.any([ctrl.signal, external])
      : ctrl.signal;
  return { signal, timer };
}

/**
 * Gera o conteúdo completo a partir do payload do blueprint.
 *
 * Retorna uma união com status explícito: `ok` (conteúdo
 * normalizado), `error` (mensagem honesta, sem detalhe interno) ou
 * `cancelled` (o caller abortou). Nenhuma exceção escapa.
 */
export async function generateAiContent(
  payload: ContentBlueprintPayload,
  opts?: {
    variation?: string | null;
    config?: AiEngineConfig;
    signal?: AbortSignal | null;
  },
): Promise<AiResult> {
  const config = opts?.config ?? resolveAiConfig();
  const apiKey = String(config.apiKey ?? "").trim();
  if (!apiKey) {
    return {
      status: "error",
      error:
        "IA não configurada: adicione VITE_LLM_API_KEY (e opcionalmente VITE_LLM_BASE_URL / VITE_LLM_MODEL) no .env e rode um novo build.",
    };
  }

  const { signal, timer } = combineSignals(
    config.timeoutMs ?? INSTA_AI_DEFAULT_TIMEOUT_MS,
    opts?.signal,
  );
  try {
    const msgOpts = opts?.variation != null ? { variation: opts.variation } : undefined;
    const { system, user } = buildAiMessages(payload, msgOpts);
    const endpoint = `${String(config.baseUrl ?? INSTA_AI_DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
    const body = {
      model: config.model ?? INSTA_AI_DEFAULT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
      max_tokens: 3200,
    };

    const fetchImpl = config.fetchImpl ?? fetch;
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const detail = String(res.status);
      return {
        status: "error",
        error: `O serviço de IA respondeu com erro (HTTP ${detail}). Tente novamente em instantes.`,
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    if (!raw.trim()) {
      return { status: "error", error: "O serviço de IA retornou uma resposta vazia." };
    }

    let parsed: unknown;
    try {
      parsed = parseLlmJson(raw);
    } catch (e) {
      return {
        status: "error",
        error: e instanceof AiResponseError ? e.message : "Resposta da IA não está em JSON válido.",
      };
    }

    const normalized = normalizeGeneratedContent(parsed, payload.format, payload.subformat);
    return {
      status: "ok",
      content: normalized,
      usedModel: config.model ?? INSTA_AI_DEFAULT_MODEL,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { status: "cancelled" };
    }
    return {
      status: "error",
      error:
        "Falha ao gerar o conteúdo. Confira a sua conexão e a configuração da IA (VITE_LLM_API_KEY) e tente de novo.",
    };
  } finally {
    clearTimeout(timer);
  }
}
