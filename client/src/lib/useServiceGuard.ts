import { useState, useEffect } from "react";
import { useLocation } from "wouter";

export function useServiceGuard(serviceId: string) {
  const [, navigate] = useLocation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data.role === "superadmin") {
          setChecking(false);
          return;
        }
        const allowed: string[] = data.allowedServices || [];
        if (!allowed.includes(serviceId)) {
          navigate("/admin/create-server");
        } else {
          setChecking(false);
        }
      })
      .catch(() => {
        navigate("/");
      });
  }, [serviceId, navigate]);

  return { checking };
}
