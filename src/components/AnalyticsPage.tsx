"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { AnalyticsResponse } from "@/types/fleet";
import { SectionCard, LoadingGrid, ErrorBanner } from "./ui";
import { useChartTheme } from "./ThemeProvider";

export default function AnalyticsPage({ refreshToken }: { refreshToken: number }) {
  const ct = useChartTheme();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load deep analytics");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deep analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadAnalytics();
    }, 0);
    return () => clearTimeout(t);
  }, [loadAnalytics, refreshToken]);

  if (loading && !data) return <LoadingGrid cards={4} />;
  if (error || !data) {
    return (
      <ErrorBanner
        message={error ?? "Deep fleet analytics unavailable"}
        onRetry={loadAnalytics}
      />
    );
  }

  const areaData = data.evsByArea.map((a) => ({
    ...a,
    shortArea: a.area.replace(" & ", "/").split(" ").slice(0, 2).join(" "),
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 1. EVs by Area */}
        <SectionCard
          title="EV Fleet Distribution & Risk by Area"
          subtitle="Active vehicle count segmented by ML-predicted battery risk across Austin logistics zones"
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={areaData}
                margin={{ top: 8, right: 12, left: -14, bottom: 4 }}
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
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: ct.cursorFill }}
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.tooltipLabelStyle}
                  itemStyle={ct.tooltipItemStyle}
                />
                <Legend wrapperStyle={ct.legendStyle} />
                <Bar
                  dataKey="low_risk_evs"
                  name="Low Risk"
                  stackId="ev"
                  fill="#10b981"
                />
                <Bar
                  dataKey="medium_risk_evs"
                  name="Medium Risk"
                  stackId="ev"
                  fill="#f59e0b"
                />
                <Bar
                  dataKey="high_risk_evs"
                  name="High Risk"
                  stackId="ev"
                  fill="#ef4444"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* 2. Battery Trends */}
        <SectionCard
          title="Fleet Battery SoC Trends (Mean vs. 15th Percentile)"
          subtitle="Daily average state-of-charge alongside lower-tail discharge envelope"
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.batteryTrends}
                margin={{ top: 8, right: 12, left: -12, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={ct.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={{ stroke: ct.axisStroke }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.tooltipLabelStyle}
                  itemStyle={ct.tooltipItemStyle}
                />
                <Legend wrapperStyle={ct.legendStyle} />
                <Line
                  type="monotone"
                  dataKey="avg_battery_pct"
                  name="Mean Battery (%)"
                  stroke="#14b8a6"
                  strokeWidth={2.4}
                  dot={{ r: 3.5 }}
                />
                <Line
                  type="monotone"
                  dataKey="p15_battery_pct"
                  name="P15 Tail Battery (%)"
                  stroke="#ef4444"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* 3. Temperature vs Range */}
        <SectionCard
          title="Ambient Temperature vs. Remaining Range"
          subtitle="Thermal efficiency curve showing optimal 15–25°C range band and cold/heat HVAC losses"
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.temperatureVsRange}
                margin={{ top: 8, right: 12, left: -8, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="tempRangeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={ct.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="temp_label"
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={{ stroke: ct.axisStroke }}
                  tickLine={false}
                />
                <YAxis
                  unit=" km"
                  tick={{ fontSize: 11, fill: ct.tickFill }}
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
                  dataKey="normalized_80pct_range_km"
                  name="80%-SoC Equivalent Range (km)"
                  stroke="#3b82f6"
                  strokeWidth={2.3}
                  fill="url(#tempRangeGrad)"
                />
                <Line
                  type="monotone"
                  dataKey="avg_range_km"
                  name="Observed Mean Range (km)"
                  stroke="#14b8a6"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* 4. Speed vs Energy Consumption */}
        <SectionCard
          title="Vehicle Speed vs. Energy Consumption"
          subtitle="Aerodynamic drag impact on mean drivetrain consumption (kWh/km) across speed bands"
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.speedVsEnergy}
                margin={{ top: 8, right: 12, left: -4, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={ct.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="speed_label"
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={{ stroke: ct.axisStroke }}
                  tickLine={false}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.tooltipLabelStyle}
                  itemStyle={ct.tooltipItemStyle}
                  formatter={(v) => [`${v} kWh/km`, "Energy Consumption"]}
                />
                <Line
                  type="monotone"
                  dataKey="avg_energy_kwh_km"
                  name="Mean Consumption (kWh/km)"
                  stroke="#f43f5e"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: "#f43f5e" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* 5. Traffic Level vs Delivery Delay */}
        <SectionCard
          title="Traffic Congestion vs. Delivery Delay"
          subtitle="Mean and 90th-percentile route delay (minutes) by traffic severity tier"
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.trafficVsDelay}
                margin={{ top: 8, right: 12, left: -12, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={ct.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="traffic_level"
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
                  formatter={(v) => [`${v} min`]}
                />
                <Legend wrapperStyle={ct.legendStyle} />
                <Bar
                  dataKey="avg_delay_min"
                  name="Mean Delay (min)"
                  fill="#f59e0b"
                  radius={[5, 5, 0, 0]}
                />
                <Bar
                  dataKey="p90_delay_min"
                  name="P90 Tail Delay (min)"
                  fill="#ef4444"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* 6. Charging Demand by Hour */}
        <SectionCard
          title="Charging Demand & Low-SoC Pressure by Hour"
          subtitle="24-hour diurnal charging demand (kWh) paired with sub-30% low-battery telemetry events"
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data.chargingDemandByHour}
                margin={{ top: 8, right: 10, left: -8, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={ct.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="hourLabel"
                  interval={3}
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={{ stroke: ct.axisStroke }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: ct.cursorFill }}
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.tooltipLabelStyle}
                  itemStyle={ct.tooltipItemStyle}
                />
                <Legend wrapperStyle={ct.legendStyle} />
                <Bar
                  yAxisId="left"
                  dataKey="predictedDemandKwh"
                  name="Charging Demand (kWh)"
                  fill="#14b8a6"
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="lowBatteryEvents"
                  name="Low-SoC Events"
                  stroke="#f59e0b"
                  strokeWidth={2.2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      {/* 7. Vehicle Class Efficiency Benchmark */}
      <SectionCard
        title="Vehicle Class Energy Efficiency & Payload Benchmark"
        subtitle="Comparative drivetrain efficiency (km/kWh & kWh/km), gross weight, and remaining range across EV fleet classes"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-5 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={data.vehicleEfficiency}
                margin={{ top: 4, right: 16, left: 16, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={ct.gridStroke}
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  unit=" km/kWh"
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={{ stroke: ct.axisStroke }}
                />
                <YAxis
                  type="category"
                  dataKey="vehicle_type"
                  width={130}
                  tick={{ fontSize: 11, fill: ct.categoryTickFill }}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: ct.cursorFill }}
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.tooltipLabelStyle}
                  itemStyle={ct.tooltipItemStyle}
                  formatter={(v) => [`${v} km/kWh`, "Efficiency"]}
                />
                <Bar
                  dataKey="km_per_kwh"
                  fill="#14b8a6"
                  radius={[0, 6, 6, 0]}
                  barSize={20}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="lg:col-span-7 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-3">Vehicle Type</th>
                  <th className="py-2.5 px-3">EVs</th>
                  <th className="py-2.5 px-3">Pack</th>
                  <th className="py-2.5 px-3">Avg Weight</th>
                  <th className="py-2.5 px-3">kWh / km</th>
                  <th className="py-2.5 px-3">km / kWh</th>
                  <th className="py-2.5 px-3">Avg Range</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                {data.vehicleEfficiency.map((ve) => (
                  <tr
                    key={ve.vehicle_type}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-900 dark:text-slate-100">
                      {ve.vehicle_type}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                      {ve.fleet_count}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                      {ve.battery_capacity_kwh} kWh
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                      {ve.avg_weight_kg.toLocaleString()} kg
                    </td>
                    <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200">
                      {ve.avg_kwh_per_km.toFixed(3)}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-teal-700 dark:text-teal-400">
                      {ve.km_per_kwh.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                      {ve.avg_range_km.toFixed(1)} km
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
