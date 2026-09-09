// Classificação semântica de intenção de compra em publicações de grupos.
// O radar de oportunidades busca posts onde o autor está PROCURANDO alguma
// coisa do nicho (buyer). Publicações de vendedores ("vendo", "promoção",
// "faço sob encomenda") são marcadas como anuncio_vendedor e ficam no fim
// da lista / não são destacadas.

export type OportunidadeTipo =
  "alta_compra" | "indicacao" | "duvida" | "potencial" | "anuncio_vendedor";

export type IntencaoResult = {
  tipo: OportunidadeTipo;
  score: number;
  justificativa: string;
};

type Rule = { tipo: OportunidadeTipo; re: RegExp; peso: number; label: string };

// Texto normalizado (sem acentos) para casar com regras em ASCII simples.
export function normalizeIntentText(raw: string): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Regras de compra (buyer) — sinais de quem está procurando/querendo comprar.
const COMPRA_RULES: Rule[] = [
  { tipo: "alta_compra", re: /\bprocuro\b/i, peso: 90, label: 'disse "procuro"' },
  { tipo: "alta_compra", re: /\bprocurando\b/i, peso: 88, label: "está procurando" },
  {
    tipo: "alta_compra",
    re: /\b(?:estou|estamos|to|to)?\s*a procura de\b/i,
    peso: 86,
    label: "à procura de",
  },
  {
    tipo: "alta_compra",
    re: /\bquero (?:comprar|encontrar|achar|saber onde)\b/i,
    peso: 92,
    label: "quer comprar/encontrar",
  },
  {
    tipo: "alta_compra",
    re: /\bquem (?:vende|faz|trabalha com|cria|produz|monta|fabrica|precisa)\b/i,
    peso: 88,
    label: "perguntou quem vende/faz",
  },
  {
    tipo: "alta_compra",
    re: /\balgu[eé]m (?:faz|vende|trabalha com|cria|produz|monta)\b/i,
    peso: 85,
    label: "perguntou se alguém faz/vende",
  },
  {
    tipo: "alta_compra",
    re: /\bpreciso de(?: um| uma| uma| algu[eé]m)?\b/i,
    peso: 86,
    label: "preciso de",
  },
  { tipo: "alta_compra", re: /\bpreciso comprar\b/i, peso: 90, label: "precisa comprar" },
  { tipo: "alta_compra", re: /\bprocuro fornecedor\b/i, peso: 94, label: "procura fornecedor" },
  { tipo: "alta_compra", re: /\bundeme\b/i, peso: 84, label: "busca indicação de quem faz" },
  {
    tipo: "alta_compra",
    re: /\bonde (?:compro|encontro|vendo|posso achar|achar)\b/i,
    peso: 84,
    label: "onde compro/encontro",
  },
  { tipo: "alta_compra", re: /\bquanto(s)? cust[ao]?\b/i, peso: 76, label: "perguntou preço" },
  {
    tipo: "alta_compra",
    re: /\b(?:vcs?|voc[eê]s?|me)\s+faz(?:em)?\b/i,
    peso: 80,
    label: "vocês fazem?",
  },
  { tipo: "indicacao", re: /\balgu[eé]m indica\b/i, peso: 80, label: "alguém indica" },
  { tipo: "indicacao", re: /\bme indica\b/i, peso: 78, label: "me indica" },
  { tipo: "indicacao", re: /\boutra(?:s)? indica\b/i, peso: 74, label: "alguém indica" },
  { tipo: "indicacao", re: /\bonde achar\b/i, peso: 76, label: "onde achar" },
  { tipo: "indicacao", re: /\bindoic[eê]o[ao]\b/i, peso: 72, label: "indicação" },
  { tipo: "indicacao", re: /\brecomenda[o]?\b/i, peso: 76, label: "recomendação" },
  { tipo: "indicacao", re: /\bonde comprar\b/i, peso: 82, label: "onde comprar" },
  { tipo: "duvida", re: /\bquanto custa\b/i, peso: 72, label: "preço" },
  { tipo: "duvida", re: /\bpre[cç]o de\b/i, peso: 66, label: "preço de" },
  { tipo: "duvida", re: /\bqual(?: o)? melhor\b/i, peso: 66, label: "qual o melhor" },
  { tipo: "duvida", re: /\bvale a pena\b/i, peso: 64, label: "vale a pena?" },
  { tipo: "duvida", re: /\bcomo funciona\b/i, peso: 62, label: "como funciona" },
];

// Regras de vendedor (seller) — sinais de quem está OFERECENDO, não comprando.
const VENDEDOR_RULES: RegExp[] = [
  /\bvendo\b/i,
  /\bvendendo\b/i,
  /\balugo\b|\balugo-se\b/i,
  /\btenho (?:para|pra) vender\b/i,
  /\btenho (?:para|pra) venda\b/i,
  /\bfa[çc]o sob (?:encomenda|pedido)\b/i,
  /\bsob encomenda\b/i,
  /\batendo (?:pelo|via)?\s*(?:whats|wpp|zap|contato)\b/i,
  /\bminha (?:lista|lojinha|loja)\b/i,
  /\bno (?:cat[áa]logo|catalogo)\b/i,
  /\bpromo[cç][aã]o\b/i,
  /\bentrego\b/i,
  /\bdivulgo\b/i,
  /\bencomende comigo\b/i,
  /\bsiga meu insta\b/i,
  /\bsegueme\b/i,
  /\bcha[mn]a no zap\b/i,
  /\baproveita\b/i,
  /\bficou interessado\b/i,
  /\bme chama\b/i,
];

function normalizeTextForMatch(...parts: string[]): string {
  const joined = parts.join(" ").slice(0, 2000);
  // Mantém o texto original (com acentos) para regex accent-aware.
  return normalizeIntentText(joined);
}

export function classifyIntention(...textParts: string[]): IntencaoResult {
  const base = normalizeTextForMatch(...textParts);
  const full = textParts.join(" ");

  // Prioridade 1: sinais de vendedor derrubam a classificação (não é buyer).
  const vendedorHits = VENDEDOR_RULES.filter((re) => re.test(base)).length;

  // Sinais de compra: combina regras; tipo vence pela palavra mais forte.
  const compraHits = COMPRA_RULES.filter((r) => r.re.test(base));
  const compraPeso = compraHits.reduce((acc, r) => acc + r.peso, 0);
  const labels = compraHits.map((r) => r.label);

  if (vendedorHits > 0 && compraHits.length === 0) {
    return {
      tipo: "anuncio_vendedor",
      score: 25,
      justificativa: 'Parece anúncio de vendedor (ex.: "vendo", "faço sob encomenda").',
    };
  }

  if (compraHits.length === 0) {
    // Sem sinais claros: só mantém se o texto menciona o nicho / pede algo.
    if (base.length > 60) {
      return {
        tipo: "potencial",
        score: 45,
        justificativa: "Sem frase clara de compra, mas conteúdo relevante ao nicho.",
      };
    }
    return {
      tipo: "anuncio_vendedor",
      score: 20,
      justificativa: "Conteúdo muito curto ou anúncio sem sinal de compra.",
    };
  }

  let tipo: OportunidadeTipo = "potencial";
  if (compraHits.some((r) => r.tipo === "alta_compra")) tipo = "alta_compra";
  else if (compraHits.some((r) => r.tipo === "indicacao")) tipo = "indicacao";
  else tipo = "duvida";

  let score = Math.min(98, Math.round(compraPeso / compraHits.length));
  // Quanto mais sinais de compra, mais "pronto pra bater o martelo".
  if (compraHits.length >= 2) score = Math.min(100, score + 6);
  // Sinais de vendedor ao mesmo tempo tornam a publicação ambígua.
  if (vendedorHits > 0) score = Math.max(20, score - (vendedorHits >= 2 ? 44 : 22));

  const justBase =
    labels.length > 0
      ? `Intenção de compra detectada — ${[...new Set(labels)].slice(0, 3).join("; ")}.`
      : "Possível intenção de compra.";
  const just =
    vendedorHits > 0
      ? `${justBase} Há também sinais de vendedor, confira antes de abordar.`
      : justBase;

  return { tipo, score, justificativa: just.slice(0, 220) };
}
