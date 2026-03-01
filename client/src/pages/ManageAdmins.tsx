import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, UserPlus, Trash2, Loader2 } from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

type AdminUser = {
  id: string;
  username: string;
  email: string;
  role: string;
  freeAccountsUsed: number;
};

export default function ManageAdmins() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();

  function fetchAdmins() {
    setLoading(true);
    fetch("/api/admin/users", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return []; }
        if (r.status === 403) return [];
        return r.json();
      })
      .then(setAdmins)
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-manage-admins-title">Manage Admins</h1>
          <p className="text-muted-foreground mt-1">Create and manage admin accounts</p>
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
    </div>
  );
}
