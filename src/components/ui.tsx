"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Inbox,
  X,
  Database,
  Cpu,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import type { BatteryRiskLevel } from "@/types/fleet";

export function KpiCard({
  label,
  value,
  unit,
  subtext,
  icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  unit?: string;
  subtext?: string;
  icon: React.ReactNode;
  tone?: "default" | "teal" | "blue" | "red" | "amber" | "emerald";
}) {
  const toneStyles: Record<string, string> = {
    default:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    teal: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    red: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    amber:
      "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    emerald:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 p-4 shadow-2xs hover:shadow-sm dark:hover:border-slate-700 transition-all">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 tracking-wide uppercase">
          {label}
        </span>
        <span
          className={`inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${toneStyles[tone]}`}
        >
          {icon}
        </span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-slate-900 dark:text-slate-50 tabular-nums tracking-tight">
          {value}
        </span>
        {unit && (
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {unit}
          </span>
        )}
      </div>
      {subtext && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
          {subtext}
        </p>
      )}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col ${className}`}
    >
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-5 flex-1">{children}</div>
    </section>
  );
}

export function RiskBadge({ risk }: { risk: BatteryRiskLevel | string }) {
  const normalized = risk.toUpperCase();
  if (normalized === "HIGH") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/30">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-600 dark:bg-rose-400" />
        HIGH
      </span>
    );
  }
  if (normalized === "MEDIUM") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
        MEDIUM
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
      LOW
    </span>
  );
}

export function BatteryBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    clamped < 22
      ? "bg-rose-500"
      : clamped < 40
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2.5 min-w-[105px]">
      <div className="w-14 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden ring-1 ring-inset ring-slate-200/80 dark:ring-slate-700">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs font-mono font-medium text-slate-800 dark:text-slate-200 tabular-nums">
        {clamped.toFixed(1)}%
      </span>
    </div>
  );
}

export function LoadingGrid({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 h-28"
          >
            <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="h-7 w-20 bg-slate-200 dark:bg-slate-800 rounded mt-4" />
            <div className="h-2.5 w-32 bg-slate-100 dark:bg-slate-800/60 rounded mt-3" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 h-72 p-5">
          <div className="h-4 w-40 bg-slate-200 dark:bg-slate-800 rounded mb-4" />
          <div className="h-52 bg-slate-100 dark:bg-slate-800/60 rounded-lg" />
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 h-72 p-5">
          <div className="h-4 w-40 bg-slate-200 dark:bg-slate-800 rounded mb-4" />
          <div className="h-52 bg-slate-100 dark:bg-slate-800/60 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-rose-900 dark:text-rose-200">
            Unable to load telemetry data
          </h3>
          <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
            {message}
          </p>
        </div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-xs font-medium text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-12 px-4 text-center flex flex-col items-center justify-center">
      <div className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-3">
        <Inbox className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function formatFeatureName(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\bkwh\b/gi, "kWh")
    .replace(/\bkmh\b/gi, "km/h")
    .replace(/\bkm\b/gi, "km")
    .replace(/\bevs\b/gi, "EVs")
    .replace(/\bc\b/g, "(°C)")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function PipelineControlModal({
  open,
  onClose,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [records, setRecords] = useState(5600);
  const [vehiclesCount, setVehiclesCount] = useState(64);
  const [seed, setSeed] = useState(42);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [busy, setBusy] = useState<"generate" | "train" | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [cleaningStats, setCleaningStats] = useState<Record<string, number> | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  async function handleGenerate() {
    setBusy("generate");
    setErrorMsg(null);
    setResultMsg(null);
    setCleaningStats(null);
    try {
      const res = await fetch("/api/data/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: Math.max(600, Math.min(25000, Number(records) || 4800)),
          vehicles: Math.max(24, Math.min(120, Number(vehiclesCount) || 60)),
          seed: Math.max(1, Math.min(999999, Number(seed) || 42)),
          mode,
          retrain: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pipeline execution failed");
      setResultMsg(data.message);
      setCleaningStats(data.pipeline?.cleaningSummary ?? null);
      onCompleted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to generate data");
    } finally {
      setBusy(null);
    }
  }

  async function handleTrainOnly() {
    setBusy("train");
    setErrorMsg(null);
    setResultMsg(null);
    setCleaningStats(null);
    try {
      const res = await fetch("/api/ml/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          random_state: Math.max(1, Math.min(999999, Number(seed) || 42)),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ML training failed");
      setResultMsg(data.message);
      onCompleted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to retrain models");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px] p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Data Pipeline & ML Orchestrator
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Generate synthetic telemetry, run validation & cleaning, and retrain ML models
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Telemetry Records
              </label>
              <input
                type="number"
                min={600}
                max={25000}
                step={400}
                value={records}
                onChange={(e) => setRecords(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 dark:focus:border-teal-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Fleet Size (EVs)
              </label>
              <input
                type="number"
                min={24}
                max={120}
                step={4}
                value={vehiclesCount}
                onChange={(e) => setVehiclesCount(Number(e.target.value))}
                disabled={mode === "append"}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 disabled:bg-slate-100 dark:disabled:bg-slate-800/40 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 dark:focus:border-teal-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Random Seed (random_state)
              </label>
              <input
                type="number"
                min={1}
                max={99999}
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 dark:focus:border-teal-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Ingestion Mode
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as "replace" | "append")}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 dark:focus:border-teal-400"
              >
                <option value="replace">Replace & Reseed</option>
                <option value="append">Append New Batch</option>
              </select>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/70 rounded-xl p-3.5 text-xs text-slate-600 dark:text-slate-300">
            <p className="font-medium text-slate-800 dark:text-slate-100 mb-1">
              Executed Pipeline Stages:
            </p>
            <p>
              Synthetic Telemetry → Missing Value Imputation → Deduplication → GPS & Speed
              Bounds Filtering → Outlier Capping → PostgreSQL (+ optional S3) → Range / Risk /
              Demand ML Training → K-Means Hotspots → Top-3 Charger Optimization.
            </p>
          </div>

          {resultMsg && (
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl p-3.5 text-xs text-emerald-900 dark:text-emerald-200 space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>{resultMsg}</span>
              </div>
              {cleaningStats && (
                <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-emerald-200/70 dark:border-emerald-500/25 font-mono text-[11px]">
                  <div>Imputed: {cleaningStats.missingValuesImputed}</div>
                  <div>Deduped: {cleaningStats.duplicatesRemoved}</div>
                  <div>Bad GPS: {cleaningStats.invalidGpsFiltered}</div>
                  <div>Bad SoC: {cleaningStats.invalidBatteryHandled}</div>
                  <div>Bad Speed: {cleaningStats.invalidSpeedFiltered}</div>
                  <div>Outliers: {cleaningStats.outliersCapped}</div>
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl p-3 text-xs text-rose-800 dark:text-rose-200">
              {errorMsg}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2">
            <button
              onClick={handleTrainOnly}
              disabled={busy !== null}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
            >
              {busy === "train" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Cpu className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              )}
              Retrain ML Only
            </button>
            <button
              onClick={handleGenerate}
              disabled={busy !== null}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-teal-600 dark:bg-teal-500 text-xs font-semibold text-white dark:text-slate-950 hover:bg-teal-700 dark:hover:bg-teal-400 disabled:opacity-50 shadow-xs cursor-pointer"
            >
              {busy === "generate" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Database className="w-3.5 h-3.5" />
              )}
              Run Full Data + ML Pipeline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
