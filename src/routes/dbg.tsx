import { createFileRoute } from "@tanstack/react-router";
import { ddgSnippetStructure, probeEgress } from "@/lib/radar-egress";

export const Route = createFileRoute("/dbg")({
  loader: async () => {
    try {
      const [egress, snippets] = await Promise.all([probeEgress(), ddgSnippetStructure()]);
      return { egress, snippets };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
  component: DbgPage,
});

function DbgPage() {
  const data = Route.useLoaderData();
  return <pre className="whitespace-pre-wrap p-4 text-xs">{JSON.stringify(data, null, 2)}</pre>;
}