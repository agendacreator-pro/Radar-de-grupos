import { useEffect } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { Loader2, LogOut } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/painel")({
  head: () => ({
    meta: [{ title: "Radar de Grupos" }, { name: "robots", content: "noindex" }],
  }),
  component: PainelLayout,
});

function PainelLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="app-shell grid min-h-screen place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen">
      <Outlet />
      <button
        type="button"
        onClick={async () => {
          await supabase.auth.signOut();
          navigate({ to: "/auth" });
        }}
        title="Sair"
        className="fixed bottom-4 right-4 z-40 flex size-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-lg transition-colors hover:text-destructive"
      >
        <LogOut className="size-5" />
      </button>
    </div>
  );
}