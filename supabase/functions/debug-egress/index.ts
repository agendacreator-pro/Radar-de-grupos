import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchGroupMetadata } from "../_shared/radar.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const out: Record<string, unknown> = {};

  // 1. Common Crawl prefix listing — grab real slugs (incl. numeric ids)
  try {
    const coll = await (await fetch("https://index.commoncrawl.org/collinfo.json", {
      headers: { "User-Agent": UA },
    })).json();
    const ccid = coll[0].id;
    out.cc_index = ccid;
    const q = `https://index.commoncrawl.org/${ccid}-index?url=facebook.com%2Fgroups%2F&output=json&collapse=urlkey&fl=url,timestamp&page=0&pageSize=20`;
    const res = await fetch(q, { headers: { "User-Agent": UA } });
    out.cc_status = res.status;
    const text = await res.text();
    out.cc_sample = text.slice(0, 1000);
  } catch (e) {
    out.cc_error = e instanceof Error ? e.message : String(e);
  }

  // 2. Try fetching a real group page (need a slug; use a widely-known public group)
  const candidates = [
    "papelariacriativa",
    "sublimacaoearte",
  ];
  out.verify = [];
  for (const slug of candidates) {
    const meta = await fetchGroupMetadata(slug);
    out.verify.push({ slug, ...meta });
    await new Promise((r) => setTimeout(r, 800));
  }
  return jsonRes(out);
});