import { useEffect, useMemo } from "react";
import { AlertTriangle, Bot, Check, ClipboardCopy, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { INSTA_AI_LOADING_MESSAGE } from "@/lib/instagram-ai";
import type { AISlide, GeneratedContent } from "@/lib/instagram-ai";
import { useInstagramAi } from "@/hooks/useInstagramAi";
import type { ContentBlueprintPayload } from "@/lib/instagram-content";

// ------------------------------------------------------------
// "✨ Gerar conteúdo completo com IA" — dialog com o resultado
// ------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </div>
  );
}

function buildPlainText(c: GeneratedContent): string {
  const lines: string[] = [];
  lines.push("🧩 Conteúdo gerado por IA — Radar do Algoritmo");
  if (c.title) lines.push(`\nTÍTULO\n${c.title}`);
  if (c.idea) lines.push(`\nIDEIA\n${c.idea}`);
  if (c.hook) lines.push(`\nGANCHO\n${c.hook}`);
  if (c.content) lines.push(`\nCONTEÚDO\n${c.content}`);
  if (c.script?.length) {
    lines.push("\nROTEIRO");
    for (const s of c.script) lines.push(`• ${s.scene}: ${s.text}`);
  }
  if (c.slides?.length) {
    lines.push("\nSLIDES");
    for (const s of c.slides)
      lines.push(`• ${s.slide}${s.title ? ` — ${s.title}` : ""}: ${s.text}`);
  }
  if (c.stories?.length) {
    lines.push("\nSTORIES");
    for (const s of c.stories)
      lines.push(`• ${s.story}${s.interaction ? ` (interação: ${s.interaction})` : ""}: ${s.text}`);
  }
  if (c.caption) lines.push(`\nLEGENDA\n${c.caption}`);
  if (c.cta) lines.push(`\nCTA\n${c.cta}`);
  if (c.keywords.length) lines.push(`\nPALAVRAS-CHAVE\n${c.keywords.join(", ")}`);
  if (c.visualDirection.length) lines.push(`\nDIREÇÃO VISUAL\n${c.visualDirection.join("\n")}`);
  if (c.notes) lines.push(`\nNOTAS\n${c.notes}`);
  return lines.join("\n");
}

export function AiContentGeneratorDialog({
  open,
  payload,
  onOpenChange,
}: {
  open: boolean;
  payload: ContentBlueprintPayload | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, run, reset } = useInstagramAi();

  // Gera assim que o dialog abre com um payload definido.
  useEffect(() => {
    if (open && payload) void run(payload);
  }, [open, payload, run]);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const plainText = useMemo(
    () => (state.status === "done" ? buildPlainText(state.content) : ""),
    [state],
  );

  const copiarTudo = async () => {
    if (!plainText) return;
    try {
      await navigator.clipboard.writeText(plainText);
      toast.success("Conteúdo copiado.");
    } catch {
      toast.error("Não foi possível copiar automaticamente.");
    }
  };

  const g = state.status === "done" ? state.content : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-[#E1306C]/10 text-[#C13584]">
              <Bot className="size-5" />
            </span>
            Gerar conteúdo completo
          </DialogTitle>
          <DialogDescription>
            Conteúdo original gerado por IA a partir dos sinais REAIS do Radar (nicho, objetivo,
            formato e evidências) — revise antes de publicar.
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-[#E1306C]/10 text-[#C13584]">
              <Wand2 className="size-6 animate-pulse" />
            </div>
            <p className="text-sm font-medium text-foreground">{INSTA_AI_LOADING_MESSAGE}</p>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-4 text-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="text-sm">
                <p className="font-semibold">Não foi possível gerar.</p>
                <p className="mt-0.5 text-xs">{state.message}</p>
                {!state.configurada && (
                  <p className="mt-1.5 text-xs">
                    A chave de IA ainda não está configurada no servidor do Radar (segredo no
                    Worker). Quando estiver ativa, a geração passa a funcionar — nenhuma resposta é
                    fabricada enquanto isso.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {payload && (
                <Button size="sm" variant="outline" onClick={() => void run(payload)}>
                  <RefreshCw className="size-4" />
                  Tentar de novo
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          </div>
        )}

        {state.status === "done" && g && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Sparkles className="size-4 text-[#E1306C]" />
              <p className="text-sm font-bold text-foreground">Seu conteúdo</p>
              <div className="ml-auto flex items-center gap-1.5">
                <Badge variant="outline">{g.format}</Badge>
                {g.subformat && <Badge variant="secondary">{g.subformat}</Badge>}
                <Badge variant="secondary">{state.usedModel}</Badge>
              </div>
            </div>

            {g.title && (
              <Block title="Título">
                <p className="text-base font-bold text-foreground">{g.title}</p>
              </Block>
            )}

            {g.idea && (
              <Block title="Ideia">
                <p className="text-sm text-foreground">{g.idea}</p>
              </Block>
            )}

            {g.hook && (
              <Block title="Gancho">
                <p className="text-sm text-foreground">{g.hook}</p>
              </Block>
            )}

            {g.content && (
              <Block title="Conteúdo">
                <p className="whitespace-pre-wrap text-sm text-foreground">{g.content}</p>
              </Block>
            )}

            {g.script && g.script.length > 0 && (
              <Block title="Roteiro">
                <ol className="list-decimal space-y-1.5 pl-5">
                  {g.script.map((s, i) => (
                    <li key={`${s.scene}-${i}`} className="text-sm text-foreground">
                      <strong className="font-semibold">{s.scene}:</strong> {s.text}
                    </li>
                  ))}
                </ol>
              </Block>
            )}

            {g.slides && g.slides.length > 0 && (
              <Block title="Slides">
                <ol className="space-y-2">
                  {g.slides.map((s: AISlide, i: number) => (
                    <li key={`${s.slide}-${i}`} className="rounded-md bg-muted/40 px-2 py-1.5">
                      <p className="text-xs font-bold uppercase tracking-wide text-[#C13584]">
                        {s.slide}
                        {s.title ? ` — ${s.title}` : ""}
                      </p>
                      <p className="mt-0.5 text-sm text-foreground">{s.text}</p>
                    </li>
                  ))}
                </ol>
              </Block>
            )}

            {g.stories && g.stories.length > 0 && (
              <Block title="Stories">
                <ol className="space-y-2">
                  {g.stories.map((s, i) => (
                    <li key={`${s.story}-${i}`} className="rounded-md bg-muted/40 px-2 py-1.5">
                      <p className="text-xs font-bold uppercase tracking-wide text-[#C13584]">
                        {s.story}
                        {s.interaction ? (
                          <Badge variant="secondary" className="ml-1.5">
                            interação: {s.interaction}
                          </Badge>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-sm text-foreground">{s.text}</p>
                    </li>
                  ))}
                </ol>
              </Block>
            )}

            {g.caption && (
              <Block title="Legenda">
                <p className="whitespace-pre-wrap text-sm text-foreground">{g.caption}</p>
              </Block>
            )}

            {g.cta && (
              <Block title="CTA">
                <p className="text-sm font-semibold text-foreground">{g.cta}</p>
              </Block>
            )}

            {g.keywords.length > 0 && (
              <Block title="Palavras-chave">
                <div className="flex flex-wrap gap-1.5">
                  {g.keywords.map((k) => (
                    <Badge key={k} variant="outline">
                      {k}
                    </Badge>
                  ))}
                </div>
              </Block>
            )}

            {g.visualDirection.length > 0 && (
              <Block title="Direção visual">
                <ul className="list-disc space-y-1 pl-5">
                  {g.visualDirection.map((v) => (
                    <li key={v} className="text-sm text-foreground">
                      {v}
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            {g.notes && (
              <Block title="Notas">
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{g.notes}</p>
              </Block>
            )}

            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
              Conteúdo gerado por IA a partir dos sinais realmente observados pelo Radar. Revise,
              adapte à sua marca e confirme as regras antes de publicar. Nenhuma métrica foi
              inventada e nenhum resultado é garantido.
            </p>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  if (payload) {
                    onOpenChange(false);
                    onOpenChange(true);
                    void run(payload, { variation: "variação alternativa" });
                  }
                }}
              >
                <RefreshCw className="size-4" />
                Gerar outra versão
              </Button>
              <Button
                className="bg-gradient-to-r from-fuchsia-600 via-pink-600 to-orange-500 text-white hover:from-fuchsia-700 hover:via-pink-700 hover:to-orange-600"
                onClick={() => void copiarTudo()}
              >
                <ClipboardCopy className="size-4" />
                Copiar tudo
              </Button>
            </div>
          </div>
        )}

        {state.status === "idle" && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Check className="size-4" />
            Aguardando. Selecione a tendência e o objetivo para gerar.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
