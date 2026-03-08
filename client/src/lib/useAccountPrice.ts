import { useState, useEffect } from "react";

let cachedPrice: number | null = null;

export function useAccountPrice() {
  const [price, setPrice] = useState(cachedPrice ?? 0.11);

  useEffect(() => {
    fetch("/api/settings/account-price", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const p = parseFloat(d.price) || 0.11;
        cachedPrice = p;
        setPrice(p);
      })
      .catch(() => {});
  }, []);

  return price;
}
