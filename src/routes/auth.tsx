import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const REMEMBER_KEY = "radar_remember_email";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Radar de Grupos" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_KEY) !== null;
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleForgotPassword() {
    if (!email) {
      toast.error("Digite seu e-mail acima primeiro.");
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setResetSent(true);
      toast.success("E-mail de recuperação enviado!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar e-mail.");
    }
  }

  useEffect(() => {
    if (!loading && session) navigate({ to: "/painel/grupos" });
  }, [loading, session, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Login realizado!");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Conta criada! Verifique seu e-mail para confirmar.");
        setMode("login");
      }
      try {
        if (remember) {
          localStorage.setItem(REMEMBER_KEY, email);
        } else {
          localStorage.removeItem(REMEMBER_KEY);
        }
      } catch {
        /* ignore */
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao entrar";
      toast.error(
        message.includes("Invalid login") ? "E-mail ou senha incorretos." : message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell flex flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">
        {mode === "login" ? "Entrar" : "Criar conta"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {mode === "login"
          ? "Acesse a sua central de grupos."
          : "Crie seu acesso à central de grupos."}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-2xl border border-input bg-card px-4 py-3.5 text-base outline-none focus:border-primary"
            placeholder="voce@email.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Senha
          </label>
          <div className="relative mt-1.5">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-input bg-card px-4 py-3.5 pr-12 text-base outline-none focus:border-primary"
              placeholder="mínimo 6 caracteres"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </div>

        {mode === "login" && (
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="size-4 rounded border-border"
              />
              Lembrar meu e-mail
            </label>

            {resetSent ? (
              <p className="text-sm text-green-600">
                Verifique sua caixa de entrada e clique no link para redefinir sua senha.
              </p>
            ) : (
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-sm font-medium text-primary hover:underline"
              >
                Esqueci minha senha
              </button>
            )}
          </>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {mode === "login" ? "Entrar" : "Criar conta"}
        </button>
      </form>

      <div className="mt-8 text-center">
        <p className="text-sm text-muted-foreground">
          {mode === "login" ? "Ainda não tem conta?" : "Já tem conta?"}
        </p>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="mt-1 text-sm font-medium text-primary hover:underline"
        >
          {mode === "login" ? "Criar sua conta" : "Fazer login"}
        </button>
      </div>
    </main>
  );
}