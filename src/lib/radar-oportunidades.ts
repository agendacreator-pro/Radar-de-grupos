import type { OportunidadeTipo } from "@/lib/radar-intent";

export type Oportunidade = {
  id: string;
  post_url: string;
  post_id: string | null;
  grupo_url: string | null;
  grupo_nome: string | null;
  trecho: string;
  nicho: string;
  termos_relacionados: string[];
  tipo_intencao: OportunidadeTipo;
  score: number;
  justificativa: string | null;
  fonte: string;
  status: OportunidadeStatus;
  verificado: boolean;
  data_encontrada: string;
  data_respondida: string | null;
  created_at: string;
};

export type OportunidadeStatus = "nova" | "quero_atender" | "respondida" | "nao_atender";

export const OPORTUNIDADE_STATUS_LABELS: Record<OportunidadeStatus, string> = {
  nova: "Nova",
  quero_atender: "Quero atender",
  respondida: "Já respondi",
  nao_atender: "Não é para mim",
};

export const OPORTUNIDADE_STATUS_CLASSES: Record<OportunidadeStatus, string> = {
  nova: "bg-blue-100 text-blue-700",
  quero_atender: "bg-amber-100 text-amber-700",
  respondida: "bg-green-100 text-green-700",
  nao_atender: "bg-red-100 text-destructive",
};

export const TIPO_INTENCAO_LABELS: Record<OportunidadeTipo, string> = {
  alta_compra: "Quer comprar",
  indicacao: "Busca indicação",
  duvida: "Tirando dúvida",
  potencial: "Possível comprador",
  anuncio_vendedor: "Anúncio de vendedor",
};

export const TIPO_INTENCAO_CLASSES: Record<OportunidadeTipo, string> = {
  alta_compra: "bg-green-100 text-green-800",
  indicacao: "bg-cyan-100 text-cyan-800",
  duvida: "bg-amber-100 text-amber-800",
  potencial: "bg-muted text-muted-foreground",
  anuncio_vendedor: "bg-red-100 text-destructive",
};

export const TIPO_INTENCAO_ORDER: OportunidadeTipo[] = [
  "alta_compra",
  "indicacao",
  "duvida",
  "potencial",
  "anuncio_vendedor",
];

export function formatScore(score: number): string {
  const s = Number.isFinite(score) ? score : 0;
  if (s >= 85) return "Compra provável";
  if (s >= 65) return "Interessado";
  if (s >= 45) return "Possível";
  return "Baixo";
}

// Template de abordagem para quem vai responder a publicação.
export function suggestReply(oportunidade: Pick<Oportunidade, "nicho">): string {
  const niche = oportunidade.nicho?.trim();
  const alvo = niche ? ` ${niche}` : "";
  return (
    `Oi! Vi sua publicação aqui no grupo${alvo ? ` procurando por "${niche}"` : ""}. ` +
    `Trabalho com${alvo} e posso te ajudar! Posso te mostrar opções e valores sem compromisso? 😊`
  );
}
