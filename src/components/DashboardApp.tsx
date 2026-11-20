"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  Truck,
  BrainCircuit,
  Map as MapIcon,
  Target,
  BarChart3,
  Zap,
  Menu,
  X,
  SlidersHorizontal,
  Database,
  Cloud,
  RefreshCw,
} from "lucide-react";
import type {
  FleetSummaryResponse,
  MapFocusTarget,
  PageKey,
} from "@/types/fleet";
import OverviewPage from "./OverviewPage";
import FleetMonitoringPage from "./FleetMonitoringPage";
import AiPredictionsPage from "./AiPredictionsPage";
import ChargingInfrastructurePage from "./ChargingInfrastructurePage";
import OptimizationPage from "./OptimizationPage";
import AnalyticsPage from "./AnalyticsPage";
import { PipelineControlModal } from "./ui";
import { ThemeToggleButton } from "./ThemeProvider";

const NAV_ITEMS: Array<{
  key: PageKey;
  label: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: "overview",
    label: "Executive Overview",
    title: "Executive Fleet Overview",
    subtitle:
      "Real-time EV fleet telemetry KPIs, state-of-charge health, charging demand, and SLA delay monitoring",
    icon: LayoutDashboard,
  },
  {
    key: "fleet",
    label: "Fleet Monitoring",
    title: "Fleet Telemetry Monitoring",
    subtitle:
      "Live vehicle diagnostics, remaining range, battery-risk filtering, and nearest charging station distance",
    icon: Truck,
  },
  {
    key: "predictions",
    label: "AI Predictions",
    title: "Machine Learning Predictions & Benchmarks",
    subtitle:
      "Remaining range regression (Linear vs. RF vs. XGBoost), battery-risk classification, and charging demand forecast",
    icon: BrainCircuit,
  },
  {
    key: "infrastructure",
    label: "Charging Infrastructure",
    title: "Geospatial Charging Infrastructure",
    subtitle:
      "Interactive OpenStreetMap layers for existing stations, K-Means risk & demand hotspots, and AI-recommended hubs",
    icon: MapIcon,
  },
  {
    key: "optimization",
    label: "Optimization",
    title: "Charging Station Optimization & Impact",
    subtitle:
      "Top 3 data-driven new station sites and simulated Before vs. After delivery delay impact",
    icon: Target,
  },
  {
    key: "analytics",
    label: "Analytics",
    title: "Deep Fleet & Energy Analytics",
    subtitle:
      "Telemetry correlations across area, ambient temperature, aerodynamic speed, traffic congestion, and vehicle class",
    icon: BarChart3,
  },
];

export default function DashboardApp() {
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pipelineModalOpen, setPipelineModalOpen] = useState(false);

  const [refreshToken, setRefreshToken] = useState(0);
  const [summary, setSummary] = useState<FleetSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [mapFocusTarget, setMapFocusTarget] = useState<MapFocusTarget | null>(null);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetch("/api/fleet/summary", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load fleet summary");
      setSummary(json);
    } catch (err) {
      setSummaryError(
        err instanceof Error ? err.message : "Failed to connect to analytics API"
      );
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void fetchSummary();
    }, 0);
    return () => clearTimeout(t);
  }, [fetchSummary, refreshToken]);

  const triggerGlobalRefresh = useCallback(() => {
    setRefreshToken((t) => t + 1);
  }, []);

  const handleInspectVehicle = useCallback((vehicleId: string) => {
    setSelectedVehicleId(vehicleId);
    setActivePage("fleet");
  }, []);

  const handleLocateOnMap = useCallback((target: MapFocusTarget) => {
    setMapFocusTarget(target);
    setActivePage("infrastructure");
  }, []);

  const clearSelectedVehicle = useCallback(() => setSelectedVehicleId(null), []);
  const clearMapFocus = useCallback(() => setMapFocusTarget(null), []);

  const currentNav =
    NAV_ITEMS.find((item) => item.key === activePage) ?? NAV_ITEMS[0];

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-150">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white dark:bg-slate-900 border-r border-slate-200/90 dark:border-slate-800 z-20">
        {/* Brand Header */}
        <div className="h-16 px-5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-600 dark:bg-teal-500 text-white dark:text-slate-950 flex items-center justify-center shadow-xs">
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-50">
              VoltGrid AI
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              EV Fleet & Charging Ops
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Analytics Workspace
          </div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.key === activePage;
            return (
              <button
                key={item.key}
                onClick={() => setActivePage(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? "bg-teal-50 text-teal-800 font-semibold ring-1 ring-inset ring-teal-600/15 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-400/25"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100"
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active
                      ? "text-teal-600 dark:text-teal-400"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                />
                <span className="truncate">{item.label}</span>
                {item.key === "fleet" &&
                  summary &&
                  summary.kpis.criticalBatteryVehicles > 0 && (
                    <span className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-50 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                      {summary.kpis.criticalBatteryVehicles}
                    </span>
                  )}
              </button>
            );
          })}
        </nav>

        {/* System Telemetry Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/70 p-3 space-y-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                PostgreSQL Live
              </span>
              <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                {summary
                  ? `${summary.kpis.totalTelemetryRecords.toLocaleString()} rows`
                  : "..."}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                {summary?.storage.mode === "s3" ? (
                  <Cloud className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                ) : (
                  <Database className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                )}
                Artifact Store
              </span>
              <span className="font-mono uppercase text-[10px] font-semibold text-slate-700 dark:text-slate-200">
                {summary?.storage.mode === "s3" ? "AWS S3" : "Local FS"}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 h-full shadow-xl flex flex-col z-10">
            <div className="h-16 px-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-teal-600 dark:bg-teal-500 text-white dark:text-slate-950 flex items-center justify-center">
                  <Zap className="w-4 h-4 fill-current" />
                </div>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-50">
                  VoltGrid AI
                </span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = item.key === activePage;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setActivePage(item.key);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium ${
                      active
                        ? "bg-teal-50 text-teal-800 font-semibold dark:bg-teal-500/15 dark:text-teal-300"
                        : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Workspace */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-10 bg-white/90 dark:bg-slate-950/90 backdrop-blur border-b border-slate-200/80 dark:border-slate-800 px-4 sm:px-7 py-3.5">
          <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                aria-label="Open menu"
              >
                <Menu className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50 tracking-tight truncate">
                  {currentNav.title}
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block truncate">
                  {currentNav.subtitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={triggerGlobalRefresh}
                title="Refresh live database metrics"
                aria-label="Refresh live data"
                className="inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-600 dark:text-slate-300 shadow-2xs transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${summaryLoading ? "animate-spin text-teal-600 dark:text-teal-400" : ""}`}
                />
              </button>
              <ThemeToggleButton />
              <button
                type="button"
                onClick={() => setPipelineModalOpen(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400 text-white dark:text-slate-950 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Data & ML Pipeline</span>
                <span className="sm:hidden">Pipeline</span>
              </button>
            </div>
          </div>
        </header>

        {/* Active Page Canvas */}
        <main className="flex-1 px-4 sm:px-7 py-6">
          <div className="max-w-[1440px] mx-auto">
            {activePage === "overview" && (
              <OverviewPage
                summary={summary}
                loading={summaryLoading}
                error={summaryError}
                onRetry={fetchSummary}
                onNavigate={setActivePage}
                onInspectVehicle={handleInspectVehicle}
              />
            )}
            {activePage === "fleet" && (
              <FleetMonitoringPage
                refreshToken={refreshToken}
                initialSelectedVehicle={selectedVehicleId}
                onClearInitialVehicle={clearSelectedVehicle}
                onLocateOnMap={handleLocateOnMap}
              />
            )}
            {activePage === "predictions" && (
              <AiPredictionsPage
                refreshToken={refreshToken}
                onModelsRetrained={triggerGlobalRefresh}
              />
            )}
            {activePage === "infrastructure" && (
              <ChargingInfrastructurePage
                refreshToken={refreshToken}
                focusTarget={mapFocusTarget}
                onClearFocusTarget={clearMapFocus}
              />
            )}
            {activePage === "optimization" && (
              <OptimizationPage
                refreshToken={refreshToken}
                onLocateOnMap={handleLocateOnMap}
              />
            )}
            {activePage === "analytics" && (
              <AnalyticsPage refreshToken={refreshToken} />
            )}
          </div>
        </main>
      </div>

      {/* Data Generation & ML Training Modal */}
      <PipelineControlModal
        open={pipelineModalOpen}
        onClose={() => setPipelineModalOpen(false)}
        onCompleted={triggerGlobalRefresh}
      />
    </div>
  );
}
