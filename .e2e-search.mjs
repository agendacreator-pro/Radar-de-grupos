import { toJSONAsync, fromCrossJSON } from "seroval";

const BASE = process.env.BASE;
const PUB = process.env.PUB;
const SRV = process.env.SRV;
const EMAIL = "radar-e2e-opencode@example.com";
const PASS = "RadarTeste#2026Opencode";
const SEARCH_ID = "3418f35567b0debd6167000a6f3c17406dddac5fe4273696385e9dbd31b69b86";
const FN_BASE = "https://radar-de-grupos.meellcriativa.workers.dev/_serverFn";
const HEADERS = {
  "content-type": "application/json",
  "x-tsr-serverFn": "true",
  accept: "application/json",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  Origin: "https://radar-de-grupos.meellcriativa.workers.dev",
};

async function callFn(id, data) {
  const body = JSON.stringify(await toJSONAsync({ data }));
  const r = await fetch(`${FN_BASE}/${id}`, { method: "POST", headers: HEADERS, body });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: { raw: t } }; }
}

const c = await fetch(`${BASE}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }),
});
await c.json().catch(() => {});
const s = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: PUB, Authorization: `Bearer ${PUB}`, "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
const sj = await s.json().catch(() => null);
if (!sj?.access_token) { console.log("[signin] FAIL", s.status); process.exit(1); }
console.log("[signin] ok");

const search = await callFn(SEARCH_ID, { q: "papelaria personalizada", terms: [], token: sj.access_token });
const out = fromCrossJSON(search.body, { plugins: [] });
if (!out.result) { console.log("[search] no result", JSON.stringify(out).slice(0, 1000)); process.exit(1); }
const r = out.result;
if (!r.success) {
  console.log("[search] FAIL full:", JSON.stringify(r).slice(0, 2000));
  process.exit(1);
}
console.log(`[search] success=${r.success} total=${r.total_unique} new=${r.total_cache_new} confirmed=${r.confirmed_count} unconfirmed=${r.unconfirmed_count} sources_ok=${r.sources_ok} budget_hit=${r.budget_hit} elapsed=${r.elapsed_ms}`);
console.log(`[search] failures=${JSON.stringify(r.source_failures)}`);
const groups = r.groups ?? [];
const withCount = groups.filter((g) => g.member_count != null);
const big = groups.filter((g) => g.member_count != null && g.member_count >= 100000);
console.log(`[search] grupos=${groups.length} com_membros=${withCount.length} >=100K=${big.length}`);
console.log("[search] TOP 10 por membros:");
groups.slice().sort((a, b) => (b.member_count ?? -1) - (a.member_count ?? -1)).slice(0, 10).forEach((g, i) => {
  console.log(`  ${i + 1}. ${g.member_count ?? "?"} | ${g.name} | ${g.url} | raw="${g.member_raw ?? ""}"`);
});
console.log("[search] termo_principal=", r.terms_used?.[0], " terms=", r.terms_used?.length);