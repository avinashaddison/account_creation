import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet as WalletIcon, Copy, CheckCircle2, Clock, XCircle, Loader2, Send, MessageCircle } from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { useAccountPrice } from "@/lib/useAccountPrice";

type PaymentRequest = {
  id: string;
  amount: string;
  txHash: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
};

type WalletData = {
  balance: string;
  freeAccountsUsed: number;
  freeAccountLimit: number;
  trc20Address: string;
  whatsappNumber: string;
  payments: PaymentRequest[];
};

export default function Wallet() {
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [txHash, setTxHash] = useState("");
  const accountPrice = useAccountPrice();
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  function fetchWallet() {
    setLoading(true);
    fetch("/api/wallet", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return null; }
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchWallet(); }, []);

  function copyAddress() {
    if (data?.trc20Address) {
      navigator.clipboard.writeText(data.trc20Address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied", description: "TRC20 address copied to clipboard" });
    }
  }

  function openWhatsApp(paymentAmount: string, hash: string) {
    const message = encodeURIComponent(
      `Hi, I have made a USDT (TRC20) payment of $${paymentAmount} to the Addison Panel wallet.\n\nTransaction Hash: ${hash || "Not provided"}\n\nPlease approve my payment request. Thank you!`
    );
    const whatsappUrl = `https://wa.me/${data?.whatsappNumber || "919142647797"}?text=${message}`;
    window.open(whatsappUrl, "_blank");
  }

  async function submitPaymentRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    setSubmitting(true);
    const submittedAmount = amount;
    const submittedHash = txHash;
    try {
      const res = await fetch("/api/wallet/payment-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, txHash: txHash || null }),
        credentials: "include",
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const result = await res.json();
      if (res.ok) {
        sounds.deposit();
        toast({ title: "Request Submitted", description: "Your payment request has been sent for approval" });
        setAmount("");
        setTxHash("");
        fetchWallet();
        openWhatsApp(submittedAmount, submittedHash);
      } else {
        sounds.error();
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
    } catch {
      sounds.error();
      toast({ title: "Error", description: "Failed to submit request", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const balance = parseFloat(data?.balance || "0");
  const accountsCanCreate = Math.floor(balance / accountPrice);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="animate-float-up space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-wallet-title">Wallet</h1>
        <p className="text-muted-foreground mt-1">Manage your funds and add balance via Binance TRC20</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card data-testid="card-wallet-balance">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Wallet Balance</CardTitle>
            <div className="p-2 rounded-lg text-emerald-400 bg-emerald-500/10">
              <WalletIcon className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-400">${balance.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">Available for account creation</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Accounts Available</CardTitle>
            <div className="p-2 rounded-lg text-red-400 bg-red-500/10">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{accountsCanCreate}</div>
            <p className="text-xs text-muted-foreground mt-1">Based on wallet balance</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cost per Account</CardTitle>
            <div className="p-2 rounded-lg text-rose-400 bg-rose-500/10">
              <WalletIcon className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${accountPrice.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">Per account created</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add Funds via Binance (TRC20 - USDT)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/15">
              <p className="text-sm font-medium text-amber-300 mb-2">Step 1: Send USDT to this TRC20 address</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-white/5 text-zinc-300 px-3 py-2 rounded border border-white/10 font-mono break-all" data-testid="text-trc20-address">
                  {data?.trc20Address}
                </code>
                <Button variant="outline" size="sm" onClick={() => { sounds.click(); copyAddress(); }} data-testid="button-copy-trc20">
                  {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/15">
              <p className="text-sm font-medium text-red-300 mb-2">Step 2: Submit payment details for approval</p>
              <form onSubmit={submitPaymentRequest} className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-red-300">Amount (USDT)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 10.00"
                    required
                    data-testid="input-payment-amount"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-red-300">Transaction Hash (optional)</Label>
                  <Input
                    value={txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    placeholder="Paste your TRC20 transaction hash"
                    data-testid="input-payment-txhash"
                  />
                </div>
                <Button type="submit" disabled={submitting} className="w-full" data-testid="button-submit-payment">
                  {submitting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Submit Payment for Approval
                </Button>
              </form>
            </div>

            <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
              <div className="flex items-center gap-2 mb-1">
                <MessageCircle className="w-4 h-4 text-emerald-400" />
                <p className="text-sm font-medium text-emerald-300">Step 3: Notify admin on WhatsApp</p>
              </div>
              <p className="text-xs text-emerald-400/70">After submitting, WhatsApp will open automatically so you can message the admin for quick approval.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Payment History</CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.payments || data.payments.length === 0 ? (
              <p className="text-center text-muted-foreground py-8" data-testid="text-no-payments">No payment requests yet</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payments.map((p, i) => (
                      <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-mono font-medium">${parseFloat(p.amount).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={
                            p.status === "approved" ? "default" :
                            p.status === "rejected" ? "destructive" : "secondary"
                          }>
                            <span className="flex items-center gap-1">
                              {p.status === "approved" ? <CheckCircle2 className="w-3 h-3" /> :
                               p.status === "rejected" ? <XCircle className="w-3 h-3" /> :
                               <Clock className="w-3 h-3" />}
                              {p.status}
                            </span>
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(p.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
