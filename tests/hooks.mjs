// Hook de resolução do alias "@/" para testes node:test com type-stripping.
// Uso: node --import ./tests/loader.mjs --test <arquivos>
//   (loader.mjs registra este módulo como hook de resolução)
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Resolve "@/lib/x" → "<repo>/src/lib/x.ts" (cidada a extensão real). */
export async function resolve(specifier, context, nextResolve) {
  const s = String(specifier);
  if (s.startsWith("@/")) {
    const rel = s.slice(2);
    const candidates = [
      join(src, rel),
      `${join(src, rel)}.ts`,
      `${join(src, rel)}.tsx`,
      join(src, rel, "index.ts"),
      join(src, rel, "index.tsx"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return nextResolve(pathToFileURL(c).href, context);
    }
    throw new Error(
      `[hooks] alias "@/" não resolveu: ${specifier} (importado de ${context?.parentURL ?? "?"})`,
    );
  }
  return nextResolve(specifier, context);
}