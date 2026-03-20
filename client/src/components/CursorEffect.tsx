import { useEffect, useRef, useState } from "react";
import { sounds } from "@/lib/sounds";

interface Ripple {
  id: number;
  x: number;
  y: number;
}

export default function CursorEffect() {
  const boxRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: -200, y: -200 });
  const posRef = useRef({ x: -200, y: -200 });
  const rafRef = useRef<number>(0);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [isOnInteractive, setIsOnInteractive] = useState(false);
  const rippleCounter = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };

      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (el) {
        const interactive = el.closest('button, a, [role="button"], input, select, textarea, [data-testid], label, [onClick]');
        setIsOnInteractive(!!interactive);
      }
    };

    const onClick = (e: MouseEvent) => {
      sounds.click();
      const id = ++rippleCounter.current;
      setRipples((prev) => [...prev, { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 700);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("click", onClick, { passive: true });

    const spring = 0.12;
    const friction = 0.82;
    let velX = 0;
    let velY = 0;

    const animate = () => {
      const dx = mouseRef.current.x - posRef.current.x;
      const dy = mouseRef.current.y - posRef.current.y;
      velX = (velX + dx * spring) * friction;
      velY = (velY + dy * spring) * friction;
      posRef.current.x += velX;
      posRef.current.y += velY;

      const px = posRef.current.x;
      const py = posRef.current.y;

      if (boxRef.current) {
        boxRef.current.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
      }
      if (dotRef.current) {
        const dx2 = mouseRef.current.x - px;
        const dy2 = mouseRef.current.y - py;
        const lag = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        const maxLag = 40;
        const scale = isOnInteractive ? 1.6 : 1;
        dotRef.current.style.transform = `translate(${mouseRef.current.x}px, ${mouseRef.current.y}px) translate(-50%, -50%) scale(${scale})`;
        dotRef.current.style.opacity = lag > maxLag ? "0.4" : "1";
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("click", onClick);
      cancelAnimationFrame(rafRef.current);
    };
  }, [isOnInteractive]);

  return (
    <>
      <style>{`
        * { cursor: none !important; }
      `}</style>

      {/* Spring-following glow box */}
      <div
        ref={boxRef}
        className="fixed top-0 left-0 pointer-events-none z-[9998]"
        style={{
          width: isOnInteractive ? 44 : 32,
          height: isOnInteractive ? 44 : 32,
          borderRadius: isOnInteractive ? "12px" : "8px",
          border: `1.5px solid ${isOnInteractive ? "rgba(48,209,88,0.7)" : "rgba(255,255,255,0.28)"}`,
          background: isOnInteractive ? "rgba(48,209,88,0.07)" : "rgba(255,255,255,0.04)",
          backdropFilter: "blur(4px)",
          boxShadow: isOnInteractive
            ? "0 0 18px rgba(48,209,88,0.35), 0 0 4px rgba(48,209,88,0.2), inset 0 0 8px rgba(48,209,88,0.08)"
            : "0 0 12px rgba(255,255,255,0.06), inset 0 0 6px rgba(255,255,255,0.03)",
          transition: "width 0.2s cubic-bezier(0.34,1.56,0.64,1), height 0.2s cubic-bezier(0.34,1.56,0.64,1), border-radius 0.2s, border-color 0.2s, box-shadow 0.2s, background 0.2s",
          willChange: "transform",
        }}
      />

      {/* Precise dot that sits exactly on the mouse */}
      <div
        ref={dotRef}
        className="fixed top-0 left-0 pointer-events-none z-[9999]"
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: isOnInteractive ? "#30d158" : "rgba(255,255,255,0.85)",
          boxShadow: isOnInteractive
            ? "0 0 8px rgba(48,209,88,0.9), 0 0 14px rgba(48,209,88,0.5)"
            : "0 0 6px rgba(255,255,255,0.5)",
          transition: "background 0.15s, box-shadow 0.15s, transform 0.05s",
          willChange: "transform",
        }}
      />

      {/* Click ripples */}
      {ripples.map((r) => (
        <div
          key={r.id}
          className="fixed top-0 left-0 pointer-events-none z-[9997]"
          style={{
            left: r.x,
            top: r.y,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            className="absolute rounded-full"
            style={{
              width: 8,
              height: 8,
              transform: "translate(-50%, -50%)",
              border: "1.5px solid rgba(48,209,88,0.8)",
              background: "rgba(48,209,88,0.12)",
              animation: "rippleExpand 0.65s cubic-bezier(0.22,1,0.36,1) forwards",
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              width: 8,
              height: 8,
              transform: "translate(-50%, -50%)",
              border: "1px solid rgba(255,255,255,0.25)",
              animation: "rippleExpand2 0.65s cubic-bezier(0.22,1,0.36,1) 0.08s forwards",
            }}
          />
        </div>
      ))}

      <style>{`
        @keyframes rippleExpand {
          0%   { width: 8px; height: 8px; opacity: 0.9; }
          100% { width: 80px; height: 80px; opacity: 0; }
        }
        @keyframes rippleExpand2 {
          0%   { width: 8px; height: 8px; opacity: 0.5; }
          100% { width: 120px; height: 120px; opacity: 0; }
        }
      `}</style>
    </>
  );
}
