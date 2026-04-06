import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowRight, Lock } from "lucide-react";

type LoginProps = {
  onLogin: (user: { id: string; username: string; email: string; role: string }) => void;
};

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid credentials");
        return;
      }
      onLogin(data);
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090e] px-4">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #10b981 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-[-15%] right-[-10%] w-[40%] h-[40%] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(circle, #6366f1 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative w-full max-w-[380px]">
        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
            <span className="text-emerald-400 text-xl font-bold">A</span>
          </div>
          <h1 className="text-[22px] font-semibold text-white tracking-tight" data-testid="text-login-title">
            Addison Panel
          </h1>
          <p className="text-sm text-white/35 mt-1.5">Sign in to your account</p>
        </div>

        {/* Card */}
        <div
          className="rounded-xl p-6 space-y-4"
          style={{
            background: "#0e0e16",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
          data-testid="card-login"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-white/50">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="h-10 bg-white/[0.04] border-white/10 text-white placeholder:text-white/20 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/40"
                data-testid="input-login-email"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-white/50">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="h-10 bg-white/[0.04] border-white/10 text-white placeholder:text-white/20 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/40"
                data-testid="input-login-password"
              />
            </div>

            {error && (
              <div
                className="text-[13px] text-red-400 bg-red-500/8 border border-red-500/15 px-3 py-2.5 rounded-md"
                data-testid="text-login-error"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-10 bg-emerald-500 hover:bg-emerald-600 text-white font-medium text-[13px] rounded-md transition-colors"
              disabled={loading}
              data-testid="button-login"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </form>

          <div className="flex items-center justify-center gap-1.5 pt-1">
            <Lock className="w-3 h-3 text-white/15" />
            <span className="text-[11px] text-white/20">Secure connection</span>
          </div>
        </div>
      </div>
    </div>
  );
}
