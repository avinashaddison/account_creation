import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Play, CheckCircle2, XCircle, Zap, Terminal } from "lucide-react";
import { subscribe } from "@/lib/ws";

type LogEntry = {
  accountId: string;
  message: string;
  timestamp: string;
};

type BatchAccount = {
  id: string;
  tempEmail: string;
  firstName: string;
  lastName: string;
  status: string;
};

const QUICK_AMOUNTS = [1, 5, 10, 20, 30];

export default function AutoCreate() {
  const [count, setCount] = useState(1);
  const [country, setCountry] = useState("India");
  const [language, setLanguage] = useState("English");
  const [isRunning, setIsRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchAccounts, setBatchAccounts] = useState<BatchAccount[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const batchIdRef = useRef<string | null>(null);
  const batchAccountsRef = useRef<BatchAccount[]>([]);
  batchIdRef.current = batchId;
  batchAccountsRef.current = batchAccounts;

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === "log" && msg.batchId === batchIdRef.current) {
        setLogs((prev) => [...prev, { accountId: msg.accountId, message: msg.message, timestamp: msg.timestamp }]);
      }
      if (msg.type === "account_update" && batchAccountsRef.current.some((a) => a.id === msg.account.id)) {
        setBatchAccounts((prev) =>
          prev.map((a) => (a.id === msg.account.id ? { ...a, status: msg.account.status } : a))
        );
      }
      if (msg.type === "batch_complete" && msg.batchId === batchIdRef.current) {
        setIsRunning(false);
      }
    });
    return unsub;
  }, []);

  async function startBatch(numAccounts: number) {
    setIsRunning(true);
    setLogs([]);
    setBatchAccounts([]);
    setBatchId(null);

    try {
      const res = await fetch("/api/create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: numAccounts, country, language }),
      });
      const data = await res.json();
      setBatchId(data.batchId);
      setBatchAccounts(
        data.accounts.map((a: any) => ({
          id: a.id,
          tempEmail: a.tempEmail,
          firstName: a.firstName,
          lastName: a.lastName,
          status: a.status,
        }))
      );
    } catch (err) {
      console.error(err);
      setIsRunning(false);
    }
  }

  const completedCount = batchAccounts.filter((a) => a.status === "verified").length;
  const failedCount = batchAccounts.filter((a) => a.status === "failed").length;
  const totalCount = batchAccounts.length;
  const estimatedCost = (count * 0.11).toFixed(2);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-auto-create-title">Auto Create</h1>
        <p className="text-muted-foreground mt-1">Bulk create LA28 accounts automatically with random details</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Number of Accounts</Label>
              <div className="flex flex-wrap gap-2">
                {QUICK_AMOUNTS.map((n) => (
                  <Button
                    key={n}
                    variant={count === n ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCount(n)}
                    disabled={isRunning}
                    data-testid={`button-count-${n}`}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <Input
                type="number"
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
                min={1}
                max={30}
                disabled={isRunning}
                className="mt-2"
                data-testid="input-custom-count"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Input value={country} onChange={(e) => setCountry(e.target.value)} disabled={isRunning} data-testid="input-batch-country" />
              </div>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} disabled={isRunning} data-testid="input-batch-language" />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Accounts</span>
                <span className="font-medium">{count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost per account</span>
                <span className="font-medium">$0.11</span>
              </div>
              <div className="flex justify-between border-t pt-1 mt-1">
                <span className="font-medium">Estimated Total</span>
                <span className="font-bold text-green-600">${estimatedCost}</span>
              </div>
            </div>

            <Button
              className="w-full h-12 text-base font-semibold"
              onClick={() => startBatch(count)}
              disabled={isRunning}
              data-testid="button-start-batch"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating {totalCount} accounts...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Create {count} Account{count > 1 ? "s" : ""}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              Live Logs
            </CardTitle>
            {totalCount > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="outline">{completedCount}/{totalCount} done</Badge>
                {failedCount > 0 && <Badge variant="destructive">{failedCount} failed</Badge>}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {batchAccounts.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {batchAccounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border bg-white"
                    data-testid={`badge-batch-account-${acc.id}`}
                  >
                    {acc.status === "verified" ? (
                      <CheckCircle2 className="w-3 h-3 text-green-500" />
                    ) : acc.status === "failed" ? (
                      <XCircle className="w-3 h-3 text-red-500" />
                    ) : (
                      <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                    )}
                    {acc.firstName}
                  </div>
                ))}
              </div>
            )}

            <ScrollArea className="h-[400px] rounded-md border bg-zinc-950 p-4">
              {logs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                  Logs will appear here when you start creating accounts...
                </div>
              ) : (
                <div className="space-y-1 font-mono text-xs">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-2" data-testid={`log-entry-${i}`}>
                      <span className="text-zinc-500 shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={
                        log.message.includes("verified") || log.message.includes("successfully")
                          ? "text-green-400"
                          : log.message.includes("Failed") || log.message.includes("Error") || log.message.includes("Timed out")
                          ? "text-red-400"
                          : log.message.includes("code")
                          ? "text-yellow-400"
                          : "text-zinc-300"
                      }>
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
