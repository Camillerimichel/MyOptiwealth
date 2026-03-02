"use client";

import { useEffect, useId, useRef, useState } from "react";

function toParagraphs(text: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const explicit = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (explicit.length > 1) return explicit;
  return trimmed
    .split(/(?<=[.!?])\s+(?=[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ])/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export default function InfoHint({
  text,
  className = "",
  heading = "Information",
  icon = "i",
  align: forcedAlign,
}: {
  text: string;
  className?: string;
  heading?: string;
  icon?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<"left" | "right">("left");
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const panelId = useId();
  const paragraphs = toParagraphs(text);

  useEffect(() => {
    if (forcedAlign) {
      setAlign(forcedAlign);
      return;
    }
    function recomputeAlign() {
      if (!rootRef.current || typeof window === "undefined") return;
      const rect = rootRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      setAlign(centerX > window.innerWidth / 2 ? "right" : "left");
    }
    recomputeAlign();
    window.addEventListener("resize", recomputeAlign);
    return () => window.removeEventListener("resize", recomputeAlign);
  }, [forcedAlign]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!open) return;
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={`group relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={heading}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-semibold text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {icon}
      </button>
      <span
        id={panelId}
        role="tooltip"
        className={`absolute top-6 z-[1000] w-[min(42rem,calc(100vw-1.5rem))] rounded-md border border-slate-200 bg-white p-4 ${align === "right" ? "text-right" : "text-left"} normal-case tracking-normal text-[13px] text-slate-700 shadow-xl ${
          align === "right" ? "right-0" : "left-0"
        } ${
          open ? "block" : "hidden group-hover:block group-focus-within:block"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex items-start justify-between gap-2">
          <span className={`block normal-case tracking-normal text-[13px] font-semibold text-slate-900 ${align === "right" ? "text-right" : "text-left"}`}>{heading}</span>
          <button
            type="button"
            aria-label="Fermer l'information"
            className="pointer-events-auto inline-flex h-4 w-4 items-center justify-center rounded border border-slate-200 text-[10px] leading-none text-slate-500 hover:bg-slate-50"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
          >
            ×
          </button>
        </span>
        <span className={`mt-2 block space-y-2.5 text-[13px] leading-relaxed normal-case tracking-normal ${align === "right" ? "text-right" : "text-left"}`}>
          {(paragraphs.length ? paragraphs : [text]).map((p, idx) => (
            <span key={idx} className="block font-normal normal-case tracking-normal text-slate-700">
              {p}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
