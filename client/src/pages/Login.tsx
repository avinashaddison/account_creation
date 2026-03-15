import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Shield, ArrowRight, Fingerprint } from "lucide-react";
import { sounds } from "@/lib/sounds";

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
        sounds.error();
        setError(data.error || "Login failed");
        return;
      }

      sounds.success();
      onLogin(data);
    } catch {
      sounds.error();
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: 'linear-gradient(145deg, #08081a 0%, #0d0d24 40%, #0a0a1a 100%)' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-40%] left-[-20%] w-[80%] h-[80%] rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-30%] right-[-10%] w-[60%] h-[60%] rounded-full opacity-[0.03]" style={{ background: 'radial-gradient(circle, #a855f7 0%, transparent 70%)' }} />
        <div className="absolute top-[20%] right-[15%] w-1 h-1 rounded-full bg-violet-400/30 animate-glow" />
        <div className="absolute top-[60%] left-[20%] w-1.5 h-1.5 rounded-full bg-purple-400/20 animate-glow" style={{ animationDelay: '1s' }} />
        <div className="absolute top-[30%] left-[60%] w-0.5 h-0.5 rounded-full bg-indigo-400/30 animate-glow" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative w-full max-w-[420px] mx-4 animate-float-up">
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-violet-500/20 via-transparent to-purple-500/10 opacity-50" />

        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, rgba(15,15,35,0.95) 0%, rgba(10,10,25,0.98) 100%)', border: '1px solid rgba(139, 92, 246, 0.12)' }} data-testid="card-login">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

          <div className="px-8 pt-10 pb-2 text-center">
            <div className="relative mx-auto w-16 h-16 mb-6">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-600/30 to-purple-700/30 blur-xl animate-glow" />
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center shadow-lg shadow-violet-900/40">
                <Fingerprint className="w-8 h-8 text-white/90" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight" data-testid="text-login-title">
              Addison Panel
            </h1>
            <p className="text-sm text-zinc-500 mt-2 flex items-center justify-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-violet-400/60" />
              Secure Admin Access
            </p>
          </div>

          <div className="px-8 pb-8 pt-4">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider pl-1">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@la28panel.com"
                  required
                  className="h-11 bg-white/[0.03] border-white/[0.06] text-white placeholder:text-zinc-600 rounded-xl focus:border-violet-500/40 focus:ring-violet-500/20 transition-all"
                  data-testid="input-login-email"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider pl-1">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  className="h-11 bg-white/[0.03] border-white/[0.06] text-white placeholder:text-zinc-600 rounded-xl focus:border-violet-500/40 focus:ring-violet-500/20 transition-all"
                  data-testid="input-login-password"
                />
              </div>

              {error && (
                <div className="text-sm text-red-300 bg-red-500/8 border border-red-500/15 px-4 py-2.5 rounded-xl" data-testid="text-login-error">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-12 text-sm font-semibold rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 border-0 shadow-lg shadow-violet-900/30 transition-all duration-200 group"
                disabled={loading}
                data-testid="button-login"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 pt-5 border-t border-white/[0.04]">
              <p className="text-center text-[11px] text-zinc-600">
                Protected by enterprise-grade encryption
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
