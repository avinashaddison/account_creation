import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Mail, RefreshCw, Inbox, Loader2, CheckCircle2 } from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { subscribe } from "@/lib/ws";

type EmailAccount = {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  status: string;
  createdAt: string;
};

type InboxMessage = {
  id: string;
  from: string;
  subject: string;
  text: string;
  createdAt: string;
};

export default function EmailServer() {
  const [emails, setEmails] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<EmailAccount | null>(null);
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function fetchEmails() {
    setLoading(true);
    fetch("/api/emails", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return []; }
        return r.json();
      })
      .then(setEmails)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchEmails();
    const unsub = subscribe((msg) => {
      if (msg.type === "account_update") {
        setEmails((prev) => {
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
  }, []);

  async function fetchInbox(account: EmailAccount) {
    setSelectedEmail(account);
    setInboxLoading(true);
    setInbox([]);

    if (pollRef.current) clearInterval(pollRef.current);

    try {
      const res = await fetch(`/api/emails/${account.id}/inbox`, { credentials: "include" });
      if (res.status === 401) { handleUnauthorized(); return; }
      const messages = await res.json();
      setInbox(messages);
    } catch {
      setInbox([]);
    } finally {
      setInboxLoading(false);
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/emails/${account.id}/inbox`, { credentials: "include" });
        if (res.ok) {
          const messages = await res.json();
          setInbox(messages);
        }
      } catch {}
    }, 5000);
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied", description: "Copied to clipboard" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-email-server-title">Email Server</h1>
          <p className="text-muted-foreground mt-1">Manage Addison email accounts and view incoming messages</p>
        </div>
        <Button variant="outline" onClick={fetchEmails} data-testid="button-refresh-emails">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Addison Email Accounts ({emails.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : emails.length === 0 ? (
              <p className="text-center text-muted-foreground py-8" data-testid="text-no-emails">No email accounts yet. Create accounts from Auto Create.</p>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {emails.map((em) => (
                    <div
                      key={em.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedEmail?.id === em.id ? "border-blue-500 bg-blue-50" : "hover:bg-muted/50"
                      }`}
                      onClick={() => fetchInbox(em)}
                      data-testid={`email-account-${em.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{em.email}</p>
                            <Badge variant={em.status === "verified" ? "default" : em.status === "failed" ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">
                              {em.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{em.firstName} {em.lastName}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); copyText(em.email, em.id); }}
                          data-testid={`button-copy-email-${em.id}`}
                        >
                          {copiedId === em.id ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Inbox className="w-5 h-5" />
              {selectedEmail ? `Inbox - ${selectedEmail.email}` : "Inbox"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedEmail ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Inbox className="w-12 h-12 mb-3 opacity-40" />
                <p className="text-sm">Select an email account to view inbox</p>
              </div>
            ) : inboxLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : inbox.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Mail className="w-12 h-12 mb-3 opacity-40" />
                <p className="text-sm">No messages yet</p>
                <p className="text-xs mt-1">Inbox refreshes automatically every 5 seconds</p>
              </div>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {inbox.map((msg) => (
                    <div key={msg.id} className="p-3 rounded-lg border" data-testid={`inbox-message-${msg.id}`}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium text-muted-foreground">From: {msg.from}</p>
                        <p className="text-[10px] text-muted-foreground">{new Date(msg.createdAt).toLocaleString()}</p>
                      </div>
                      <p className="text-sm font-semibold mb-2">{msg.subject}</p>
                      <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded max-h-40 overflow-auto whitespace-pre-wrap">
                        {msg.text}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
