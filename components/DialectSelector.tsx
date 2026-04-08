"use client";

import { ChevronDown, Database } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const DIALECTS = [
  { label: "Standard SQL", value: "Standard SQL" },
  { label: "PostgreSQL", value: "Postgres" },
  { label: "MySQL", value: "MySQL" },
  { label: "BigQuery", value: "BigQuery" },
  { label: "SQLite", value: "SQLite" },
] as const;

interface DialectSelectorProps {
  value: string;
  onChange: (dialect: string) => void;
  disabled?: boolean;
}

export default function DialectSelector({
  value,
  onChange,
  disabled,
}: DialectSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = DIALECTS.find((d) => d.value === value) ?? DIALECTS[0];

  return (
    <div ref={ref} className="dialect-selector relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold tracking-wider transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          borderColor: open
            ? "rgba(99, 102, 241, 0.5)"
            : "rgba(255,255,255,0.08)",
          background: open
            ? "rgba(99, 102, 241, 0.08)"
            : "rgba(255,255,255,0.02)",
          color: open ? "var(--text-primary)" : "var(--text-secondary)",
          boxShadow: open ? "0 0 16px rgba(99,102,241,0.12)" : "none",
        }}
      >
        <Database size={13} className="opacity-60" />
        <span className="uppercase">{selected.label}</span>
        <ChevronDown
          size={13}
          className="opacity-50 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 z-50 w-44 rounded-xl border p-1 shadow-2xl animate-fade-in-up"
          style={{
            borderColor: "rgba(255,255,255,0.08)",
            background: "rgba(18,20,30,0.98)",
            backdropFilter: "blur(20px)",
          }}
        >
          {DIALECTS.map((dialect) => (
            <button
              key={dialect.value}
              onClick={() => {
                onChange(dialect.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors text-left"
              style={{
                color:
                  value === dialect.value
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                background:
                  value === dialect.value
                    ? "rgba(99,102,241,0.12)"
                    : "transparent",
              }}
              onMouseEnter={(e) => {
                if (value !== dialect.value) {
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }
              }}
              onMouseLeave={(e) => {
                if (value !== dialect.value) {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              {value === dialect.value && (
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
              )}
              <span>{dialect.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
