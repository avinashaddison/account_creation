import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Settings2, Search, Send, CheckCircle2, XCircle, Eye, EyeOff, Bell, Radio } from "lucide-react";
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
    mutationFn: () => apiRequest("PUT", "/api/tm-discovery/settings", { keyword, botToken, chatId, monitoringEnabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-discovery/settings"] });
      toast({ title: "Settings saved!", description: "Monitoring configuration updated." });
    },
    onError: () => toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" }),
  });

  async function testTelegram() {
    if (!botToken || !chatId) {
      toast({ title: "Missing fields", description: "Enter Bot Token and Chat ID first.", variant: "destructive" });
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
      const d = await res.json();
      setTestResult(d.success ? "success" : "error");
      toast({
        title: d.success ? "✅ Test sent!" : "❌ Test failed",
        description: d.success ? "Check your Telegram for the test message." : "Verify your bot token and chat ID.",
        variant: d.success ? "default" : "destructive",
      });
    } catch {
      setTestResult("error");
      toast({ title: "Error", description: "Could not reach Telegram.", variant: "destructive" });
    } finally {
      setTestingTelegram(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-400/50" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #10b981, #3b82f6)', boxShadow: '0 0 20px rgba(16,185,129,0.3)' }}>
          <Settings2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">TM Settings</h1>
          <p className="text-xs text-zinc-400">Configure event monitoring and Telegram alerts</p>
        </div>
      </div>

      {/* Monitoring Section */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(59,130,246,0.2)' }}>
        <div className="px-5 py-4 flex items-center gap-2" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(99,102,241,0.06))', borderBottom: '1px solid rgba(59,130,246,0.15)' }}>
          <Search className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-blue-300">Event Monitoring</span>
        </div>
        <div className="p-5 space-y-5" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Search Keyword</label>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. concert, NBA, Taylor Swift, UFC..."
              className="h-11 rounded-xl border-white/10 text-zinc-200 placeholder:text-zinc-600 text-sm"
              style={{ background: 'rgba(255,255,255,0.05)' }}
              data-testid="input-keyword"
            />
            <p className="text-xs text-zinc-600 mt-2">The system checks Ticketmaster for this keyword every 30 seconds</p>
          </div>

          {/* Monitoring Toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: monitoringEnabled ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.03)', border: monitoringEnabled ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(255,255,255,0.06)', transition: 'all 0.2s' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: monitoringEnabled ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)' }}>
                <Radio className={`w-4 h-4 ${monitoringEnabled ? "text-emerald-400" : "text-zinc-600"}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Auto-Monitoring</p>
                <p className="text-xs text-zinc-500">Detect new events and price changes every 30s</p>
              </div>
            </div>
            <button
              onClick={() => setMonitoringEnabled((v) => !v)}
              className="relative w-12 h-6 rounded-full transition-all duration-300"
              style={{ background: monitoringEnabled ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.1)', boxShadow: monitoringEnabled ? '0 0 10px rgba(16,185,129,0.3)' : 'none' }}
              data-testid="toggle-monitoring"
            >
              <span
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300"
                style={{ left: monitoringEnabled ? '26px' : '2px' }}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Telegram Section */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(59,130,246,0.2)' }}>
        <div className="px-5 py-4 flex items-center gap-2" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(99,102,241,0.06))', borderBottom: '1px solid rgba(59,130,246,0.15)' }}>
          <Send className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-blue-300">Telegram Alerts</span>
          <span className="ml-auto text-xs text-zinc-600">Optional — alerts also show in Live Alerts tab</span>
        </div>
        <div className="p-5 space-y-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Bot Token</label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxyz..."
                className="h-11 pr-11 rounded-xl border-white/10 text-zinc-200 placeholder:text-zinc-600 text-sm font-mono"
                style={{ background: 'rgba(255,255,255,0.05)' }}
                data-testid="input-bot-token"
              />
              <button
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10 transition-colors"
              >
                {showToken ? <EyeOff className="w-4 h-4 text-zinc-500" /> : <Eye className="w-4 h-4 text-zinc-500" />}
              </button>
            </div>
            <p className="text-xs text-zinc-600 mt-1.5">Create a bot at <span className="text-blue-400">@BotFather</span> on Telegram</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Chat ID</label>
            <Input
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-1001234567890  or  @yourchannel"
              className="h-11 rounded-xl border-white/10 text-zinc-200 placeholder:text-zinc-600 text-sm font-mono"
              style={{ background: 'rgba(255,255,255,0.05)' }}
              data-testid="input-chat-id"
            />
            <p className="text-xs text-zinc-600 mt-1.5">Use <span className="text-blue-400">@userinfobot</span> to find your chat ID</p>
          </div>

          {/* Test Button */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="ghost"
              className="h-10 px-5 rounded-xl text-sm font-medium transition-all"
              style={{ border: '1px solid rgba(59,130,246,0.3)', color: '#93c5fd', background: 'rgba(59,130,246,0.08)' }}
              onClick={testTelegram}
              disabled={testingTelegram}
              data-testid="button-test-telegram"
            >
              {testingTelegram
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Sending...</>
                : <><Send className="w-4 h-4 mr-2" />Send Test Message</>
              }
            </Button>
            {testResult === "success" && (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-emerald-400">Message delivered!</span>
              </div>
            )}
            {testResult === "error" && (
              <div className="flex items-center gap-1.5">
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="text-xs text-red-400">Delivery failed</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          className="h-11 px-8 rounded-xl text-sm font-bold transition-all"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 0 20px rgba(99,102,241,0.3)' }}
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          data-testid="button-save-settings"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {saveMutation.isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
