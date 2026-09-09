import { useEffect } from "react";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Loader2, LogOut, Radar, ShoppingBag } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/painel")({
  head: () => ({
    meta: [{ title: "Radar de Grupos" }, { name: "robots", content: "noindex" }],
  }),
  component: PainelLayout,
});

function PainelLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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

  const tabs = [
    { to: "/painel/grupos", label: "Grupos", icon: Radar },
    { to: "/painel/oportunidades", label: "Oportunidades", icon: ShoppingBag },
  ] as const;

  return (
    <div className="app-shell min-h-screen">
      <nav className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-1 px-5">
          {tabs.map((tab) => {
            const active =
              location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  "inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <tab.icon className="size-4" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
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
