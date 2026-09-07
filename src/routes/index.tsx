import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Radar } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Radar de Grupos" }],
  }),
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading) navigate({ to: session ? "/painel/grupos" : "/auth" });
  }, [loading, session, navigate]);

  return (
    <div className="grid min-h-screen place-items-center">
      <div className="text-center">
        <Radar className="mx-auto size-10 animate-pulse text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">Carregando Radar de Grupos…</p>
      </div>
    </div>
  );
}