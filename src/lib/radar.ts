import { supabase } from "@/integrations/supabase/client";

const META_FUNCTIONS_URL = `${import.meta.env["VITE_SUPABASE_URL"]}/functions/v1`;
const RADAR_FUNCTION = `${META_FUNCTIONS_URL}/radar-grupos`;

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${session?.access_token ?? ""}`,
    apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
    "Content-Type": "application/json" as const,
  };
}

export type RadarGroup = {
  id: string;
  fb_id: string | null;
  url: string;
  name: string;
  description: string | null;
  categoria: string | null;
  country: string;
  member_count: number | null;
  member_raw: string | null;
  is_public: boolean | null;
  derivado_de: string[];
  fontes: string[];
  member_checked_at: string | null;
  created_at: string;
  updated_at: string;
  status: RadarStatus;
  favorito: boolean;
  notas: string | null;
  tags: string[];
  permite_divulgacao: boolean;
};

export type RadarStatus =
  "salvo" | "quero_entrar" | "solicitado" | "aguardando" | "membro" | "nao_interesse";

export const RADAR_STATUS_LABELS: Record<RadarStatus, string> = {
  salvo: "Salvo",
  quero_entrar: "Quero entrar",
  solicitado: "Solicitação enviada",
  aguardando: "Aguardando aprovação",
  membro: "Já sou membro",
  nao_interesse: "Não tenho interesse",
};

export const RADAR_STATUS_CLASSES: Record<RadarStatus, string> = {
  salvo: "bg-muted text-muted-foreground",
  quero_entrar: "bg-blue-100 text-blue-700",
  solicitado: "bg-amber-100 text-amber-700",
  aguardando: "bg-purple-100 text-purple-700",
  membro: "bg-green-100 text-green-700",
  nao_interesse: "bg-red-100 text-destructive",
};

export const COUNTRY_LABELS: Record<string, string> = {
  BR: "Brasil",
  PT: "Portugal",
  AO: "Angola",
  MZ: "Moçambique",
  CV: "Cabo Verde",
  GW: "Guiné-Bissau",
  ST: "São Tomé e Príncipe",
  TL: "Timor-Leste",
  GQ: "Guiné Equatorial",
};

export function formatCountry(code: string): string {
  return COUNTRY_LABELS[code] ?? code;
}

export type RadarSearchResult = {
  success: boolean;
  error?: string;
  total_unique: number;
  total_cache_new: number;
  confirmed_count: number;
  unconfirmed_count: number;
  filtered_dropped?: number;
  groups: RadarGroup[];
};

async function radarCall<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T & { success: boolean; error?: string }> {
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetch(`${RADAR_FUNCTION}?action=${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[radar-grupos] fetch falhou:", err);
    return { success: false, error: `Erro de rede ao chamar o servidor (${msg}).` } as T & {
      success: boolean;
      error?: string;
    };
  }
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[radar-grupos] resposta inválida status ${res.status}:`, err);
    return {
      success: false,
      error: `Resposta inválida do servidor (status ${res.status}).`,
    } as T & {
      success: boolean;
      error?: string;
    };
  }
  if (data["error"] && typeof data["error"] === "string") {
    return { success: false, error: data["error"], ...data } as T & {
      success: boolean;
      error?: string;
    };
  }
  return data as T & { success: boolean; error?: string };
}

export const radarApi = {
  search: (q: string, terms: string[]): Promise<RadarSearchResult> =>
    radarCall<RadarSearchResult>("search", { q, terms }),
  import: (urls: string[]): Promise<RadarSearchResult> =>
    radarCall<RadarSearchResult>("import", { urls }),
  recheck: (url: string): Promise<RecheckResult> => radarCall<RecheckResult>("recheck", { url }),
  history: (): Promise<{ success: boolean; history: RadarHistory[] }> =>
    radarCall<{ success: boolean; history: RadarHistory[] }>("history", {}),
};

export type RadarHistory = {
  id: string;
  termo: string;
  termos: unknown;
  total_resultados: number;
  total_grupos: number;
  created_at: string;
};

export type RecheckResult = {
  success: boolean;
  error?: string;
  group?: RadarGroup;
};

export const RADAR_SUGGESTED_TERMS = [
  "miolo de agenda",
  "agenda 2027",
  "papelaria personalizada",
  "arquivos digitais",
  "agenda personalizada",
  "papelaria digital",
  "kits digitais",
  "encadernação",
  "planners",
  "papelaria criativa",
  "artesanato",
  "sublimação",
  "caderno personalizado",
  "scrapbooking",
  "papelaria",
];

export function formatMemberCount(group: Pick<RadarGroup, "member_count" | "member_raw">) {
  if (group.member_count == null) return "Não confirmado";
  if (group.member_count >= 1_000_000) {
    const m = (group.member_count / 1_000_000).toFixed(1).replace(".", ",");
    return `${m} mi`;
  }
  if (group.member_count >= 1000) {
    const k = (group.member_count / 1000).toFixed(0);
    return `${k} mil`;
  }
  return group.member_count.toLocaleString("pt-BR");
}

export function exportGroupsCsv(groups: RadarGroup[], filename = "radar-de-grupos.csv") {
  const header = [
    "Nome",
    "Link",
    "Categoria",
    "País",
    "Membros",
    "Visibilidade",
    "Status",
    "Favorito",
    "Permite divulgação",
    "Descrição",
    "Verificado em",
  ];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = groups.map((g) =>
    [
      esc(g.name),
      esc(g.url),
      esc(g.categoria ?? ""),
      esc(formatCountry(g.country)),
      g.member_count != null ? String(g.member_count) : "Não confirmado",
      esc(g.is_public == null ? "" : g.is_public ? "Público" : "Privado"),
      esc(RADAR_STATUS_LABELS[g.status] ?? g.status),
      g.favorito ? "Sim" : "Não",
      g.permite_divulgacao ? "Sim" : "Não",
      esc(g.description ?? ""),
      esc(g.member_checked_at ? new Date(g.member_checked_at).toLocaleString("pt-BR") : ""),
    ].join(";"),
  );
  const csv = "\uFEFF" + [header.join(";"), ...rows].join("\r\n");
  download(`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`, filename);
}

export function exportGroupsXls(groups: RadarGroup[], filename = "radar-de-grupos.xls") {
  const esc = (v: unknown) => {
    const s = String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return s;
  };
  const header = [
    "Nome",
    "Link",
    "Categoria",
    "País",
    "Membros",
    "Visibilidade",
    "Status",
    "Favorito",
    "Permite divulgação",
    "Descrição",
    "Verificado em",
  ];
  const body = groups
    .map(
      (g) =>
        `<tr>
        <td>${esc(g.name)}</td>
        <td>${esc(g.url)}</td>
        <td>${esc(g.categoria ?? "")}</td>
        <td>${esc(formatCountry(g.country))}</td>
        <td>${g.member_count != null ? String(g.member_count) : "Não confirmado"}</td>
        <td>${g.is_public == null ? "" : g.is_public ? "Público" : "Privado"}</td>
        <td>${esc(RADAR_STATUS_LABELS[g.status] ?? g.status)}</td>
        <td>${g.favorito ? "Sim" : "Não"}</td>
        <td>${g.permite_divulgacao ? "Sim" : "Não"}</td>
        <td>${esc(g.description ?? "")}</td>
        <td>${g.member_checked_at ? new Date(g.member_checked_at).toLocaleString("pt-BR") : ""}</td>
      </tr>`,
    )
    .join("");
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel">
  <head><meta charset="utf-8"></head>
  <body>
    <table border="1">
      <tr>${header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
      ${body}
    </table>
  </body>
  </html>`;
  download(`data:application/vnd.ms-excel;charset=utf-8,${encodeURIComponent(html)}`, filename);
}

function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}
