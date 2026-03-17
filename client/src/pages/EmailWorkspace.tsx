import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Copy, Trash2, Mail, Inbox, Loader2, CheckCircle2, RefreshCw, Sparkles, Clock, Search, Eye, Users } from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { subscribe } from "@/lib/ws";
import { sounds } from "@/lib/sounds";

type TempEmailItem = {
  id: string;
  address: string;
  label: string | null;
  createdAt: string;
  source: "temp";
};

type AccountEmailItem = {
  id: string;
  address: string;
  firstName: string;
  lastName: string;
  status: string;
  createdAt: string;
  source: "account";
};

type EmailItem = TempEmailItem | AccountEmailItem;

type InboxMessage = {
  id: string;
  from: string;
  subject: string;
  text: string;
  createdAt: string;
};

type TabType = "all" | "temp" | "account";

export default function EmailWorkspace() {
  const [tempEmails, setTempEmails] = useState<TempEmailItem[]>([]);
  const [accountEmails, setAccountEmails] = useState<AccountEmailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(null);
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const { toast } = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [scanning, setScanning] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tempRes, accRes] = await Promise.all([
        fetch("/api/temp-emails", { credentials: "include" }),
        fetch("/api/emails", { credentials: "include" }),
      ]);
      if (tempRes.status === 401 || accRes.status === 401) { handleUnauthorized(); return; }
      const tempData = await tempRes.json();
      const accData = await accRes.json();
      setTempEmails(tempData.map((e: any) => ({ ...e, address: e.address, source: "temp" as const })));
      setAccountEmails(accData.map((e: any) => ({
        id: e.id,
        address: e.email,
        firstName: e.firstName,
        lastName: e.lastName,
        status: e.status,
        createdAt: e.createdAt,
        source: "account" as const,
      })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const unsub = subscribe((msg: any) => {
      if (msg.type === "account_update") {
        setAccountEmails((prev) => {
          const idx = prev.findIndex((e) => e.id === msg.account.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], status: msg.account.status };
            return updated;
          }
          return prev;
        });
      }
    });
    return () => {
      unsub();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchAll]);

  const allEmails: EmailItem[] = (() => {
    const t: EmailItem[] = activeTab === "account" ? [] : tempEmails;
    const a: EmailItem[] = activeTab === "temp" ? [] : accountEmails;
    const combined = [...t, ...a];
    if (!searchTerm) return combined;
    return combined.filter((e) => e.address.toLowerCase().includes(searchTerm.toLowerCase()));
  })();

  async function generateNewMail() {
    setGenerating(true);
    sounds.click();
    try {
      const res = await fetch("/api/temp-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to generate");
      }
      const newEmail = await res.json();
      const item: TempEmailItem = { ...newEmail, source: "temp" };
      setTempEmails((prev) => [item, ...prev]);
      setSelectedEmail(item);
      fetchInbox(item);
      toast({ title: "Email Generated", description: newEmail.address });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  async function deleteEmail(id: string) {
    setDeletingId(id);
    sounds.click();
    try {
      const res = await fetch(`/api/temp-emails/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        setTempEmails((prev) => prev.filter((e) => e.id !== id));
        if (selectedEmail?.id === id) {
          setSelectedEmail(null);
          setInbox([]);
          if (pollRef.current) clearInterval(pollRef.current);
        }
        toast({ title: "Deleted", description: "Email removed" });
      }
    } catch {} finally {
      setDeletingId(null);
    }
  }

  async function fetchInbox(email: EmailItem) {
    setSelectedEmail(email);
    setInboxLoading(true);
    setInbox([]);
    setExpandedMsg(null);

    if (pollRef.current) clearInterval(pollRef.current);

    const inboxUrl = email.source === "temp"
      ? `/api/temp-emails/${email.id}/inbox`
      : `/api/emails/${email.id}/inbox`;

    try {
      const res = await fetch(inboxUrl, { credentials: "include" });
      if (res.status === 401) { handleUnauthorized(); return; }
      const messages = await res.json();
      setInbox(messages);
    } catch {
      setInbox([]);
    } finally {
      setInboxLoading(false);
    }

    pollRef.current = setInterval(async () => {
      setScanning(true);
      try {
        const res = await fetch(inboxUrl, { credentials: "include" });
        if (res.ok) {
          const messages = await res.json();
          setInbox((prev) => {
            if (messages.length > prev.length) {
              sounds.click();
              toast({ title: "New Mail", description: `${messages.length - prev.length} new message(s)` });
            }
            return messages;
          });
        }
      } catch {} finally {
        setTimeout(() => setScanning(false), 800);
      }
    }, 5000);
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    sounds.click();
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied", description: "Copied to clipboard" });
  }

  const tabs: { key: TabType; label: string; count: number }[] = [
    { key: "all", label: "All", count: tempEmails.length + accountEmails.length },
    { key: "temp", label: "Generated", count: tempEmails.length },
    { key: "account", label: "Accounts", count: accountEmails.length },
  ];

  return (
    <div className="animate-float-up space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white font-mono flex items-center gap-2" data-testid="text-email-workspace-title">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(255,176,0,0.15) 0%, rgba(0,255,65,0.1) 100%)', border: '1px solid rgba(255,176,0,0.25)' }}>
              <Mail className="w-4 h-4 text-purple-400" />
            </div>
            Email Workspace
          </h1>
          <p className="text-xs text-zinc-500 mt-1 font-mono">All mailboxes in one place with real-time inbox scanning</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchAll}
            className="h-8 px-3 text-zinc-400 hover:text-emerald-300 hover:bg-emerald-500/10 font-mono text-xs"
            data-testid="button-refresh-workspace"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button
            onClick={generateNewMail}
            disabled={generating}
            className="h-8 px-4 font-mono text-xs"
            style={{ background: 'linear-gradient(135deg, rgba(255,176,0,0.8) 0%, rgba(124,58,237,0.9) 100%)', border: '1px solid rgba(255,176,0,0.4)' }}
            data-testid="button-generate-email"
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5 mr-1.5" />
            )}
            Generate New Mail
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(15,21,32,0.6)', border: '1px solid rgba(0,255,65,0.08)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,255,65,0.06)' }}>
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-400/60" />
              <span className="text-xs font-mono text-zinc-400">Mailboxes</span>
            </div>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono bg-purple-500/10 text-purple-300 border-purple-500/20">
              {tempEmails.length + accountEmails.length}
            </Badge>
          </div>

          <div className="flex px-3 pt-2 gap-1" style={{ borderBottom: '1px solid rgba(0,255,65,0.06)' }}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-2.5 py-1.5 text-[10px] font-mono rounded-t-md transition-all ${
                  activeTab === tab.key
                    ? "text-emerald-300 bg-emerald-500/10 border-b-2 border-emerald-400"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
                data-testid={`tab-${tab.key}`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(0,255,65,0.06)' }}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600" />
              <input
                type="text"
                placeholder="Search emails..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-7 pl-7 pr-3 text-xs font-mono rounded-md bg-black/30 border border-emerald-500/10 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/20"
                data-testid="input-search-emails"
              />
            </div>
          </div>

          <ScrollArea className="h-[calc(100vh-320px)]">
            <div className="p-2 space-y-1">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-400/40" />
                </div>
              ) : allEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
                  <Mail className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs font-mono">
                    {tempEmails.length + accountEmails.length === 0 ? "No mailboxes yet" : "No matches"}
                  </p>
                  {tempEmails.length + accountEmails.length === 0 && (
                    <p className="text-[10px] font-mono mt-1 text-zinc-700">Click "Generate New Mail" to start</p>
                  )}
                </div>
              ) : (
                allEmails.map((em) => {
                  const isAccount = em.source === "account";
                  const accEmail = isAccount ? (em as AccountEmailItem) : null;
                  return (
                    <div
                      key={`${em.source}-${em.id}`}
                      className={`group p-2.5 rounded-lg cursor-pointer transition-all duration-150 ${
                        selectedEmail?.id === em.id && selectedEmail?.source === em.source
                          ? "text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                      style={
                        selectedEmail?.id === em.id && selectedEmail?.source === em.source
                          ? { background: 'linear-gradient(135deg, rgba(255,176,0,0.1) 0%, rgba(0,255,65,0.05) 100%)', border: '1px solid rgba(255,176,0,0.2)' }
                          : { border: '1px solid transparent' }
                      }
                      onClick={() => fetchInbox(em)}
                      data-testid={`email-item-${em.source}-${em.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{
                          background: selectedEmail?.id === em.id && selectedEmail?.source === em.source
                            ? (isAccount ? 'rgba(0,255,65,0.15)' : 'rgba(255,176,0,0.15)')
                            : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${selectedEmail?.id === em.id && selectedEmail?.source === em.source
                            ? (isAccount ? 'rgba(0,255,65,0.3)' : 'rgba(255,176,0,0.3)')
                            : 'rgba(255,255,255,0.05)'}`
                        }}>
                          {isAccount ? (
                            <Users className={`w-3 h-3 ${selectedEmail?.id === em.id && selectedEmail?.source === em.source ? 'text-emerald-400' : 'text-zinc-600'}`} />
                          ) : (
                            <Mail className={`w-3 h-3 ${selectedEmail?.id === em.id && selectedEmail?.source === em.source ? 'text-purple-400' : 'text-zinc-600'}`} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[11px] font-mono truncate">{em.address}</p>
                            {isAccount && accEmail && (
                              <Badge
                                variant={accEmail.status === "completed" ? "default" : accEmail.status === "failed" ? "destructive" : "secondary"}
                                className="text-[8px] px-1 py-0 font-mono shrink-0"
                              >
                                {accEmail.status}
                              </Badge>
                            )}
                            {!isAccount && (
                              <Badge className="text-[8px] px-1 py-0 font-mono shrink-0 bg-purple-500/15 text-purple-300 border-purple-500/20">
                                temp
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            {isAccount && accEmail ? (
                              <p className="text-[9px] text-zinc-600 font-mono">{accEmail.firstName} {accEmail.lastName}</p>
                            ) : (
                              <>
                                <Clock className="w-2.5 h-2.5 text-zinc-600" />
                                <p className="text-[9px] text-zinc-600 font-mono">{new Date(em.createdAt).toLocaleString()}</p>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); copyText(em.address, `${em.source}-${em.id}`); }}
                            className="p-1 rounded hover:bg-emerald-500/10"
                            data-testid={`button-copy-${em.source}-${em.id}`}
                          >
                            {copiedId === `${em.source}-${em.id}` ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3 text-zinc-500" />
                            )}
                          </button>
                          {!isAccount && (
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteEmail(em.id); }}
                              className="p-1 rounded hover:bg-red-500/10"
                              disabled={deletingId === em.id}
                              data-testid={`button-delete-${em.id}`}
                            >
                              {deletingId === em.id ? (
                                <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />
                              ) : (
                                <Trash2 className="w-3 h-3 text-zinc-600 hover:text-red-400" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(15,21,32,0.6)', border: '1px solid rgba(0,255,65,0.08)' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,255,65,0.06)' }}>
            <div className="flex items-center gap-2">
              <Inbox className="w-3.5 h-3.5 text-emerald-400/60" />
              <span className="text-xs font-mono text-zinc-400">
                {selectedEmail ? selectedEmail.address : "Inbox"}
              </span>
              {selectedEmail && (
                <button
                  onClick={() => copyText(selectedEmail.address, "header-" + selectedEmail.id)}
                  className="p-0.5 rounded hover:bg-emerald-500/10"
                  data-testid="button-copy-selected"
                >
                  {copiedId === "header-" + selectedEmail?.id ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-zinc-600 hover:text-emerald-400" />
                  )}
                </button>
              )}
            </div>
            {selectedEmail && (
              <div className="flex items-center gap-2">
                {scanning && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[9px] font-mono text-emerald-400/60">Scanning...</span>
                  </div>
                )}
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono bg-emerald-500/10 text-emerald-300 border-emerald-500/20">
                  {inbox.length} msg{inbox.length !== 1 ? "s" : ""}
                </Badge>
              </div>
            )}
          </div>

          {selectedEmail && (
            <div className="px-4 py-2 flex items-center gap-3 text-[10px] font-mono" style={{ borderBottom: '1px solid rgba(0,255,65,0.06)', background: 'rgba(0,0,0,0.2)' }}>
              <Badge className={`text-[8px] px-1.5 py-0 font-mono ${selectedEmail.source === "temp" ? "bg-purple-500/15 text-purple-300 border-purple-500/20" : "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"}`}>
                {selectedEmail.source === "temp" ? "Generated" : "Account"}
              </Badge>
              {selectedEmail.source === "account" && (
                <span className="text-zinc-500">{(selectedEmail as AccountEmailItem).firstName} {(selectedEmail as AccountEmailItem).lastName}</span>
              )}
              <span className="text-zinc-600">{new Date(selectedEmail.createdAt).toLocaleString()}</span>
              <div className="flex-1" />
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400/50">Live scan every 5s</span>
              </div>
            </div>
          )}

          <ScrollArea className="h-[calc(100vh-320px)]">
            {!selectedEmail ? (
              <div className="flex flex-col items-center justify-center py-24 text-zinc-600">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(255,176,0,0.05)', border: '1px solid rgba(255,176,0,0.1)' }}>
                  <Inbox className="w-7 h-7 text-purple-400/30" />
                </div>
                <p className="text-sm font-mono text-zinc-500">Select a mailbox to view inbox</p>
                <p className="text-[10px] font-mono mt-1 text-zinc-700">or generate a new email to get started</p>
              </div>
            ) : inboxLoading ? (
              <div className="flex flex-col items-center justify-center py-24">
                <Loader2 className="w-6 h-6 animate-spin text-purple-400/40 mb-2" />
                <p className="text-xs font-mono text-zinc-600">Loading inbox...</p>
              </div>
            ) : inbox.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-zinc-600">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(0,255,65,0.03)', border: '1px solid rgba(0,255,65,0.08)' }}>
                  <Mail className="w-7 h-7 text-emerald-400/20" />
                </div>
                <p className="text-sm font-mono text-zinc-500">No messages yet</p>
                <p className="text-[10px] font-mono mt-1 text-zinc-700">Inbox auto-refreshes every 5 seconds</p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {inbox.map((msg) => (
                  <div
                    key={msg.id}
                    className="rounded-lg transition-all duration-150 cursor-pointer"
                    style={{ background: expandedMsg === msg.id ? 'rgba(255,176,0,0.05)' : 'rgba(0,0,0,0.2)', border: `1px solid ${expandedMsg === msg.id ? 'rgba(255,176,0,0.15)' : 'rgba(0,255,65,0.05)'}` }}
                    onClick={() => setExpandedMsg(expandedMsg === msg.id ? null : msg.id)}
                    data-testid={`inbox-msg-${msg.id}`}
                  >
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-mono font-semibold text-zinc-200 truncate">{msg.subject}</p>
                          <p className="text-[10px] font-mono text-zinc-500 mt-0.5 truncate">From: {msg.from}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[9px] font-mono text-zinc-600">{new Date(msg.createdAt).toLocaleTimeString()}</span>
                          <Eye className={`w-3 h-3 ${expandedMsg === msg.id ? 'text-purple-400' : 'text-zinc-700'}`} />
                        </div>
                      </div>
                      {expandedMsg !== msg.id && (
                        <p className="text-[10px] font-mono text-zinc-600 mt-1.5 truncate">
                          {msg.text?.replace(/<[^>]*>/g, "").substring(0, 120) || "(empty)"}
                        </p>
                      )}
                    </div>
                    {expandedMsg === msg.id && (
                      <div className="px-3 pb-3">
                        <div className="rounded-md p-3 text-xs font-mono text-zinc-300 max-h-80 overflow-auto" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,255,65,0.05)' }}>
                          <pre className="whitespace-pre-wrap break-words">{msg.text?.replace(/<[^>]*>/g, "") || "(empty)"}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
