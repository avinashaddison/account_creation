import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowRight, Terminal, Lock, Cpu, Wifi, Shield } from "lucide-react";
import { sounds } from "@/lib/sounds";

type LoginProps = {
  onLogin: (user: { id: string; username: string; email: string; role: string }) => void;
};

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootReady, setBootReady] = useState(false);
  const [bootLines, setBootLines] = useState<string[]>([]);

  useEffect(() => {
    const lines = [
      "[SYS] Initializing secure connection...",
      "[NET] Establishing encrypted tunnel...",
      "[AUTH] Loading authentication module...",
      "[OK] System ready.",
    ];
    let i = 0;
    const timer = setInterval(() => {
      if (i < lines.length) {
        setBootLines((prev) => [...prev, lines[i]]);
        i++;
      } else {
        clearInterval(timer);
        setTimeout(() => setBootReady(true), 100);
      }
    }, 150);
    return () => clearInterval(timer);
  }, []);

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
        setError(data.error || "Authentication failed");
        return;
      }

      sounds.success();
      onLogin(data);
    } catch {
      sounds.error();
      setError("Connection error. Retry sequence.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden cyber-grid" style={{ background: '#0a0a0a' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-30%] left-[-15%] w-[60%] h-[60%] rounded-full opacity-[0.1]" style={{ background: 'radial-gradient(circle, #00ff41 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full opacity-[0.07]" style={{ background: 'radial-gradient(circle, #ffb000 0%, transparent 70%)' }} />
        <div className="absolute top-[15%] right-[20%] w-1 h-1 rounded-full bg-emerald-400/50 animate-glow" />
        <div className="absolute top-[65%] left-[15%] w-1.5 h-1.5 rounded-full bg-amber-400/30 animate-glow" style={{ animationDelay: '1s' }} />
        <div className="absolute top-[35%] left-[65%] w-0.5 h-0.5 rounded-full bg-emerald-400/40 animate-glow" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-[25%] left-[40%] w-1 h-1 rounded-full bg-emerald-400/20 animate-glow" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="absolute inset-0 scan-line pointer-events-none" />

      <div className={`relative w-full max-w-[440px] mx-4 transition-all duration-700 ${bootReady ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="absolute -inset-px rounded-xl bg-gradient-to-b from-emerald-500/20 via-transparent to-emerald-500/10 opacity-60" />

        <div className="relative cyber-card rounded-xl" data-testid="card-login">
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent" />

          <div className="px-8 pt-6 pb-1">
            <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-400/40 mb-6">
              <Wifi className="w-3 h-3" />
              <span>SECURE CHANNEL ACTIVE</span>
              <span className="flex-1" />
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-glow" />
              <span className="text-emerald-400/60">ONLINE</span>
            </div>

            <div className="flex flex-col items-center mb-6">
              <div className="relative mb-4">
                <div className="absolute inset-0 rounded-xl bg-emerald-500/20 blur-xl animate-glow" />
                <div className="relative w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.15) 0%, rgba(255,176,0,0.15) 100%)', border: '1px solid rgba(0,255,65,0.3)' }}>
                  <Terminal className="w-7 h-7 text-emerald-400" />
                </div>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-white font-mono" data-testid="text-login-title">
                ADDISON<span className="text-emerald-400">_</span>PANEL
              </h1>
              <div className="flex items-center gap-2 mt-2">
                <div className="h-px w-8 bg-gradient-to-r from-transparent to-emerald-400/30" />
                <p className="text-[10px] text-emerald-400/50 font-mono uppercase tracking-[0.2em] flex items-center gap-1.5">
                  <Lock className="w-3 h-3" />
                  Terminal Access v3.0
                </p>
                <div className="h-px w-8 bg-gradient-to-l from-transparent to-emerald-400/30" />
              </div>
            </div>
          </div>

          <div className="mx-6 mb-4 rounded-lg p-3 font-mono text-[10px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(0,255,65,0.12)' }}>
            {(bootLines || []).map((line, i) => (
              <div key={i} className={`${line?.includes('[OK]') ? 'text-emerald-400' : line?.includes('[SYS]') ? 'text-emerald-400/60' : line?.includes('[NET]') ? 'text-amber-400/60' : 'text-amber-400/60'}`}>
                {line}
              </div>
            ))}
            {bootReady && <div className="text-emerald-400 mt-1">{'>'} Awaiting credentials...<span className="inline-block w-1.5 h-3 bg-emerald-400 ml-1 animate-glow" /></div>}
          </div>

          <div className="px-8 pb-8 pt-2">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-emerald-400/50 uppercase tracking-[0.15em] pl-1 flex items-center gap-1.5">
                  <Shield className="w-3 h-3" /> Identity
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@addison.io"
                  required
                  className="h-11 bg-black/20 border-emerald-500/20 text-emerald-50 placeholder:text-zinc-500 rounded-lg font-mono text-sm focus:border-emerald-400/40 focus:ring-emerald-400/15 transition-all"
                  data-testid="input-login-email"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-emerald-400/50 uppercase tracking-[0.15em] pl-1 flex items-center gap-1.5">
                  <Cpu className="w-3 h-3" /> Passkey
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter passkey"
                  required
                  className="h-11 bg-black/20 border-emerald-500/20 text-emerald-50 placeholder:text-zinc-500 rounded-lg font-mono text-sm focus:border-emerald-400/40 focus:ring-emerald-400/15 transition-all"
                  data-testid="input-login-password"
                />
              </div>

              {error && (
                <div className="text-xs text-red-300 bg-red-500/8 border border-red-500/20 px-4 py-2.5 rounded-lg font-mono flex items-center gap-2" data-testid="text-login-error">
                  <span className="text-red-400">[ERR]</span> {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11 text-sm font-bold rounded-lg font-mono uppercase tracking-wider transition-all duration-300 group"
                style={{
                  background: 'linear-gradient(135deg, rgba(0,255,65,0.15) 0%, rgba(255,176,0,0.1) 100%)',
                  border: '1px solid rgba(0,255,65,0.3)',
                  color: '#00ff41',
                  boxShadow: '0 0 15px rgba(0,255,65,0.08)',
                }}
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
                    Initialize Session
                    <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-5 pt-4 border-t border-emerald-500/[0.06]">
              <p className="text-center text-[9px] text-emerald-400/25 font-mono uppercase tracking-wider">
                AES-256 Encrypted Channel
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
