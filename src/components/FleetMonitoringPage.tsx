"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Search,
  RotateCcw,
  Download,
  ChevronLeft,
  ChevronRight,
  X,
  MapPin,
  Thermometer,
  Gauge,
  Zap,
  Navigation,
  Loader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type {
  VehiclesResponse,
  VehicleDetailResponse,
  VehicleListItem,
  MapFocusTarget,
} from "@/types/fleet";
import {
  SectionCard,
  RiskBadge,
  BatteryBar,
  ErrorBanner,
  EmptyState,
  LoadingGrid,
} from "./ui";
import { useChartTheme } from "./ThemeProvider";

export default function FleetMonitoringPage({
  refreshToken,
  initialSelectedVehicle,
  onClearInitialVehicle,
  onLocateOnMap,
}: {
  refreshToken: number;
  initialSelectedVehicle: string | null;
  onClearInitialVehicle: () => void;
  onLocateOnMap: (target: MapFocusTarget) => void;
}) {
  const ct = useChartTheme();

  const [risk, setRisk] = useState("ALL");
  const [area, setArea] = useState("ALL");
  const [vehicleType, setVehicleType] = useState("ALL");
  const [timeRange, setTimeRange] = useState("7d");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<VehiclesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedVehicle);
  const [detail, setDetail] = useState<VehicleDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: "15",
        time_range: timeRange,
      });
      if (risk !== "ALL") qs.set("risk", risk);
      if (area !== "ALL") qs.set("area", area);
      if (vehicleType !== "ALL") qs.set("vehicle_type", vehicleType);
      if (search.trim()) qs.set("search", search.trim());

      const res = await fetch(`/api/vehicles?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load fleet vehicles");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fleet vehicles");
    } finally {
      setLoading(false);
    }
  }, [page, risk, area, vehicleType, timeRange, search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchVehicles();
    }, 120);
    return () => clearTimeout(timer);
  }, [fetchVehicles, refreshToken]);

  useEffect(() => {
    if (!initialSelectedVehicle) return;
    const t = setTimeout(() => {
      setSelectedId(initialSelectedVehicle);
      onClearInitialVehicle();
    }, 0);
    return () => clearTimeout(t);
  }, [initialSelectedVehicle, onClearInitialVehicle]);

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      if (!selectedId) {
        if (active) setDetail(null);
        return;
      }
      setDetailLoading(true);
      fetch(`/api/vehicles/${encodeURIComponent(selectedId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (active && !d.error) setDetail(d);
        })
        .finally(() => {
          if (active) setDetailLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [selectedId, refreshToken]);

  function resetFilters() {
    setRisk("ALL");
    setArea("ALL");
    setVehicleType("ALL");
    setTimeRange("7d");
    setSearch("");
    setPage(1);
  }

  function exportCsv(items: VehicleListItem[]) {
    const headers = [
      "vehicle_id",
      "model_name",
      "vehicle_type",
      "area",
      "battery_percentage",
      "remaining_range_km",
      "predicted_range_km",
      "speed_kmh",
      "temperature_c",
      "battery_risk",
      "nearest_station_distance_km",
      "delivery_delay_minutes",
      "latitude",
      "longitude",
    ];
    const csvRows = [
      headers.join(","),
      ...items.map((v) =>
        [
          v.vehicle_id,
          `"${v.model_name}"`,
          `"${v.vehicle_type}"`,
          `"${v.area}"`,
          v.battery_percentage,
          v.remaining_range_km,
          v.predicted_range_km,
          v.speed_kmh,
          v.temperature_c,
          v.battery_risk,
          v.nearest_station_distance_km,
          v.delivery_delay_minutes,
          v.latitude,
          v.longitude,
        ].join(",")
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ev_fleet_telemetry_page_${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !data) return <LoadingGrid cards={4} />;
  if (error && !data) return <ErrorBanner message={error} onRetry={fetchVehicles} />;

  const items = data?.items ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: 15, total: 0, totalPages: 1 };
  const areaOpts = data?.filterOptions.areas ?? [];
  const typeOpts = data?.filterOptions.vehicleTypes ?? [];

  const hasActiveFilters =
    risk !== "ALL" ||
    area !== "ALL" ||
    vehicleType !== "ALL" ||
    timeRange !== "7d" ||
    search.trim() !== "";

  const selectClass =
    "px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/25 focus:border-teal-600 dark:focus:border-teal-400";

  return (
    <div className="space-y-5">
      {/* Filter Controls Card */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 p-4 shadow-2xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {/* Search */}
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search Vehicle ID, model, or area..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/25 focus:border-teal-600 dark:focus:border-teal-400"
            />
          </div>

          {/* Battery Risk */}
          <select
            aria-label="Filter by battery risk"
            value={risk}
            onChange={(e) => {
              setRisk(e.target.value);
              setPage(1);
            }}
            className={selectClass}
          >
            <option value="ALL">All Battery Risks</option>
            <option value="HIGH">HIGH Risk</option>
            <option value="MEDIUM">MEDIUM Risk</option>
            <option value="LOW">LOW Risk</option>
          </select>

          {/* Area */}
          <select
            aria-label="Filter by area"
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
              setPage(1);
            }}
            className={selectClass}
          >
            <option value="ALL">All Areas</option>
            {areaOpts.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          {/* Vehicle Type */}
          <select
            aria-label="Filter by vehicle type"
            value={vehicleType}
            onChange={(e) => {
              setVehicleType(e.target.value);
              setPage(1);
            }}
            className={selectClass}
          >
            <option value="ALL">All Vehicle Types</option>
            {typeOpts.map((vt) => (
              <option key={vt} value={vt}>
                {vt}
              </option>
            ))}
          </select>

          {/* Time Range */}
          <select
            aria-label="Filter by time range"
            value={timeRange}
            onChange={(e) => {
              setTimeRange(e.target.value);
              setPage(1);
            }}
            className={selectClass}
          >
            <option value="6h">Last 6 Hours</option>
            <option value="24h">Last 24 Hours</option>
            <option value="3d">Last 3 Days</option>
            <option value="7d">Last 7 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </div>

      {/* Live Fleet Table */}
      <SectionCard
        title={`Live EV Fleet Telemetry (${pagination.total} vehicles)`}
        subtitle="Click any vehicle row to inspect trip telemetry curves, ML range prediction, and nearest charging station"
        action={
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
            <button
              onClick={() => exportCsv(items)}
              disabled={items.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        }
      >
        {items.length === 0 ? (
          <EmptyState
            title="No vehicles match current filters"
            description="Try broadening your battery risk, operational area, vehicle type, or time range selection."
            action={
              <button
                onClick={resetFilters}
                className="px-3.5 py-2 rounded-lg bg-teal-600 dark:bg-teal-500 text-white dark:text-slate-950 text-xs font-semibold hover:bg-teal-700 dark:hover:bg-teal-400 cursor-pointer"
              >
                Reset all filters
              </button>
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-5">Vehicle ID</th>
                    <th className="py-2.5 px-3.5">Battery</th>
                    <th className="py-2.5 px-3.5">Range (Pred)</th>
                    <th className="py-2.5 px-3.5">Speed</th>
                    <th className="py-2.5 px-3.5">Temp</th>
                    <th className="py-2.5 px-3.5">Risk</th>
                    <th className="py-2.5 px-5">Location & Nearest Charger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {items.map((v) => (
                    <tr
                      key={v.vehicle_id}
                      onClick={() => setSelectedId(v.vehicle_id)}
                      className={`hover:bg-teal-50/35 dark:hover:bg-slate-800/60 cursor-pointer transition-colors ${
                        selectedId === v.vehicle_id
                          ? "bg-teal-50/50 dark:bg-teal-500/10"
                          : ""
                      }`}
                    >
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-400">
                            {v.vehicle_id}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                            {v.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {v.vehicle_type} · {v.model_name}
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <BatteryBar pct={v.battery_percentage} />
                      </td>
                      <td className="py-3 px-3.5 tabular-nums">
                        <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {v.remaining_range_km.toFixed(1)} km
                        </div>
                        <div className="text-[11px] text-blue-600 dark:text-blue-400 font-mono">
                          ML: {v.predicted_range_km.toFixed(1)} km
                        </div>
                      </td>
                      <td className="py-3 px-3.5 font-mono text-xs text-slate-700 dark:text-slate-200 tabular-nums">
                        {v.speed_kmh.toFixed(1)} km/h
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-sans">
                          {v.traffic_level} traffic
                        </div>
                      </td>
                      <td className="py-3 px-3.5 font-mono text-xs text-slate-700 dark:text-slate-200 tabular-nums">
                        {v.temperature_c.toFixed(1)}°C
                      </td>
                      <td className="py-3 px-3.5">
                        <RiskBadge risk={v.battery_risk} />
                      </td>
                      <td className="py-3 px-5">
                        <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                          {v.area}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {v.latitude.toFixed(4)}, {v.longitude.toFixed(4)} ·{" "}
                          <span className="text-slate-700 dark:text-slate-200 font-medium">
                            {v.nearest_station_distance_km.toFixed(1)} km
                          </span>{" "}
                          to {v.nearest_station_id}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>
                Page{" "}
                <strong className="text-slate-800 dark:text-slate-200">
                  {pagination.page}
                </strong>{" "}
                of{" "}
                <strong className="text-slate-800 dark:text-slate-200">
                  {pagination.totalPages}
                </strong>{" "}
                · {pagination.total} matching EVs
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={pagination.page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Prev
                </button>
                <button
                  disabled={pagination.page >= pagination.totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </SectionCard>

      {/* Vehicle Detail Slide-Over Inspector */}
      {selectedId && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-slate-950/55 backdrop-blur-[2px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          <div className="bg-white dark:bg-slate-900 w-full max-w-xl h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 overflow-y-auto flex flex-col">
            <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="text-base font-bold font-mono text-slate-900 dark:text-slate-50">
                    {selectedId}
                  </h3>
                  {detail?.prediction && (
                    <RiskBadge risk={detail.prediction.batteryRisk} />
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {detail
                    ? `${detail.vehicle.modelName} · ${detail.vehicle.vehicleType} (${detail.vehicle.batteryCapacityKwh} kWh)`
                    : "Loading vehicle telemetry profile..."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {detail?.latestTelemetry && (
                  <button
                    onClick={() => {
                      const lt = detail.latestTelemetry!;
                      const vid = detail.vehicle.vehicleId;
                      setSelectedId(null);
                      onLocateOnMap({
                        latitude: lt.latitude,
                        longitude: lt.longitude,
                        label: vid,
                        vehicleId: vid,
                      });
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-500/25 text-xs font-semibold cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Map
                  </button>
                )}
                <button
                  onClick={() => setSelectedId(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  aria-label="Close vehicle inspector"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {detailLoading || !detail ? (
              <div className="flex-1 flex items-center justify-center p-12 text-slate-500 dark:text-slate-400 text-xs gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-teal-600 dark:text-teal-400" />
                Fetching telemetry stream...
              </div>
            ) : (
              <div className="p-6 space-y-5">
                {/* Snapshot Metrics */}
                {detail.latestTelemetry && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3 border border-slate-200/70 dark:border-slate-700/70">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Zap className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />{" "}
                        Battery
                      </div>
                      <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-50 mt-1">
                        {detail.latestTelemetry.batteryPercentage.toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3 border border-slate-200/70 dark:border-slate-700/70">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Gauge className="w-3 h-3 text-blue-600 dark:text-blue-400" /> ML
                        Range
                      </div>
                      <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-50 mt-1">
                        {(
                          detail.prediction?.predictedRangeKm ??
                          detail.latestTelemetry.remainingRangeKm
                        ).toFixed(1)}{" "}
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                          km
                        </span>
                      </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3 border border-slate-200/70 dark:border-slate-700/70">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Navigation className="w-3 h-3 text-teal-600 dark:text-teal-400" />{" "}
                        Speed
                      </div>
                      <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-50 mt-1">
                        {detail.latestTelemetry.speedKmh.toFixed(0)}{" "}
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                          km/h
                        </span>
                      </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3 border border-slate-200/70 dark:border-slate-700/70">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Thermometer className="w-3 h-3 text-amber-600 dark:text-amber-400" />{" "}
                        Ambient
                      </div>
                      <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-50 mt-1">
                        {detail.latestTelemetry.temperatureC.toFixed(1)}°C
                      </div>
                    </div>
                  </div>
                )}

                {/* Nearest Charging Station Card */}
                {detail.nearestStation && detail.latestTelemetry && (
                  <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" /> Nearest Charging Station
                        </div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-50 mt-0.5">
                          {detail.nearestStation.name} ({detail.nearestStation.stationId})
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                          {detail.nearestStation.area} · {detail.nearestStation.maxPowerKw} kW
                          DC Fast · {detail.nearestStation.availablePorts}/
                          {detail.nearestStation.totalPorts} ports open
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-base font-bold font-mono text-emerald-800 dark:text-emerald-300">
                          {detail.latestTelemetry.nearestStationDistanceKm.toFixed(2)} km
                        </div>
                        <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                          Haversine dist
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ML Risk Probabilities */}
                {detail.prediction?.riskProbabilities && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                        ML Battery-Risk Class Probabilities
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Range model: {detail.prediction.rangeModelName}
                      </span>
                    </div>
                    {(["HIGH", "MEDIUM", "LOW"] as const).map((cls) => {
                      const pct = Math.round(
                        (detail.prediction?.riskProbabilities?.[cls] ?? 0) * 100
                      );
                      const barColor =
                        cls === "HIGH"
                          ? "bg-rose-500"
                          : cls === "MEDIUM"
                            ? "bg-amber-500"
                            : "bg-emerald-500";
                      return (
                        <div key={cls} className="flex items-center gap-3 text-xs">
                          <span className="w-16 font-mono font-medium text-slate-600 dark:text-slate-300">
                            {cls}
                          </span>
                          <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-10 text-right font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                            {pct}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Telemetry History Chart */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                  <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-100 mb-3">
                    Recent Battery SoC (%) & Remaining Range (km) Trace
                  </h4>
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={detail.telemetryHistory.map((pt, i) => ({
                          step: `#${i + 1}`,
                          battery: pt.batteryPercentage,
                          range: pt.remainingRangeKm,
                        }))}
                        margin={{ top: 5, right: 8, left: -16, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.gridStroke} />
                        <XAxis
                          dataKey="step"
                          tick={{ fontSize: 10, fill: ct.tickFill }}
                          axisLine={{ stroke: ct.axisStroke }}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: ct.tickFill }}
                          axisLine={false}
                        />
                        <Tooltip
                          contentStyle={ct.tooltipStyle}
                          labelStyle={ct.tooltipLabelStyle}
                          itemStyle={ct.tooltipItemStyle}
                        />
                        <Line
                          type="monotone"
                          dataKey="battery"
                          name="Battery (%)"
                          stroke="#10b981"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="range"
                          name="Range (km)"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Recent Trips */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                  <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-100 mb-2.5">
                    Recent Delivery Trips
                  </h4>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {detail.recentTrips.slice(0, 5).map((tr) => (
                      <div
                        key={tr.tripId}
                        className="py-2.5 flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {tr.originArea} → {tr.destinationArea}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            {tr.tripId} · {tr.totalDistanceKm.toFixed(1)} km ·{" "}
                            {tr.startBatteryPct}% → {tr.endBatteryPct}%
                          </div>
                        </div>
                        <div className="text-right shrink-0 font-mono">
                          <div
                            className={`font-semibold ${
                              tr.deliveryDelayMinutes > 12
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            +{tr.deliveryDelayMinutes.toFixed(1)} min
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500">
                            {tr.energyUsedKwh.toFixed(1)} kWh
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
