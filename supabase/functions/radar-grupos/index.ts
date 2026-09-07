import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getSupabaseAdmin,
  verifyUser,
  extractGroupSlug,
  groupUrlFromSlug,
  duckDuckGoSearch,
  fetchGroupMetadata,
  pool,
} from "../_shared/radar.ts";

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Ctx = {
  user: { id: string };
  url: URL;
  body: Record<string, unknown>;
};

const MAX_PER_SEARCH = 80;
const FB_FETCH_CONCURRENCY = 5;
const FB_DELAY_MS = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const user = await verifyUser(req);
    if (!user) return jsonRes({ error: "Unauthorized" }, 401);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "search";
    const body = await req.json().catch(() => ({}));

    const ctx: Ctx = { user: { id: user.id }, url, body };
    switch (action) {
      case "search":
        return await searchAction(ctx);
      case "import":
        return await importAction(ctx);
      case "recheck":
        return await recheckAction(ctx);
      case "history":
        return await historyAction(ctx);
      default:
        return jsonRes({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("[radar-grupos]", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return jsonRes({ error: msg, success: false }, 500);
  }
});

type DiscoveredGroup = {
  slug: string;
  url: string;
  name: string | null;
  description: string | null;
  member_count: number | null;
  member_raw: string | null;
  is_public: boolean | null;
  source: string;
  term: string;
  reached: boolean;
};

// Expand a user query into several search terms (niche + synonyms).
function buildTerms(body: Record<string, unknown>): string[] {
  const main = String(body.q || "").trim();
  const extra = Array.isArray(body.terms) ? body.terms.map((t) => String(t).trim()).filter(Boolean) : [];
  const terms = [...new Set([main, ...extra].map((t) => t.trim()).filter(Boolean))];
  return terms.slice(0, 12);
}

async function searchAction(ctx: Ctx): Promise<Response> {
  const terms = buildTerms(ctx.body);
  if (terms.length === 0) {
    return jsonRes({ error: "Informe uma palavra-chave para buscar.", success: false }, 400);
  }

  const admin = getSupabaseAdmin();
  const discovered = new Map<string, DiscoveredGroup>();

  // Phase 1 — keyword discovery through public web search (only publicly indexed groups).
  for (const term of terms) {
    const termQueries = [
      `site:facebook.com/groups "${term}" brasil`,
      `"${term}" facebook grupo brasil`,
    ];
    for (const query of termQueries) {
      const results = await duckDuckGoSearch(query, MAX_PER_SEARCH);
      for (const r of results) {
        const url = groupUrlFromSlug(r.slug);
        if (discovered.has(r.slug)) {
          if (!discovered.get(r.slug)!.term && term) discovered.get(r.slug)!.term = term;
          continue;
        }
        discovered.set(r.slug, {
          slug: r.slug,
          url,
          name: r.title || null,
          description: r.snippet || null,
          member_count: null,
          member_raw: null,
          is_public: null,
          source: "web_search",
          term,
          reached: false,
        });
      }
      await sleep(250);
    }
  }

  const slugs = [...discovered.keys()].slice(0, MAX_PER_SEARCH);

  // Phase 2 — enrichment: fetch public group pages to confirm data + member count.
  let index = 0;
  await pool(slugs, FB_FETCH_CONCURRENCY, async (slug) => {
    await sleep(index++ * FB_DELAY_MS);
    const meta = await fetchGroupMetadata(slug);
    const g = discovered.get(slug)!;
    if (meta.reached) {
      if (meta.name) g.name = meta.name;
      if (meta.description) g.description = meta.description;
      g.member_count = meta.member_count ?? g.member_count;
      g.member_raw = meta.member_raw ?? g.member_raw;
      g.is_public = meta.is_public ?? g.is_public;
      g.reached = true;
    }
  });

  const groups = [...discovered.values()];
  const result = await persistGroups(ctx, groups, terms);

  // Log the search into history.
  await admin.from("radar_buscas").insert({
    user_id: ctx.user.id,
    termo: terms[0],
    termos: terms,
    total_resultados: groups.length,
    total_grupos: result.total_unique,
  }).then(({ error }) => {
    if (error) console.error("[radar-grupos] historico", error);
  });

  return jsonRes(result, 200);
}

async function importAction(ctx: Ctx): Promise<Response> {
  const rawUrls = Array.isArray(ctx.body.urls)
    ? ctx.body.urls.map((u) => String(u).trim()).filter(Boolean)
    : [];
  if (rawUrls.length === 0) {
    return jsonRes({ error: "Cole pelo menos um link de grupo do Facebook.", success: false }, 400);
  }

  const groups: DiscoveredGroup[] = [];
  const seen = new Set<string>();
  let i = 0;
  await pool(rawUrls, 3, async (rawUrl) => {
    await sleep(i++ * 300);
    const slug = extractGroupSlug(rawUrl);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    const meta = await fetchGroupMetadata(slug);
    groups.push({
      slug,
      url: groupUrlFromSlug(slug),
      name: meta.name || slug,
      description: meta.description,
      member_count: meta.member_count,
      member_raw: meta.member_raw,
      is_public: meta.is_public,
      source: "importado",
      term: "importado",
      reached: meta.reached,
    });
    await sleep(150);
  });

  const result = await persistGroups(ctx, groups, ["importado"]);
  return jsonRes(result, 200);
}

async function recheckAction(ctx: Ctx): Promise<Response> {
  const url = String(ctx.body.url || "");
  const slug = extractGroupSlug(url);
  if (!slug) return jsonRes({ error: "Link de grupo inválido.", success: false }, 400);

  const meta = await fetchGroupMetadata(slug);
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("radar_grupos")
    .select("*")
    .or(`url.eq.${groupUrlFromSlug(slug)},${slug.match(/^\d+$/) ? `fb_id.eq.${slug}` : "fb_id.eq.null"}`)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (meta.reached) {
    if (meta.name) patch.name = meta.name;
    if (meta.description) patch.description = meta.description;
    if (meta.member_count != null) {
      patch.member_count = meta.member_count;
      patch.member_raw = meta.member_raw;
      patch.member_checked_at = new Date().toISOString();
    }
    if (meta.is_public != null) patch.is_public = meta.is_public;
  }

  if (existing) {
    await admin.from("radar_grupos").update(patch).eq("id", existing.id);
  } else {
    const { data: ins } = await admin
      .from("radar_grupos")
      .insert({
        url: groupUrlFromSlug(slug),
        name: meta.name || slug,
        description: meta.description,
        member_count: meta.member_count,
        member_raw: meta.member_raw,
        member_checked_at: meta.reached && meta.member_count != null ? new Date().toISOString() : null,
        is_public: meta.is_public,
        fontes: ["importado"],
        derivado_de: ["recheck"],
      })
      .select("id")
      .single();
    if (ins) await ensureUserRow(ctx.user.id, ins.id);
  }

  const group = await loadGroupsForUser(ctx.user.id, undefined, { slug });
  return jsonRes({ success: true, group: group[0] ?? null }, 200);
}

async function historyAction(ctx: Ctx): Promise<Response> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("radar_buscas")
    .select("*")
    .eq("user_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(30);
  return jsonRes({ success: true, history: data ?? [] }, 200);
}

async function persistGroups(
  ctx: Ctx,
  groups: DiscoveredGroup[],
  terms: string[],
): Promise<{
  success: boolean;
  total_unique: number;
  total_cache_new: number;
  confirmed_count: number;
  unconfirmed_count: number;
  groups: any[];
}> {
  const admin = getSupabaseAdmin();
  const urls = [...new Set(groups.map((g) => g.url))];
  const io = new Date().toISOString();

  // Currently stored copies (to keep dedup server-side, avoid duplicates across searches).
  const { data: existing } = await admin
    .from("radar_grupos")
    .select("id, url, fb_id, name, member_count, fontes, derivado_de, member_raw")
    .in("url", urls);

  const byUrl = new Map((existing ?? []).map((r: any) => [r.url, r]));
  const inserted: any[] = [];
  const updated: any[] = [];

  for (const g of groups) {
    const cur = byUrl.get(g.url);
    const fbId = g.slug.match(/^\d+$/) ? g.slug : null;
    if (!cur) {
      const { data: row, error } = await admin
        .from("radar_grupos")
        .insert({
          fb_id: fbId,
          url: g.url,
          name: g.name || g.slug,
          description: g.description,
          categoria: g.term && g.term !== "importado" ? g.term : null,
          member_count: g.member_count,
          member_raw: g.member_raw,
          member_checked_at: g.reached && g.member_count != null ? io : null,
          is_public: g.is_public,
          fontes: [g.source],
          derivado_de: [...new Set([g.term, ...terms]).filter((t) => Boolean(t))],
        })
        .select("id, url, name, description, categoria, member_count, member_raw, is_public, fontes, derivado_de, member_checked_at, created_at, updated_at")
        .single();
      if (error) {
        console.error("[radar-grupos] insert", error.message);
        continue;
      }
      byUrl.set(g.url, row as any);
      inserted.push(row);
    } else {
      const patch: Record<string, unknown> = { updated_at: io };
      let changed = false;
      const fonts = new Set<string>([...((cur.fontes ?? []) as string[]), g.source]);
      const termsAll = new Set<string>([...((cur.derivado_de ?? []) as string[]), ...terms.filter(Boolean)]);
      if (JSON.stringify(cur.fontes ?? []) !== JSON.stringify([...fonts])) {
        patch.fontes = [...fonts];
        changed = true;
      }
      if (JSON.stringify(cur.derivado_de ?? []) !== JSON.stringify([...termsAll])) {
        patch.derivado_de = [...termsAll];
        changed = true;
      }
      if (!cur.name && g.name) (patch as any).name = g.name;
      if (g.member_count != null && (cur.member_count == null || !cur.member_raw)) {
        patch.member_count = g.member_count;
        patch.member_raw = g.member_raw;
        patch.member_checked_at = io;
        changed = true;
      }
      if (cur.member_count == null && g.description) patch.description = g.description;
      if (changed) {
        await admin.from("radar_grupos").update(patch).eq("id", cur.id).then(({ error }) => {
          if (error) console.error("[radar-grupos] update", error.message);
        });
      }
      updated.push(cur);
    }
  }

  // Attach each discovered group to the user's workspace.
  const allRows = [...inserted].map((r: any) => r.id);
  for (const cur of updated) allRows.push(cur.id);
  const groupIds = [...new Set(allRows)];
  await ensureUserRows(ctx.user.id, groupIds);

  const confirmedCount = groups.filter((g) => g.member_count != null).length;
  const resultGroups = await loadGroupsByIds(ctx.user.id, groupIds);

  return {
    success: true,
    total_unique: groupIds.length,
    total_cache_new: inserted.length,
    confirmed_count: confirmedCount,
    unconfirmed_count: groups.length - confirmedCount,
    groups: resultGroups,
  };
}

async function ensureUserRows(userId: string, groupIds: string[]) {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("radar_grupo_usuario")
    .select("grupo_id")
    .eq("user_id", userId)
    .in("grupo_id", groupIds);
  const have = new Set((existing ?? []).map((r: any) => r.grupo_id));
  const toInsert = groupIds.filter((id) => !have.has(id));
  if (toInsert.length > 0) {
    await admin
      .from("radar_grupo_usuario")
      .insert(toInsert.map((grupo_id) => ({ user_id: userId, grupo_id })))
      .then(({ error }) => {
        if (error) console.error("[radar-grupos] attach", error.message);
      });
  }
}

async function ensureUserRow(userId: string, groupId: string) {
  await ensureUserRows(userId, [groupId]);
}

async function loadGroupsByIds(userId: string, groupIds: string[]): Promise<any[]> {
  if (groupIds.length === 0) return [];
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("radar_grupos")
    .select("*, radar_grupo_usuario!inner(*)")
    .eq("radar_grupo_usuario.user_id", userId)
    .in("id", groupIds)
    .order("member_count", { ascending: false, nullsFirst: false });
  if (error) {
    console.error("[radar-grupos] loadByIds", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    ...r,
    status: r.radar_grupo_usuario?.[0]?.status ?? "salvo",
    favorito: r.radar_grupo_usuario?.[0]?.favorito ?? false,
    notas: r.radar_grupo_usuario?.[0]?.notas ?? null,
    tags: r.radar_grupo_usuario?.[0]?.tags ?? [],
    permite_divulgacao: r.radar_grupo_usuario?.[0]?.permite_divulgacao ?? false,
    radar_grupo_usuario: undefined,
  }));
}

async function loadGroupsForUser(
  userId: string,
  _term?: string,
  where?: { slug?: string },
): Promise<any[]> {
  const admin = getSupabaseAdmin();
  let q = admin
    .from("radar_grupos")
    .select("*, radar_grupo_usuario!inner(*)")
    .eq("radar_grupo_usuario.user_id", userId)
    .order("member_count", { ascending: false, nullsFirst: false });
  if (where?.slug) {
    q = q.or(`url.eq.${groupUrlFromSlug(where.slug)}`);
  }
  const { data, error } = await q;
  if (error) {
    console.error("[radar-grupos] load", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    ...r,
    status: r.radar_grupo_usuario?.[0]?.status ?? "salvo",
    favorito: r.radar_grupo_usuario?.[0]?.favorito ?? false,
    notas: r.radar_grupo_usuario?.[0]?.notas ?? null,
    tags: r.radar_grupo_usuario?.[0]?.tags ?? [],
    permite_divulgacao: r.radar_grupo_usuario?.[0]?.permite_divulgacao ?? false,
    radar_grupo_usuario: undefined,
  }));
}