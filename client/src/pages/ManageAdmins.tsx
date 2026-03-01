import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, UserPlus, Trash2, Loader2, Wallet, CheckCircle2, XCircle, Clock, DollarSign } from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

type AdminUser = {
  id: string;
  username: string;
  email: string;
  role: string;
  freeAccountsUsed: number;
  walletBalance: string;
};

type PaymentRequest = {
  id: string;
  userId: string;
  amount: string;
  txHash: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
  userEmail: string;
  userName: string;
};

export default function ManageAdmins() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fundUserId, setFundUserId] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  const [addingFunds, setAddingFunds] = useState(false);
  const { toast } = useToast();

  function fetchAdmins() {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/users", { credentials: "include" }).then((r) => {
        if (r.status === 401) { handleUnauthorized(); return []; }
        if (r.status === 403) return [];
        return r.json();
      }),
      fetch("/api/admin/payment-requests", { credentials: "include" }).then((r) => {
        if (!r.ok) return [];
        return r.json();
      }),
    ])
      .then(([users, paymentReqs]) => {
        setAdmins(users);
        setPayments(paymentReqs);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchAdmins(); }, []);

  async function createAdmin(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, role: "admin" }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error, variant: "destructive" });
        return;
      }
      toast({ title: "Admin Created", description: `${data.email} has been added` });
      setUsername(""); setEmail(""); setPassword("");
      setShowForm(false);
      fetchAdmins();
    } catch {
      toast({ title: "Error", description: "Failed to create admin", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function deleteAdmin(id: string, adminEmail: string) {
    if (!confirm(`Are you sure you want to delete ${adminEmail}?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast({ title: "Deleted", description: `${adminEmail} removed` });
        fetchAdmins();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete admin", variant: "destructive" });
    }
  }

  async function addFunds(e: React.FormEvent) {
    e.preventDefault();
    if (!fundUserId || !fundAmount) return;
    setAddingFunds(true);
    try {
      const res = await fetch("/api/admin/add-funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: fundUserId, amount: fundAmount }),
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Funds Added", description: `New balance: $${data.newBalance}` });
        setFundUserId("");
        setFundAmount("");
        fetchAdmins();
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to add funds", variant: "destructive" });
    } finally {
      setAddingFunds(false);
    }
  }

  async function handlePaymentAction(id: string, action: "approve" | "reject") {
    try {
      const res = await fetch(`/api/admin/payment-requests/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: action === "approve" ? "Approved" : "Rejected", description: `Payment request ${action}d` });
        fetchAdmins();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to process request", variant: "destructive" });
    }
  }

  const regularAdmins = admins.filter(a => a.role !== "superadmin");
  const pendingPayments = payments.filter(p => p.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-manage-admins-title">Manage Admins</h1>
          <p className="text-muted-foreground mt-1">Create admins, manage funds, and approve payments</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} data-testid="button-toggle-create-form">
          <UserPlus className="w-4 h-4 mr-2" />
          {showForm ? "Cancel" : "Create Admin"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create New Admin</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createAdmin} className="grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} required data-testid="input-admin-username" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-admin-email" />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="input-admin-password" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={creating} className="w-full" data-testid="button-create-admin">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="admins">
        <TabsList>
          <TabsTrigger value="admins" data-testid="tab-admins">
            <Users className="w-4 h-4 mr-1" /> Admins ({admins.length})
          </TabsTrigger>
          <TabsTrigger value="funds" data-testid="tab-funds">
            <Wallet className="w-4 h-4 mr-1" /> Add Funds
          </TabsTrigger>
          <TabsTrigger value="payments" data-testid="tab-payments">
            <DollarSign className="w-4 h-4 mr-1" /> Payment Requests
            {pendingPayments.length > 0 && (
              <Badge variant="destructive" className="ml-2 text-xs px-1.5">{pendingPayments.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="admins">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5" />
                All Users ({admins.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Username</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Accounts Used</TableHead>
                        <TableHead>Wallet Balance</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {admins.map((admin, i) => (
                        <TableRow key={admin.id} data-testid={`row-admin-${admin.id}`}>
                          <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                          <TableCell className="font-medium">{admin.username}</TableCell>
                          <TableCell>{admin.email}</TableCell>
                          <TableCell>
                            <Badge variant={admin.role === "superadmin" ? "default" : "secondary"}>
                              {admin.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {admin.role === "superadmin" ? (
                              <span className="text-xs text-muted-foreground">Unlimited</span>
                            ) : (
                              <span className="text-sm">{admin.freeAccountsUsed} / 30</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {admin.role === "superadmin" ? (
                              <span className="text-xs text-muted-foreground">N/A</span>
                            ) : (
                              <span className="text-sm font-mono font-medium text-green-600">
                                ${parseFloat(admin.walletBalance || "0").toFixed(2)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {admin.role !== "superadmin" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteAdmin(admin.id, admin.email)}
                                className="text-red-500 hover:text-red-700"
                                data-testid={`button-delete-admin-${admin.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funds">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="w-5 h-5" />
                Add Funds to Admin Wallet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={addFunds} className="grid gap-4 md:grid-cols-3 max-w-2xl">
                <div className="space-y-1.5">
                  <Label>Select Admin</Label>
                  <select
                    value={fundUserId}
                    onChange={(e) => setFundUserId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                    data-testid="select-fund-admin"
                  >
                    <option value="">Choose admin...</option>
                    {regularAdmins.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.email} (Balance: ${parseFloat(a.walletBalance || "0").toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Amount (USD)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    placeholder="e.g. 10.00"
                    required
                    data-testid="input-fund-amount"
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={addingFunds} className="w-full" data-testid="button-add-funds">
                    {addingFunds ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <>
                        <DollarSign className="w-4 h-4 mr-1" />
                        Add Funds
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Payment Requests ({payments.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-center text-muted-foreground py-8" data-testid="text-no-payment-requests">No payment requests yet</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Admin</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>TX Hash</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p, i) => (
                        <TableRow key={p.id} data-testid={`row-payment-request-${p.id}`}>
                          <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                          <TableCell className="font-medium">{p.userEmail}</TableCell>
                          <TableCell className="font-mono font-medium">${parseFloat(p.amount).toFixed(2)}</TableCell>
                          <TableCell className="max-w-[200px]">
                            {p.txHash ? (
                              <code className="text-xs break-all">{p.txHash}</code>
                            ) : (
                              <span className="text-xs text-muted-foreground">Not provided</span>
                            )}
                          </TableCell>
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
                          <TableCell>
                            {p.status === "pending" && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-green-600 border-green-200 hover:bg-green-50"
                                  onClick={() => handlePaymentAction(p.id, "approve")}
                                  data-testid={`button-approve-${p.id}`}
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                  onClick={() => handlePaymentAction(p.id, "reject")}
                                  data-testid={`button-reject-${p.id}`}
                                >
                                  <XCircle className="w-3 h-3 mr-1" /> Reject
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
