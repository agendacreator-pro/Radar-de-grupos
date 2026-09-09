import { toJSONAsync, fromCrossJSON } from "seroval";

const BASE = process.env.BASE;
const PUB = process.env.PUB;
const SRV = process.env.SRV;
const EMAIL = "radar-e2e-opencode@example.com";
const PASS = "RadarTeste#2026Opencode";
const FN_ID = "fc19c28287c92d84cf8ae6e90b4f181fbefabbd7c77ad17c04f43e05f16d4095";
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

// 0) Sem token: espera rejeição por sessão (teste de autorização).
const anon = await callFn(FN_ID, { q: "miolos de agenda", terms: [], token: "", groups: [] });
const anonOut = fromCrossJSON(anon.body, { plugins: [] });
console.log("[no-token] success=", anonOut.result?.success, " error=", anonOut.result?.error);
if (anonOut.result?.success !== false) { console.log("[no-token] FAIL: deveria rejeitar sem sessão"); process.exit(1); }

// 1) Cria/usuario + login.
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
if (!sj?.access_token) { console.log("[signin] FAIL", s.status, JSON.stringify(sj)); process.exit(1); }
console.log("[signin] ok");

// 2) Busca de oportunidades (fontes públicas).
const data = {
  q: "miolos de agenda",
  terms: ["agenda personalizada", "planner", "encadernação"],
  token: sj.access_token,
  groups: [],
};
const search = await callFn(FN_ID, data);
const out = fromCrossJSON(search.body, { plugins: [] });
if (!out.result) { console.log("[search] no result", JSON.stringify(out).slice(0, 1500)); process.exit(1); }
const r = out.result;
if (!r.success) {
  console.log("[search] FAIL full:", JSON.stringify(r).slice(0, 2500));
  process.exit(1);
}
console.log(`[search] success=${r.success} encontradas=${r.total_encontradas} salvas=${r.total_salvas} novas=${r.novas} anuncios_ignorados=${r.anuncios_ignorados}`);
console.log(`[search] por_tipo=${JSON.stringify(r.por_tipo)} sources_ok=${r.sources_ok} budget_hit=${r.budget_hit} target_mode=${r.target_mode} elapsed=${r.elapsed_ms}ms`);
console.log(`[search] failures=${JSON.stringify(r.source_failures)}`);
const opps = r.oportunidades ?? [];
console.log(`[search] opportunities=${opps.length} (todas devem ter tipo != anuncio_vendedor)`);
for (const g of opps.slice(0, 15)) {
  console.log(`  [${g.tipo_intencao}] score=${g.score} | ${g.nicho} | ${g.post_url} | grupo=${g.grupo_url}`);
  console.log(`      trecho="${(g.trecho ?? "").slice(0, 160)}" just="${g.justificativa ?? ""}"`);
}
const valid = opps.every((o) => /facebook\.com\/groups\/.+\/posts\/\d+/.test(o.post_url ?? ""));
console.log(`[validacao] URLs de posts válidas=${valid}`);
if (!valid) { console.log("[validacao] FAIL: há post_url fora do padrão esperado"); process.exit(1); }
const scored = opps.every((o) => Number.isFinite(o.score) && o.score >= 0 && o.score <= 100);
console.log(`[validacao] scores no intervalo 0-100=${scored}`);
if (opps.length > 0 && !scored) { console.log("[validacao] FAIL"); process.exit(1); }
console.log("[ok] e2e oportunidades concluído.");