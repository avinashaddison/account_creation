import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, CheckCircle2, XCircle, Zap, Terminal,
  DollarSign, Globe, Languages, Rocket, Clock, User, Mail,
  RefreshCw
} from "lucide-react";
import { subscribe } from "@/lib/ws";
import { useAccountPrice } from "@/lib/useAccountPrice";

type LogEntry = {
  accountId: string;
  message: string;
  timestamp: string;
};

type Registration = {
  id: string;
  email: string;
  emailPassword: string;
  firstName: string;
  lastName: string;
  la28Password: string;
  country: string;
  language: string;
  status: string;
  verificationCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
  registering: { label: "Registering", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  waiting_code: { label: "Waiting for Code", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  verifying: { label: "Verifying", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  verified: { label: "Verified", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  profile_saving: { label: "Saving Profile", color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
  draw_registering: { label: "Draw Registering", color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  completed: { label: "Completed", color: "bg-green-500/10 text-green-400 border-green-500/20" },
  failed: { label: "Failed", color: "bg-red-500/10 text-red-400 border-red-500/20" },
};

export default function Home() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("India");
  const accountPrice = useAccountPrice();
  const [language, setLanguage] = useState("English");
  const [isRunning, setIsRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollSinceRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchIdRef = useRef<string | null>(null);
  batchIdRef.current = batchId;

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    fetchRegistrations();
  }, []);

  async function fetchRegistrations() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/registrations", { credentials: "include" });
      if (res.status === 401) {
        const { handleUnauthorized } = await import("@/lib/auth");
        handleUnauthorized();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setRegistrations(data);
      }
    } catch {}
    setLoadingHistory(false);
  }

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === "log" && msg.batchId === batchIdRef.current) {
        setLogs((prev) => [...prev, { accountId: msg.accountId, message: msg.message, timestamp: msg.timestamp }]);
        if (msg.message.startsWith("Status: ")) {
          setCurrentStatus(msg.message.replace("Status: ", ""));
        }
      }
      if (msg.type === "account_update" && msg.account.id === currentAccountId) {
        setCurrentStatus(msg.account.status);
      }
      if (msg.type === "batch_complete" && msg.batchId === batchIdRef.current) {
        setIsRunning(false);
        fetchRegistrations();
      }
    });
    return unsub;
  }, [currentAccountId]);

  const pollForLogs = useCallback(async () => {
    const currentBatchId = batchIdRef.current;
    if (!currentBatchId) return;
    try {
      const res = await fetch(`/api/batch-logs/${currentBatchId}?since=${pollSinceRef.current}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.logs.length > 0) {
        setLogs((prev) => {
          const existingSet = new Set(prev.map((l) => `${l.timestamp}-${l.message}`));
          const newLogs = data.logs.filter(
            (l: LogEntry) => !existingSet.has(`${l.timestamp}-${l.message}`) && l.message !== "Batch complete"
          );
          return [...prev, ...newLogs];
        });
      }
      pollSinceRef.current = data.nextSince;
      if (data.accounts && data.accounts.length > 0) {
        setCurrentStatus(data.accounts[0].status);
      }
      if (data.isComplete) {
        setIsRunning(false);
        fetchRegistrations();
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (isRunning && batchId) {
      pollSinceRef.current = 0;
      const timer = setInterval(pollForLogs, 2000);
      pollTimerRef.current = timer;
      pollForLogs();
      return () => {
        clearInterval(timer);
        pollTimerRef.current = null;
      };
    }
  }, [isRunning, batchId, pollForLogs]);

  async function startRegistration() {
    if (!firstName.trim() || !lastName.trim() || !password.trim()) {
      setError("Please fill in all required fields");
      return;
    }

    setIsRunning(true);
    setLogs([]);
    setBatchId(null);
    setCurrentAccountId(null);
    setCurrentStatus("pending");
    setError(null);
    pollSinceRef.current = 0;

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), password: password.trim(), country, language }),
        credentials: "include",
      });
      if (res.status === 401) {
        const { handleUnauthorized } = await import("@/lib/auth");
        handleUnauthorized();
        return;
      }
      const data = await res.json();
      if (res.status === 403 || !res.ok) {
        setError(data.error || "Failed to start registration");
        setIsRunning(false);
        return;
      }
      setBatchId(data.batchId);
      setCurrentAccountId(data.account.id);
      setCurrentStatus("pending");
    } catch (err) {
      console.error(err);
      setError("Network error. Please try again.");
      setIsRunning(false);
    }
  }

  function generateRandomFields() {
    const firstNames = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda", "David", "Elizabeth"];
    const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Moore"];
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghjkmnpqrstuvwxyz";
    const digits = "23456789";
    const special = "!@#$%&*";
    const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
    let pwd = pick(upper) + pick(upper) + pick(lower) + pick(lower) + pick(lower)
      + pick(digits) + pick(digits) + pick(special) + pick(special);
    const all = upper + lower + digits;
    for (let i = 0; i < 5; i++) pwd += pick(all);
    const arr = pwd.split("");
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    setFirstName(firstNames[Math.floor(Math.random() * firstNames.length)]);
    setLastName(lastNames[Math.floor(Math.random() * lastNames.length)]);
    setPassword(arr.join(""));
  }

  const statusInfo = STATUS_LABELS[currentStatus] || STATUS_LABELS.pending;

  return (
    <div className="animate-float-up space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-white" data-testid="text-home-title">LA28 Registration</h1>
          <Badge className="bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/15 text-[10px]">Olympic ID</Badge>
        </div>
        <p className="text-zinc-500 text-sm mt-0.5">Create LA28 accounts with automated email verification</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl glass-panel bg-transparent border border-white/[0.04] p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 text-white">
                  <Rocket className="w-3.5 h-3.5" />
                </div>
                <span className="text-sm font-semibold text-zinc-200">Registration Form</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={generateRandomFields}
                disabled={isRunning}
                className="text-xs text-zinc-500 hover:text-zinc-300 h-7 px-2"
                data-testid="button-random-fill"
              >
                <Zap className="w-3 h-3 mr-1" /> Auto-fill
              </Button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-3 h-3" /> First Name
                  </Label>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="John"
                    disabled={isRunning}
                    className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300 placeholder:text-zinc-600"
                    data-testid="input-first-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-3 h-3" /> Last Name
                  </Label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    disabled={isRunning}
                    className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300 placeholder:text-zinc-600"
                    data-testid="input-last-name"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Mail className="w-3 h-3" /> Password
                </Label>
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Strong password (auto-generated)"
                  disabled={isRunning}
                  className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300 placeholder:text-zinc-600"
                  data-testid="input-password"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Globe className="w-3 h-3" /> Country
                  </Label>
                  <Input
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    disabled={isRunning}
                    className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300"
                    data-testid="input-country"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Languages className="w-3 h-3" /> Language
                  </Label>
                  <Input
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    disabled={isRunning}
                    className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300"
                    data-testid="input-language"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500 flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" /> Cost</span>
                  <span className="font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">${accountPrice.toFixed(2)}</span>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400" data-testid="text-error">
                  {error}
                </div>
              )}

              <Button
                className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 shadow-lg shadow-red-500/20 border-0"
                onClick={startRegistration}
                disabled={isRunning}
                data-testid="button-start-registration"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {statusInfo.label}...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Start Registration
                  </>
                )}
              </Button>

              {isRunning && (
                <div className="flex items-center gap-2 justify-center">
                  <Badge className={`${statusInfo.color} text-xs`} data-testid="badge-current-status">
                    {currentStatus === "pending" || currentStatus === "registering" || currentStatus === "waiting_code" || currentStatus === "verifying" || currentStatus === "profile_saving" || currentStatus === "draw_registering" ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : currentStatus === "verified" || currentStatus === "completed" ? (
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                    ) : currentStatus === "failed" ? (
                      <XCircle className="w-3 h-3 mr-1" />
                    ) : null}
                    {statusInfo.label}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 rounded-xl glass-panel bg-transparent border border-white/[0.04] p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300">
              <Terminal className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm font-semibold text-zinc-200">Live Progress</span>
          </div>

          <ScrollArea className="h-[380px] rounded-xl border border-white/[0.04] bg-[#07071a] p-4" data-testid="container-live-logs">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-sm gap-2">
                {isRunning ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-red-400" />
                    <span className="text-zinc-500">Starting registration...</span>
                  </>
                ) : (
                  <>
                    <Terminal className="w-8 h-8 text-zinc-800" />
                    <span className="text-zinc-600">Fill the form and click Start Registration</span>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-1 font-mono text-xs">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-2" data-testid={`log-entry-${i}`}>
                    <span className="text-zinc-700 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={
                      log.message.includes("Full flow complete") || log.message.includes("Draw registered") || log.message.includes("completed")
                        ? "text-green-400 font-semibold"
                        : log.message.includes("verified") || log.message.includes("successfully")
                        ? "text-emerald-400"
                        : log.message.includes("Failed") || log.message.includes("Error") || log.message.includes("Timed out")
                        ? "text-red-400"
                        : log.message.includes("code") || log.message.includes("Code")
                        ? "text-amber-400"
                        : log.message.includes("draw_registering") || log.message.includes("Draw") || log.message.includes("tickets.la28.org")
                        ? "text-violet-400"
                        : log.message.includes("profile_saving") || log.message.includes("Profile") || log.message.includes("Gigya")
                        ? "text-indigo-400"
                        : log.message.includes("Status:")
                        ? "text-red-400"
                        : "text-zinc-400"
                    }>
                      {log.message}
                    </span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      <div className="rounded-xl glass-panel bg-transparent border border-white/[0.04] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300">
              <Clock className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm font-semibold text-zinc-200">Registration History</span>
            <Badge className="bg-white/5 text-zinc-500 border-white/10 text-xs">{registrations.length}</Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchRegistrations}
            disabled={loadingHistory}
            className="text-xs text-zinc-500 hover:text-zinc-300 h-7 px-2"
            data-testid="button-refresh-history"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${loadingHistory ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {loadingHistory ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : registrations.length === 0 ? (
          <div className="text-center py-8 text-zinc-600 text-sm" data-testid="text-no-registrations">
            No registrations yet. Start your first one above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-registrations">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Email</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Name</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Password</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody>
                {registrations.slice(0, 50).map((reg) => {
                  const st = STATUS_LABELS[reg.status] || STATUS_LABELS.pending;
                  return (
                    <tr key={reg.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]" data-testid={`row-registration-${reg.id}`}>
                      <td className="py-2.5 px-3 text-zinc-300 font-mono text-xs">{reg.email}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{reg.firstName} {reg.lastName}</td>
                      <td className="py-2.5 px-3 text-zinc-500 font-mono text-xs">{reg.la28Password}</td>
                      <td className="py-2.5 px-3">
                        <Badge className={`${st.color} text-[10px]`}>
                          {(reg.status === "verified" || reg.status === "completed") && <CheckCircle2 className="w-3 h-3 mr-1" />}
                          {reg.status === "failed" && <XCircle className="w-3 h-3 mr-1" />}
                          {st.label}
                        </Badge>
                        {reg.errorMessage && (
                          <span className="block text-[10px] text-red-400/70 mt-0.5 max-w-[200px] truncate" title={reg.errorMessage}>
                            {reg.errorMessage}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 text-xs">{new Date(reg.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
