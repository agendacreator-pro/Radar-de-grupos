import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let unsub: (() => void) | undefined;

    try {
      const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
        if (!active) return;
        setSession(next);
      });
      unsub = () => sub.subscription.unsubscribe();

      supabase.auth.getSession().then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setLoading(false);
      }).catch(() => {
        if (!active) return;
        setLoading(false);
      });
    } catch {
      setLoading(false);
    }

    return () => {
      active = false;
      unsub?.();
    };
  }, []);

  return { session, user: (session?.user ?? null) as User | null, loading };
}
