// ============================================================
// Radar do Algoritmo — Instagram — ENDPOINT SEGURO de IA
//
// Server function (TanStack Start → Worker Cloudflare) que protege
// o segredo da IA, conforme o fluxo:
//
//   Radar do Algoritmo → Frontend → endpoint seguro (Worker)
//     → provider de IA (LLM_API_KEY lida só aqui) → GeneratedContent
//
// A chave NUNCA existe no frontend: `resolveAiServerConfig` lê
// `process.env.LLM_API_KEY` (secret do Worker), este módulo roda
// somente no servidor e o cliente recebe apenas a resposta.
// ============================================================

import { createServerFn } from "@tanstack/react-start";

import { verifyUser } from "@/lib/radar-engine";
import {
  generateAiContent,
  resolveAiServerConfig,
  type AiEngineConfig,
  type AiResult,
} from "@/lib/instagram-ai-engine";
import type { ContentBlueprintPayload } from "@/lib/instagram-content";

export type AiGenerateInput = {
  token: string;
  payload: ContentBlueprintPayload;
  variation?: string | null;
};

export type AiServerResult = AiResult & { configurada: boolean };

/**
 * Gera o conteúdo completo pela IA, protegendo a chave no servidor.
 * - `token`: JWT do usuário (verificado via Supabase service role).
 * - `payload`: blueprint da tendência (ContentBlueprintPayload).
 * - `variation`: opcional — texto de variação pedido pelo usuário.
 *
 * Retorna `AiServerResult`: resultado normalizado + `configurada`
 * (true apenas quando o servidor realmente tem LLM_API_KEY). Nenhuma
 * credencial, URL interna ou header sai nesta resposta.
 */
export const instaRadarAiGenerate = createServerFn({ method: "POST" })
  .validator((d: AiGenerateInput) => d)
  .handler(async ({ data }): Promise<AiServerResult> => {
    if (!data?.payload) {
      return { status: "error", error: "Payload do blueprint não informado.", configurada: false };
    }

    let userId: string | null;
    try {
      userId = await verifyUser(data.token);
    } catch (err) {
      console.error("[instaRadarAiGenerate] verifyUser:", err);
      return {
        status: "error",
        error: "Erro de configuração do servidor. Tente novamente em instantes.",
        configurada: false,
      };
    }
    if (!userId) {
      return { status: "error", error: "Sessão expirada. Entre novamente.", configurada: false };
    }

    const config: AiEngineConfig = resolveAiServerConfig();
    config.onFetchSettled = ({ endpoint, status, ok }) => {
      // Log server-side SEM segredo: endpoint + status HTTP do provedor.
      console.warn(`[instaRadarAiGenerate] provider ${endpoint} status=${status} ok=${ok}`);
    };
    const res = await generateAiContent(data.payload, {
      variation: data.variation ?? null,
      config,
    });
    return { ...res, configurada: Boolean(config.apiKey) };
  });
