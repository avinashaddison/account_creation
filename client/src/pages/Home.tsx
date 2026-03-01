import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Mail,
  ShieldCheck,
  UserPlus,
  RefreshCw,
  Shuffle,
} from "lucide-react";

type Registration = {
  id: string;
  tempEmail: string;
  firstName: string;
  lastName: string;
  country: string;
  language: string;
  status: string;
  verificationCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pending: { label: "Pending", icon: <Clock className="w-4 h-4" />, color: "text-yellow-600 bg-yellow-50" },
  registering: { label: "Registering on LA28...", icon: <UserPlus className="w-4 h-4" />, color: "text-blue-600 bg-blue-50" },
  waiting_code: { label: "Waiting for email code...", icon: <Mail className="w-4 h-4" />, color: "text-purple-600 bg-purple-50" },
  verifying: { label: "Verifying code...", icon: <ShieldCheck className="w-4 h-4" />, color: "text-indigo-600 bg-indigo-50" },
  verified: { label: "Verified", icon: <CheckCircle2 className="w-4 h-4" />, color: "text-green-600 bg-green-50" },
  failed: { label: "Failed", icon: <XCircle className="w-4 h-4" />, color: "text-red-600 bg-red-50" },
};

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Charles", "Karen", "Daniel", "Lisa", "Matthew", "Nancy",
  "Anthony", "Betty", "Mark", "Margaret", "Donald", "Sandra", "Steven", "Ashley",
  "Andrew", "Dorothy", "Paul", "Kimberly", "Joshua", "Emily", "Kenneth", "Donna",
  "Arjun", "Priya", "Rahul", "Anita", "Vikram", "Sneha", "Amit", "Pooja",
  "Raj", "Neha", "Sanjay", "Divya", "Arun", "Kavita", "Suresh", "Meena",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
  "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
  "Kumar", "Sharma", "Singh", "Patel", "Gupta", "Mehta", "Verma", "Jain",
  "Reddy", "Nair", "Rao", "Mishra", "Chopra", "Malhotra", "Bhat", "Das",
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomPassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const special = "@#$!%&";
  const all = upper + lower + digits + special;

  let pwd = "";
  pwd += special[Math.floor(Math.random() * special.length)];
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  for (let i = 0; i < 7; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

export default function Home() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("India");
  const [language, setLanguage] = useState("English");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeRegId, setActiveRegId] = useState<string | null>(null);
  const [activeReg, setActiveReg] = useState<Registration | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);

  const randomizeDetails = useCallback(() => {
    setFirstName(randomFrom(FIRST_NAMES));
    setLastName(randomFrom(LAST_NAMES));
    setPassword(generateRandomPassword());
  }, []);

  useEffect(() => {
    randomizeDetails();
    fetchRegistrations();
  }, [randomizeDetails]);

  useEffect(() => {
    if (!activeRegId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/registrations/${activeRegId}`);
        const data = await res.json();
        setActiveReg(data);
        if (data.status === "verified" || data.status === "failed") {
          clearInterval(interval);
          fetchRegistrations();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [activeRegId]);

  async function fetchRegistrations() {
    try {
      const res = await fetch("/api/registrations");
      const data = await res.json();
      setRegistrations(data);
    } catch {}
  }

  async function handleStartRegistration() {
    setIsSubmitting(true);
    setActiveReg(null);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, password, country, language }),
      });
      const data = await res.json();
      if (data.id) {
        setActiveRegId(data.id);
        setActiveReg({
          id: data.id,
          tempEmail: data.tempEmail,
          firstName,
          lastName,
          country,
          language,
          status: "pending",
          verificationCode: null,
          errorMessage: null,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRandomAndStart() {
    const fn = randomFrom(FIRST_NAMES);
    const ln = randomFrom(LAST_NAMES);
    const pw = generateRandomPassword();
    setFirstName(fn);
    setLastName(ln);
    setPassword(pw);

    setIsSubmitting(true);
    setActiveReg(null);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: fn, lastName: ln, password: pw, country, language }),
      });
      const data = await res.json();
      if (data.id) {
        setActiveRegId(data.id);
        setActiveReg({
          id: data.id,
          tempEmail: data.tempEmail,
          firstName: fn,
          lastName: ln,
          country,
          language,
          status: "pending",
          verificationCode: null,
          errorMessage: null,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  function getStatusBadge(status: string) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`} data-testid={`status-badge-${status}`}>
        {config.icon}
        {config.label}
      </span>
    );
  }

  const isProcessing = activeReg && !["verified", "failed"].includes(activeReg.status);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="text-center pt-8 pb-4">
          <h1 className="text-4xl font-black tracking-tight mb-2" data-testid="text-title">
            LA28 Auto Registration
          </h1>
          <p className="text-muted-foreground text-lg" data-testid="text-subtitle">
            Automated account creation with temporary email and verification
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Registration Details</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={randomizeDetails}
                disabled={!!isProcessing}
                data-testid="button-randomize"
              >
                <Shuffle className="w-3.5 h-3.5 mr-1.5" />
                Randomize
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={!!isProcessing}
                    data-testid="input-firstName"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={!!isProcessing}
                    data-testid="input-lastName"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">LA28 Password</Label>
                <Input
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!!isProcessing}
                  data-testid="input-password"
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    disabled={!!isProcessing}
                    data-testid="input-country"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="language">Language</Label>
                  <Input
                    id="language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    disabled={!!isProcessing}
                    data-testid="input-language"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-2">
                <Button
                  className="flex-1 h-12 text-base font-semibold"
                  onClick={handleStartRegistration}
                  disabled={isSubmitting || !!isProcessing}
                  data-testid="button-start-registration"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Start
                    </>
                  )}
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1 h-12 text-base font-semibold"
                  onClick={handleRandomAndStart}
                  disabled={isSubmitting || !!isProcessing}
                  data-testid="button-random-start"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Shuffle className="w-4 h-4 mr-2" />
                      Random + Start
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Live Status</CardTitle>
            </CardHeader>
            <CardContent>
              {activeReg ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    {getStatusBadge(activeReg.status)}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Temp Email</span>
                      <span className="font-mono text-xs" data-testid="text-temp-email">{activeReg.tempEmail}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Name</span>
                      <span data-testid="text-reg-name">{activeReg.firstName} {activeReg.lastName}</span>
                    </div>
                    {activeReg.verificationCode && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Code</span>
                        <span className="font-mono font-bold text-green-600" data-testid="text-verification-code">{activeReg.verificationCode}</span>
                      </div>
                    )}
                    {activeReg.errorMessage && (
                      <div className="mt-3 p-3 bg-red-50 rounded-lg text-red-700 text-xs" data-testid="text-error-message">
                        {activeReg.errorMessage}
                      </div>
                    )}
                  </div>

                  {isProcessing && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing... this may take a couple of minutes
                    </div>
                  )}

                  <div className="space-y-1">
                    {["pending", "registering", "waiting_code", "verifying", "verified"].map((step) => {
                      const stepOrder = ["pending", "registering", "waiting_code", "verifying", "verified"];
                      const currentIndex = stepOrder.indexOf(activeReg.status);
                      const stepIndex = stepOrder.indexOf(step);
                      const isDone = stepIndex < currentIndex || activeReg.status === "verified";
                      const isActive = stepIndex === currentIndex && activeReg.status !== "failed";

                      return (
                        <motion.div
                          key={step}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={`flex items-center gap-3 py-1.5 text-sm ${
                            isDone ? "text-green-600" : isActive ? "text-blue-600 font-medium" : "text-muted-foreground/40"
                          }`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : isActive ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border border-current" />
                          )}
                          {STATUS_CONFIG[step]?.label || step}
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Start a registration to see live progress</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Registration History</CardTitle>
            <Button variant="ghost" size="sm" onClick={fetchRegistrations} data-testid="button-refresh-history">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {registrations.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-6" data-testid="text-no-history">
                No registrations yet
              </p>
            ) : (
              <div className="space-y-3">
                {registrations.map((reg) => (
                  <div
                    key={reg.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-white"
                    data-testid={`card-registration-${reg.id}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm" data-testid={`text-name-${reg.id}`}>
                          {reg.firstName} {reg.lastName}
                        </span>
                        {getStatusBadge(reg.status)}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono" data-testid={`text-email-${reg.id}`}>
                        {reg.tempEmail}
                      </div>
                      {reg.errorMessage && (
                        <div className="text-xs text-red-500">{reg.errorMessage}</div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(reg.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
