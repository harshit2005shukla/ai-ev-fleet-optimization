"use client";

import React from "react";
import {
  Truck,
  Activity,
  BatteryCharging,
  AlertOctagon,
  Gauge,
  Clock,
  Zap,
  ArrowUpRight,
  MapPin,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  LineChart,
  Line,
  Legend,
  ReferenceLine,
} from "recharts";
import type { FleetSummaryResponse, PageKey } from "@/types/fleet";
import {
  KpiCard,
  SectionCard,
  RiskBadge,
  BatteryBar,
  LoadingGrid,
  ErrorBanner,
} from "./ui";
import { useChartTheme } from "./ThemeProvider";

const BATTERY_BUCKET_COLORS = [
  "#ef4444", // 0-20%
  "#f59e0b", // 20-40%
  "#0ea5e9", // 40-60%
  "#14b8a6", // 60-80%
  "#10b981", // 80-100%
];

export default function OverviewPage({
  summary,
  loading,
  error,
  onRetry,
  onNavigate,
  onInspectVehicle,
}: {
  summary: FleetSummaryResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onNavigate: (page: PageKey) => void;
  onInspectVehicle: (vehicleId: string) => void;
}) {
  const ct = useChartTheme();

  if (loading && !summary) {
    return <LoadingGrid cards={4} />;
  }
  if (error || !summary) {
    return (
      <ErrorBanner
        message={error ?? "Fleet summary is unavailable."}
        onRetry={onRetry}
      />
    );
  }

  const { kpis, batteryDistribution, dailyTrends, priorityWatchlist, riskBreakdown } =
    summary;
  const activePct =
    kpis.totalEvs > 0 ? Math.round((kpis.activeEvs / kpis.totalEvs) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Executive 7-KPI Grid — spacious on laptop & ultrawide */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 gap-3.5">
        <KpiCard
          label="Total EVs"
          value={kpis.totalEvs}
          subtext={`${kpis.totalTrips.toLocaleString()} logged trips`}
          icon={<Truck className="w-4 h-4" />}
          tone="default"
        />
        <KpiCard
          label="Active EVs"
          value={kpis.activeEvs}
          subtext={`${activePct}% fleet utilization`}
          icon={<Activity className="w-4 h-4" />}
          tone="teal"
        />
        <KpiCard
          label="Avg Battery"
          value={`${kpis.avgBatteryPct.toFixed(1)}%`}
          subtext={`${kpis.chargingEvs} currently charging`}
          icon={<BatteryCharging className="w-4 h-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Critical EVs"
          value={kpis.criticalBatteryVehicles}
          subtext={`${riskBreakdown.HIGH} HIGH · ${riskBreakdown.MEDIUM} MED risk`}
          icon={<AlertOctagon className="w-4 h-4" />}
          tone="red"
        />
        <KpiCard
          label="Avg Range"
          value={kpis.avgRemainingRangeKm.toFixed(1)}
          unit="km"
          subtext={`${kpis.avgDistanceToChargerKm} km to charger`}
          icon={<Gauge className="w-4 h-4" />}
          tone="blue"
        />
        <KpiCard
          label="Avg Delay"
          value={kpis.avgDeliveryDelayMin.toFixed(1)}
          unit="min"
          subtext="Last-mile route SLA"
          icon={<Clock className="w-4 h-4" />}
          tone="amber"
        />
        <KpiCard
          label="Charging Demand"
          value={kpis.predictedChargingDemandKwh.toLocaleString()}
          unit="kWh"
          subtext="Next 24h ML forecast"
          icon={<Zap className="w-4 h-4" />}
          tone="teal"
        />
      </div>

      {/* Primary 2x2 Executive Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 1. Battery Distribution */}
        <SectionCard
          title="Battery State-of-Charge Distribution"
          subtitle="Live distribution of fleet vehicles across battery percentage bands"
          action={
            <button
              onClick={() => onNavigate("fleet")}
              className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 inline-flex items-center gap-1 cursor-pointer"
            >
              Fleet table
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          }
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={batteryDistribution}
                margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={ct.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="band"
                  tick={{ fontSize: 12, fill: ct.tickFill }}
                  axisLine={{ stroke: ct.axisStroke }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: ct.tickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: ct.cursorFill }}
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.tooltipLabelStyle}
                  itemStyle={ct.tooltipItemStyle}
                  formatter={(value) => [`${value} EVs`, "Vehicles"]}
                />
                <Bar dataKey="vehicles" radius={[6, 6, 0, 0]} maxBarSize={54}>
                  {batteryDistribution.map((entry, idx) => (
                    <Cell
                      key={entry.band}
                      fill={BATTERY_BUCKET_COLORS[idx % BATTERY_BUCKET_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* 2. Fleet Health Trend */}
        <SectionCard
          title="Fleet Health & Battery Trend"
          subtitle="7-day healthy state-of-charge compliance (%) vs. mean fleet battery level"
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={dailyTrends}
                margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="socGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={ct.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12, fill: ct.tickFill }}
                  axisLine={{ stroke: ct.axisStroke }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fontSize: 12, fill: ct.tickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.tooltipLabelStyle}
                  itemStyle={ct.tooltipItemStyle}
                />
                <Legend wrapperStyle={ct.legendStyle} />
                <Area
                  type="monotone"
                  dataKey="fleetHealthScore"
                  name="Fleet Health Score (%)"
                  stroke="#14b8a6"
                  strokeWidth={2.2}
                  fill="url(#healthGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="avgBatteryPct"
                  name="Avg Battery SoC (%)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#socGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* 3. Charging Demand Trend */}
        <SectionCard
          title="Charging Demand Trend"
          subtitle="Daily dispensed station energy vs. projected fleet demand (kWh)"
          action={
            <button
              onClick={() => onNavigate("infrastructure")}
              className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 inline-flex items-center gap-1 cursor-pointer"
            >
              Station map
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          }
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={dailyTrends}
                margin={{ top: 8, right: 12, left: -4, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={ct.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12, fill: ct.tickFill }}
                  axisLine={{ stroke: ct.axisStroke }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: ct.tickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.tooltipLabelStyle}
                  itemStyle={ct.tooltipItemStyle}
                  formatter={(val) => [`${Number(val).toLocaleString()} kWh`]}
                />
                <Legend wrapperStyle={ct.legendStyle} />
                <Line
                  type="monotone"
                  dataKey="chargingEnergyKwh"
                  name="Dispensed Energy (kWh)"
                  stroke="#10b981"
                  strokeWidth={2.4}
                  dot={{ r: 3.5, fill: "#10b981" }}
                />
                <Line
                  type="monotone"
                  dataKey="predictedDemandKwh"
                  name="Total Demand Load (kWh)"
                  stroke="#f59e0b"
                  strokeWidth={2.2}
                  strokeDasharray="5 4"
                  dot={{ r: 3, fill: "#f59e0b" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* 4. Delivery Delay Trend */}
        <SectionCard
          title="Delivery Delay Trend"
          subtitle="Mean daily delivery delay (minutes) influenced by congestion and charger detours"
          action={
            <button
              onClick={() => onNavigate("optimization")}
              className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 inline-flex items-center gap-1 cursor-pointer"
            >
              Reduce delays
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          }
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={dailyTrends}
                margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="delayGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={ct.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12, fill: ct.tickFill }}
                  axisLine={{ stroke: ct.axisStroke }}
                  tickLine={false}
                />
                <YAxis
                  unit="m"
                  tick={{ fontSize: 12, fill: ct.tickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.tooltipLabelStyle}
                  itemStyle={ct.tooltipItemStyle}
                  formatter={(val) => [`${val} min`, "Avg Delivery Delay"]}
                />
                <ReferenceLine
                  y={8}
                  stroke={ct.refLineStroke}
                  strokeDasharray="4 4"
                  label={{
                    value: "8 min SLA target",
                    position: "insideTopRight",
                    fill: ct.tickFill,
                    fontSize: 11,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="avgDelayMin"
                  name="Avg Delay (min)"
                  stroke={ct.isDark ? "#fbbf24" : "#d97706"}
                  strokeWidth={2.3}
                  fill="url(#delayGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      {/* Priority Battery-Risk Watchlist */}
      <SectionCard
        title="Priority Battery-Risk Watchlist"
        subtitle="Vehicles requiring immediate dispatch attention based on ML battery-risk score and charger proximity"
        action={
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate("optimization")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/25 text-xs font-semibold transition-colors cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5" />
              Top 3 Station Recommendations
            </button>
            <button
              onClick={() => onNavigate("fleet")}
              className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 inline-flex items-center gap-1 cursor-pointer"
            >
              View all {kpis.totalEvs} EVs
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-5">Vehicle ID</th>
                <th className="py-2.5 px-4">Class</th>
                <th className="py-2.5 px-4">Operational Area</th>
                <th className="py-2.5 px-4">Battery SoC</th>
                <th className="py-2.5 px-4">ML Predicted Range</th>
                <th className="py-2.5 px-4">Nearest Charger</th>
                <th className="py-2.5 px-4">Route Delay</th>
                <th className="py-2.5 px-5">Risk Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
              {priorityWatchlist.map((v) => (
                <tr
                  key={v.vehicle_id}
                  onClick={() => onInspectVehicle(v.vehicle_id)}
                  className="hover:bg-slate-50/90 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-5 font-mono text-xs font-semibold text-teal-700 dark:text-teal-400">
                    {v.vehicle_id}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                    {v.vehicle_type}
                  </td>
                  <td className="py-3 px-4 text-xs font-medium text-slate-800 dark:text-slate-200">
                    {v.area}
                  </td>
                  <td className="py-3 px-4">
                    <BatteryBar pct={v.battery_percentage} />
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-800 dark:text-slate-200 tabular-nums">
                    {v.predicted_range_km.toFixed(1)} km
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums">
                    {v.nearest_station_distance_km.toFixed(2)} km
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums">
                    {v.delivery_delay_minutes.toFixed(1)} min
                  </td>
                  <td className="py-3 px-5">
                    <RiskBadge risk={v.battery_risk} />
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
