import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Settings2, Key, Send, CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { handleUnauthorized } from "@/lib/auth";

type TmSettingsData = {
  keyword: string;
  botToken: string;
  chatId: string;
  monitoringEnabled: boolean;
};

export default function TMSettings() {
  const { toast } = useToast();
  const [keyword, setKeyword] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [monitoringEnabled, setMonitoringEnabled] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  const { data, isLoading } = useQuery<TmSettingsData>({
    queryKey: ["/api/tm-discovery/settings"],
    queryFn: async () => {
      const res = await fetch("/api/tm-discovery/settings", { credentials: "include" });
      if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  useEffect(() => {
    if (data) {
      setKeyword(data.keyword);
      setBotToken(data.botToken);
      setChatId(data.chatId);
      setMonitoringEnabled(data.monitoringEnabled);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/tm-discovery/settings", { keyword, botToken, chatId, monitoringEnabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-discovery/settings"] });
      toast({ title: "Settings saved", description: "Ticketmaster monitoring settings updated." });
    },
    onError: () => toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" }),
  });

  async function testTelegram() {
    if (!botToken || !chatId) {
      toast({ title: "Missing fields", description: "Please enter Bot Token and Chat ID first.", variant: "destructive" });
      return;
    }
    setTestingTelegram(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/tm-discovery/test-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ botToken, chatId }),
      });
      const data = await res.json();
      setTestResult(data.success ? "success" : "error");
      toast({
        title: data.success ? "Test sent!" : "Test failed",
        description: data.success ? "Check your Telegram for the test message." : "Verify your bot token and chat ID.",
        variant: data.success ? "default" : "destructive",
      });
    } catch {
      setTestResult("error");
      toast({ title: "Error", description: "Failed to send test message.", variant: "destructive" });
    } finally {
      setTestingTelegram(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-400/50" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="relative">
          <div className="absolute inset-0 rounded-lg bg-emerald-400/10 blur-md" />
          <div className="relative w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.1) 0%, rgba(255,176,0,0.08) 100%)', border: '1px solid rgba(0,255,65,0.15)' }}>
            <Settings2 className="w-4 h-4 text-emerald-400" />
          </div>
        </div>
        <div>
          <h1 className="text-lg font-bold font-mono text-white">TM Settings</h1>
          <p className="text-xs text-zinc-500 font-mono">Configure event monitoring and alert delivery</p>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-500/[0.08] overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.02) 0%, rgba(0,0,0,0.4) 100%)' }}>
        <div className="px-5 py-3.5 border-b border-emerald-500/[0.08] flex items-center gap-2">
          <Key className="w-3 h-3 text-emerald-400/40" />
          <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">Event Monitoring</span>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1.5">Search Keyword</label>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. concert, NBA, Taylor Swift..."
              className="h-9 bg-black/30 border-emerald-500/10 text-zinc-200 placeholder:text-zinc-700 font-mono text-sm focus:border-emerald-500/30"
              data-testid="input-keyword"
            />
            <p className="text-[10px] font-mono text-zinc-700 mt-1.5">The system monitors events matching this keyword every 30 seconds</p>
          </div>
          <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-emerald-500/[0.06] bg-black/20">
            <div>
              <p className="text-[11px] font-mono text-zinc-400">Auto-Monitoring</p>
              <p className="text-[10px] font-mono text-zinc-700">Automatically detect new events and price changes</p>
            </div>
            <button
              onClick={() => setMonitoringEnabled((v) => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${monitoringEnabled ? "bg-emerald-500/40" : "bg-zinc-800"}`}
              data-testid="toggle-monitoring"
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${monitoringEnabled ? "translate-x-5 bg-emerald-400" : "translate-x-0 bg-zinc-600"}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-500/[0.08] overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.02) 0%, rgba(0,0,0,0.4) 100%)' }}>
        <div className="px-5 py-3.5 border-b border-emerald-500/[0.08] flex items-center gap-2">
          <Send className="w-3 h-3 text-emerald-400/40" />
          <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">Telegram Alerts</span>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1.5">Bot Token</label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCdef..."
                className="h-9 pr-9 bg-black/30 border-emerald-500/10 text-zinc-200 placeholder:text-zinc-700 font-mono text-sm focus:border-emerald-500/30"
                data-testid="input-bot-token"
              />
              <button onClick={() => setShowToken((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors">
                {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[10px] font-mono text-zinc-700 mt-1.5">Get this from @BotFather on Telegram</p>
          </div>
          <div>
            <label className="block text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1.5">Chat ID</label>
            <Input
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-100123456789 or @channelname"
              className="h-9 bg-black/30 border-emerald-500/10 text-zinc-200 placeholder:text-zinc-700 font-mono text-sm focus:border-emerald-500/30"
              data-testid="input-chat-id"
            />
            <p className="text-[10px] font-mono text-zinc-700 mt-1.5">Your Telegram chat/channel ID — use @userinfobot to find it</p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="ghost"
              className="h-8 px-4 text-[11px] font-mono border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30"
              onClick={testTelegram}
              disabled={testingTelegram}
              data-testid="button-test-telegram"
            >
              {testingTelegram ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <Send className="w-3 h-3 mr-1.5" />}
              Send Test Message
            </Button>
            {testResult === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {testResult === "error" && <AlertCircle className="w-4 h-4 text-red-400" />}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          className="h-9 px-6 bg-emerald-600/80 hover:bg-emerald-600 text-black font-mono text-xs font-bold"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          data-testid="button-save-settings"
        >
          {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
