"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Star,
  MapPin,
  TrendingDown,
  ShieldCheck,
  Navigation,
  HelpCircle,
  ArrowRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type {
  RecommendationsResponse,
  DeliveryImpactResponse,
  MapFocusTarget,
} from "@/types/fleet";
import { SectionCard, LoadingGrid, ErrorBanner } from "./ui";
import { useChartTheme } from "./ThemeProvider";

export default function OptimizationPage({
  refreshToken,
  onLocateOnMap,
}: {
  refreshToken: number;
  onLocateOnMap: (target: MapFocusTarget) => void;
}) {
  const ct = useChartTheme();
  const [recData, setRecData] = useState<RecommendationsResponse | null>(null);
  const [impact, setImpact] = useState<DeliveryImpactResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOpt = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/recommendations", { cache: "no-store" }),
        fetch("/api/delivery-impact", { cache: "no-store" }),
      ]);
      const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
      if (!r1.ok) throw new Error(j1.error || "Failed to load recommendations");
      if (!r2.ok) throw new Error(j2.error || "Failed to load delay impact");
      setRecData(j1);
      setImpact(j2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load optimization results");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadOpt();
    }, 0);
    return () => clearTimeout(t);
  }, [loadOpt, refreshToken]);

  if (loading && !recData) return <LoadingGrid cards={3} />;
  if (error || !recData || !impact) {
    return (
      <ErrorBanner
        message={error ?? "Station optimization results unavailable"}
        onRetry={loadOpt}
      />
    );
  }

  const top3 = recData.recommendations.filter((r) => r.rank <= 3);

  const weightItems = [
    { label: "Battery-Risk Demand", pct: 30, color: "bg-rose-500" },
    { label: "EV Traffic Density", pct: 25, color: "bg-teal-500" },
    { label: "Delivery Delay Severity", pct: 20, color: "bg-amber-500" },
    { label: "Distance to Existing Chargers", pct: 15, color: "bg-blue-600" },
    { label: "Predicted Charging Demand", pct: 10, color: "bg-indigo-500" },
  ];

  return (
    <div className="space-y-6">
      {/* Top 3 Recommended Charging Station Hero Cards */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3.5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
              Top 3 AI-Recommended Charging Station Locations
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Computed via {recData.methodology.algorithm} (min{" "}
              {recData.methodology.minSeparationBetweenNewStationsKm} km inter-hub spacing)
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
            {impact.evaluatedTelemetryRecords.toLocaleString()} telemetry records evaluated
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {top3.map((site) => (
            <div
              key={site.rank}
              className={`bg-white dark:bg-slate-900 rounded-xl border shadow-2xs flex flex-col justify-between overflow-hidden ${
                site.rank === 1
                  ? "border-blue-300 ring-1 ring-blue-500/15 dark:border-blue-500/50 dark:ring-blue-500/25"
                  : "border-slate-200/90 dark:border-slate-800"
              }`}
            >
              <div className="p-5 space-y-4">
                {/* Header: Rank + Score */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        site.rank === 1
                          ? "bg-blue-600 dark:bg-blue-500 text-white"
                          : "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                      }`}
                    >
                      <Star className="w-3 h-3 fill-current" />
                      RANK #{site.rank}
                    </span>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-50 mt-2 leading-snug">
                      {site.corridor_label}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                      {site.area}
                    </p>
                    <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5 tabular-nums">
                      {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)}
                    </p>
                  </div>
                  <div className="text-right bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-xl px-3 py-2 shrink-0">
                    <div className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                      Score
                    </div>
                    <div className="text-xl font-bold font-mono text-blue-700 dark:text-blue-400 tabular-nums">
                      {site.score.toFixed(1)}
                    </div>
                  </div>
                </div>

                {/* Key Impact Metrics Grid */}
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="bg-slate-50 dark:bg-slate-800/70 rounded-lg p-2.5 border border-slate-100 dark:border-slate-700/70">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      EV Coverage
                    </div>
                    <div className="font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                      {site.expected_ev_coverage} EVs
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/70 rounded-lg p-2.5 border border-slate-100 dark:border-slate-700/70">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Battery-Risk Reduction
                    </div>
                    <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                      -{site.battery_risk_reduction_pct.toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/70 rounded-lg p-2.5 border border-slate-100 dark:border-slate-700/70">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Expected Delay Cut
                    </div>
                    <div className="font-mono font-bold text-teal-700 dark:text-teal-400 mt-0.5 tabular-nums">
                      -{site.expected_delay_reduction.toFixed(1)}m (-
                      {site.expected_delay_reduction_pct.toFixed(1)}%)
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/70 rounded-lg p-2.5 border border-slate-100 dark:border-slate-700/70">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Nearest Station
                    </div>
                    <div className="font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                      {site.nearest_existing_station_distance.toFixed(2)} km
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/70 rounded-lg p-2.5 border border-slate-100 dark:border-slate-700/70">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Predicted Demand
                    </div>
                    <div className="font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                      {Math.round(site.predicted_daily_demand_kwh).toLocaleString()} kWh/d
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/70 rounded-lg p-2.5 border border-slate-100 dark:border-slate-700/70">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Recommended Spec
                    </div>
                    <div className="font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                      {site.recommended_ports}× {site.recommended_power_kw} kW
                    </div>
                  </div>
                </div>

                {/* Sub-score mini bars */}
                <div className="space-y-1.5 pt-1">
                  {[
                    {
                      k: "Risk Demand (30%)",
                      v: site.sub_scores.battery_risk_demand,
                      c: "bg-rose-500",
                    },
                    {
                      k: "Traffic Density (25%)",
                      v: site.sub_scores.ev_traffic_density,
                      c: "bg-teal-500",
                    },
                    {
                      k: "Delay Severity (20%)",
                      v: site.sub_scores.delivery_delay,
                      c: "bg-amber-500",
                    },
                    {
                      k: "Charger Gap (15%)",
                      v: site.sub_scores.charger_gap_distance,
                      c: "bg-blue-500",
                    },
                    {
                      k: "Future Demand (10%)",
                      v: site.sub_scores.predicted_demand,
                      c: "bg-indigo-500",
                    },
                  ].map((s) => (
                    <div key={s.k} className="flex items-center gap-2 text-[11px]">
                      <span className="w-32 text-slate-500 dark:text-slate-400 truncate">
                        {s.k}
                      </span>
                      <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${s.c}`}
                          style={{ width: `${Math.min(100, s.v)}%` }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                        {s.v.toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Why This Location? Explanation */}
                <div className="rounded-xl bg-blue-50/55 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/25 p-3.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  <div className="font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-1.5 mb-1">
                    <HelpCircle className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    Why this location?
                  </div>
                  <p>{site.rationale}</p>
                </div>
              </div>

              <div className="px-5 py-3 bg-slate-50/80 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() =>
                    onLocateOnMap({
                      latitude: site.latitude,
                      longitude: site.longitude,
                      label: site.corridor_label,
                      rank: site.rank,
                    })
                  }
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/15 hover:border-blue-200 dark:hover:border-blue-500/40 transition-colors cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Inspect Rank #{site.rank} on Geospatial Map
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* BEFORE vs AFTER Delivery Delay Impact Simulation */}
      <SectionCard
        title="Simulated Delivery Delay & Infrastructure Impact (BEFORE vs. AFTER)"
        subtitle={`Directly calculated from fleet telemetry comparing ${impact.existingStationsCount} existing stations vs. ${impact.totalInfrastructureAfter} stations (existing + Top 3 recommended)`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Delay Reduction */}
          <div className="rounded-xl border border-teal-200 dark:border-teal-500/30 bg-teal-50/45 dark:bg-teal-500/10 p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-teal-800 dark:text-teal-300">
              <span>Avg Delivery Delay</span>
              <TrendingDown className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            </div>
            <div className="mt-2 flex items-center gap-2 font-mono tabular-nums">
              <span className="text-sm text-slate-500 dark:text-slate-400 line-through">
                {impact.before.avgDeliveryDelayMinutes.toFixed(2)}m
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xl font-bold text-slate-900 dark:text-slate-50">
                {impact.after.avgDeliveryDelayMinutes.toFixed(2)}m
              </span>
            </div>
            <div className="mt-1.5 text-xs font-semibold text-teal-700 dark:text-teal-400">
              {impact.impact.deliveryDelayReductionPct.toFixed(1)}% simulated delay reduction
            </div>
          </div>

          {/* Critical Battery Events */}
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/45 dark:bg-emerald-500/10 p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <span>Critical Battery Events</span>
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2 flex items-center gap-2 font-mono tabular-nums">
              <span className="text-sm text-slate-500 dark:text-slate-400 line-through">
                {impact.before.criticalBatteryEvents}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xl font-bold text-slate-900 dark:text-slate-50">
                {impact.after.criticalBatteryEvents}
              </span>
            </div>
            <div className="mt-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              -{impact.impact.criticalEventsReductionPct.toFixed(1)}% (
              {impact.impact.criticalEventsPrevented} prevented)
            </div>
          </div>

          {/* Avg Distance to Station */}
          <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/45 dark:bg-blue-500/10 p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-blue-800 dark:text-blue-300">
              <span>Avg Distance to Charger</span>
              <Navigation className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="mt-2 flex items-center gap-2 font-mono tabular-nums">
              <span className="text-sm text-slate-500 dark:text-slate-400 line-through">
                {impact.before.avgDistanceToStationKm.toFixed(2)} km
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xl font-bold text-slate-900 dark:text-slate-50">
                {impact.after.avgDistanceToStationKm.toFixed(2)} km
              </span>
            </div>
            <div className="mt-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400">
              -{impact.impact.distanceReductionPct.toFixed(1)}% shorter detour distance
            </div>
          </div>

          {/* 3.5 km Coverage */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              3.5 km Charger Coverage
            </div>
            <div className="mt-2 flex items-center gap-2 font-mono tabular-nums">
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {impact.before.fleetWithin3_5KmPct.toFixed(1)}%
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xl font-bold text-slate-900 dark:text-slate-50">
                {impact.after.fleetWithin3_5KmPct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
              +{impact.impact.totalWeeklyDelayHoursSaved.toFixed(1)} fleet hrs saved / week
            </div>
          </div>
        </div>

        {/* Before vs After Delay Chart by Area */}
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={impact.areaComparison.map((a) => ({
                ...a,
                shortArea: a.area.replace(" & ", "/").split(" ").slice(0, 2).join(" "),
              }))}
              margin={{ top: 8, right: 12, left: -12, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={ct.gridStroke}
                vertical={false}
              />
              <XAxis
                dataKey="shortArea"
                tick={{ fontSize: 11, fill: ct.tickFill }}
                axisLine={{ stroke: ct.axisStroke }}
                tickLine={false}
              />
              <YAxis
                unit="m"
                tick={{ fontSize: 11, fill: ct.tickFill }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: ct.cursorFill }}
                contentStyle={ct.tooltipStyle}
                labelStyle={ct.tooltipLabelStyle}
                itemStyle={ct.tooltipItemStyle}
                formatter={(val) => [`${val} min`]}
              />
              <Legend wrapperStyle={ct.legendStyle} />
              <Bar
                dataKey="beforeAvgDelayMinutes"
                name="BEFORE: Existing Infrastructure (min)"
                fill={ct.isDark ? "#64748b" : "#94a3b8"}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="afterAvgDelayMinutes"
                name="AFTER: + Top 3 Recommended Stations (min)"
                fill="#14b8a6"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* Transparent Scoring Formula + Full Candidate Table */}
      <SectionCard
        title="Transparent Multi-Criteria Scoring Model & Candidate Rankings"
        subtitle="Charging Score = 30% Battery-Risk Demand + 25% EV Traffic Density + 20% Delivery Delay + 15% Charger Gap + 10% Predicted Demand"
      >
        <div className="flex flex-wrap gap-2 mb-4">
          {weightItems.map((w) => (
            <span
              key={w.label}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300"
            >
              <span className={`w-2.5 h-2.5 rounded-full ${w.color}`} />
              <strong className="font-mono text-slate-900 dark:text-slate-100">
                {w.pct}%
              </strong>{" "}
              {w.label}
            </span>
          ))}
        </div>

        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-5">Rank</th>
                <th className="py-2.5 px-3.5">Candidate Corridor & Area</th>
                <th className="py-2.5 px-3.5">Coordinates</th>
                <th className="py-2.5 px-3.5">Score</th>
                <th className="py-2.5 px-3.5">EV Coverage</th>
                <th className="py-2.5 px-3.5">Delay Cut</th>
                <th className="py-2.5 px-5">Nearest Charger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
              {recData.recommendations.map((r) => (
                <tr
                  key={r.rank}
                  className={
                    r.rank <= 3
                      ? "bg-blue-50/35 dark:bg-blue-500/10"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  }
                >
                  <td className="py-2.5 px-5 font-mono font-bold text-slate-900 dark:text-slate-100">
                    {r.rank <= 3 ? `★ #${r.rank}` : `#${r.rank}`}
                  </td>
                  <td className="py-2.5 px-3.5">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {r.corridor_label}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {r.area}
                    </div>
                  </td>
                  <td className="py-2.5 px-3.5 font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}
                  </td>
                  <td className="py-2.5 px-3.5 font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                    {r.score.toFixed(1)}
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {r.expected_ev_coverage} EVs
                  </td>
                  <td className="py-2.5 px-3.5 font-mono text-teal-700 dark:text-teal-400 font-semibold tabular-nums">
                    -{r.expected_delay_reduction_pct.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-5 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {r.nearest_existing_station_distance.toFixed(2)} km (
                    {r.nearest_existing_station_id})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
