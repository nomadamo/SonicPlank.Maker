import { motion } from "motion/react";
import { useEffect, useState } from "react";

export function SplashOverlay({ visible }: { visible: boolean }) {
  const [mounted, setMounted] = useState(true);

  // Unmount after fade-out so it's fully out of the DOM
  useEffect(() => {
    if (!visible) {
      const t = setTimeout(() => setMounted(false), 800);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (!mounted) return null;

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
      className="fixed inset-0 z-9999 flex flex-col items-center justify-center select-none pointer-events-none"
      style={{
        background:
          "radial-gradient(ellipse 70% 60% at 50% 45%, rgba(99,102,241,0.06) 0%, transparent 70%), #09090b",
      }}
    >
      {/* App icon */}
      <motion.img
        src="/img/icon.png"
        width={52}
        height={52}
        draggable={false}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 0.85, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        className="mb-9"
      />

      {/* Indeterminate spinner ring */}
      <SpinnerRing />

      {/* Status */}
      <p className="mt-5 text-[10px] font-semibold tracking-[0.3em] uppercase text-zinc-600">
        Initializing
      </p>

      {/* App name */}
      <p className="mt-2 text-[11px] font-medium text-zinc-700">
        SonicPlank.Maker
      </p>
    </motion.div>
  );
}

function SpinnerRing() {
  const r = 14;
  const size = 36;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;
  const arcLength = circumference * 0.28;
  const gapLength = circumference - arcLength;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{ animation: "splash-spin 1.1s linear infinite" }}
      >
        {/* Track */}
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="#27272a"
          strokeWidth="2.5"
        />
        {/* Arc */}
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="#6366f1"
          strokeWidth="2.5"
          strokeDasharray={`${arcLength} ${gapLength}`}
          strokeLinecap="round"
        />
      </svg>

      <style>{`
        @keyframes splash-spin {
          from { transform: rotate(-90deg); }
          to   { transform: rotate(270deg); }
        }
      `}</style>
    </div>
  );
}
