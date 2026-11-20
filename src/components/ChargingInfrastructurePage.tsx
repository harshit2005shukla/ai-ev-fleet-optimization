"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  MapPin,
  PlugZap,
  Star,
  Flame,
  Navigation,
  Layers,
} from "lucide-react";
import type {
  ChargingStationsResponse,
  HotspotsResponse,
  RecommendationItem,
  MapFocusTarget,
} from "@/types/fleet";
import type { SelectedMapEntity } from "./InfrastructureMap";
import { KpiCard, SectionCard, LoadingGrid, ErrorBanner } from "./ui";

const InfrastructureMap = dynamic(() => import("./InfrastructureMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[520px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60 animate-pulse flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
      Initializing interactive OpenStreetMap layers...
    </div>
  ),
});

export default function ChargingInfrastructurePage({
  refreshToken,
  focusTarget,
  onClearFocusTarget,
}: {
  refreshToken: number;
  focusTarget: MapFocusTarget | null;
  onClearFocusTarget: () => void;
}) {
  const [stationsData, setStationsData] = useState<ChargingStationsResponse | null>(
    null
  );
  const [hotspotsData, setHotspotsData] = useState<HotspotsResponse | null>(null);
  const [top3, setTop3] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [layers, setLayers] = useState({
    stations: true,
    riskHotspots: true,
    demandHotspots: true,
    recommended: true,
    vehicles: Boolean(focusTarget?.vehicleId),
  });

  const [localFocus, setLocalFocus] = useState<MapFocusTarget | null>(focusTarget);
  const [selectedEntity, setSelectedEntity] = useState<SelectedMapEntity | null>(null);
  const focusRef = useRef<MapFocusTarget | null>(focusTarget);

  useEffect(() => {
    focusRef.current = focusTarget;
  }, [focusTarget]);

  const loadGeo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, hRes, rRes] = await Promise.all([
        fetch("/api/charging-stations", { cache: "no-store" }),
        fetch("/api/hotspots", { cache: "no-store" }),
        fetch("/api/recommendations/top3", { cache: "no-store" }),
      ]);
      const [sJson, hJson, rJson] = await Promise.all([
        sRes.json(),
        hRes.json(),
        rRes.json(),
      ]);
      if (!sRes.ok) throw new Error(sJson.error || "Failed to load stations");
      if (!hRes.ok) throw new Error(hJson.error || "Failed to load hotspots");
      if (!rRes.ok) throw new Error(rJson.error || "Failed to load top 3 sites");

      setStationsData(sJson);
      setHotspotsData(hJson);
      setTop3(rJson.top3 ?? []);

      const activeFocus = focusRef.current;
      if (activeFocus?.vehicleId) {
        const veh = (
          sJson.liveFleetPositions as ChargingStationsResponse["liveFleetPositions"]
        ).find((v) => v.vehicle_id === activeFocus.vehicleId);
        if (veh) {
          setLayers((prev) => ({ ...prev, vehicles: true }));
          setSelectedEntity({
            kind: "vehicle",
            title: `${veh.vehicle_id} (${veh.vehicle_type})`,
            subtitle: `Live Fleet Position · ${veh.area}`,
            badge: `${veh.battery_risk} RISK EV`,
            badgeColor:
              "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
            coords: `${veh.latitude.toFixed(4)}, ${veh.longitude.toFixed(4)}`,
            metrics: [
              { label: "Battery SoC", value: `${veh.battery_percentage.toFixed(1)}%` },
              { label: "Predicted Range", value: `${veh.predicted_range_km.toFixed(1)} km` },
              { label: "Speed", value: `${veh.speed_kmh.toFixed(0)} km/h` },
              { label: "Nearest Station", value: veh.nearest_station_id },
              {
                label: "Haversine Distance",
                value: `${veh.nearest_station_distance_km.toFixed(2)} km`,
              },
              { label: "Risk Status", value: veh.battery_risk },
            ],
          });
          return;
        }
      }

      // Pre-populate inspector with requested or #1 AI Recommended site
      const targetRec =
        (activeFocus?.rank
          ? (rJson.top3 ?? []).find(
              (x: RecommendationItem) => x.rank === activeFocus.rank
            )
          : null) ?? (rJson.top3 ?? [])[0];

      if (targetRec) {
        setSelectedEntity({
          kind: "recommended",
          title: `Rank #${targetRec.rank}: ${targetRec.corridor_label}`,
          subtitle: `${targetRec.area} · Proposed ${targetRec.recommended_ports}-Port ${targetRec.recommended_power_kw} kW Hub`,
          badge: `BLUE ★ · AI RECOMMENDED #${targetRec.rank}`,
          badgeColor:
            "bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
          coords: `${targetRec.latitude.toFixed(4)}, ${targetRec.longitude.toFixed(4)}`,
          metrics: [
            { label: "Optimization Score", value: `${targetRec.score.toFixed(1)} / 100` },
            { label: "EV Coverage", value: `${targetRec.expected_ev_coverage} EVs` },
            {
              label: "Delay Reduction",
              value: `-${targetRec.expected_delay_reduction_pct.toFixed(1)}%`,
            },
            {
              label: "Risk Reduction",
              value: `-${targetRec.battery_risk_reduction_pct.toFixed(1)}%`,
            },
            {
              label: "Nearest Station",
              value: `${targetRec.nearest_existing_station_distance.toFixed(2)} km`,
            },
            {
              label: "Predicted Demand",
              value: `${Math.round(targetRec.predicted_daily_demand_kwh).toLocaleString()} kWh/d`,
            },
          ],
          note: targetRec.rationale,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load geospatial data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadGeo();
    }, 0);
    return () => clearTimeout(t);
  }, [loadGeo, refreshToken]);

  useEffect(() => {
    if (!focusTarget) return;
    const applyTimer = setTimeout(() => {
      setLocalFocus(focusTarget);
      if (focusTarget.vehicleId) {
        setLayers((prev) => ({ ...prev, vehicles: true }));
      }
    }, 0);
    const clearTimer = setTimeout(() => onClearFocusTarget(), 1200);
    return () => {
      clearTimeout(applyTimer);
      clearTimeout(clearTimer);
    };
  }, [focusTarget, onClearFocusTarget]);

  if (loading && !stationsData) return <LoadingGrid cards={4} />;
  if (error || !stationsData || !hotspotsData) {
    return (
      <ErrorBanner
        message={error ?? "Charging infrastructure map unavailable"}
        onRetry={loadGeo}
      />
    );
  }

  const toggleLayer = (key: keyof typeof layers) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  const inactivePill =
    "bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500";

  return (
    <div className="space-y-5">
      {/* Infrastructure KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Existing Stations"
          value={stationsData.summary.totalStations}
          subtext={`${stationsData.summary.availablePorts}/${stationsData.summary.totalPorts} ports currently open`}
          icon={<PlugZap className="w-4 h-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Network Utilization"
          value={`${stationsData.summary.avgUtilizationPct}%`}
          subtext="Mean DC fast-charger occupancy"
          icon={<Flame className="w-4 h-4" />}
          tone="amber"
        />
        <KpiCard
          label="Avg Distance to Charger"
          value={stationsData.summary.avgEvDistanceToStationKm}
          unit="km"
          subtext="Haversine EV-to-station distance"
          icon={<Navigation className="w-4 h-4" />}
          tone="teal"
        />
        <KpiCard
          label="AI Recommended Hubs"
          value={top3.length}
          subtext={`${hotspotsData.grouped.batteryRisk.length} risk · ${hotspotsData.grouped.highDemand.length} demand hotspots`}
          icon={<Star className="w-4 h-4" />}
          tone="blue"
        />
      </div>

      {/* Interactive Layer Controls + Map + Side Inspector */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 p-4 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <Layers className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            Map Layers:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => toggleLayer("stations")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                layers.stations
                  ? "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-500/40 dark:text-emerald-300"
                  : inactivePill
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Existing Stations ({stationsData.stations.length})
            </button>
            <button
              onClick={() => toggleLayer("riskHotspots")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                layers.riskHotspots
                  ? "bg-rose-50 border-rose-300 text-rose-800 dark:bg-rose-500/15 dark:border-rose-500/40 dark:text-rose-300"
                  : inactivePill
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              Battery-Risk Hotspots ({hotspotsData.grouped.batteryRisk.length})
            </button>
            <button
              onClick={() => toggleLayer("demandHotspots")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                layers.demandHotspots
                  ? "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/40 dark:text-amber-300"
                  : inactivePill
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              High-Demand Areas ({hotspotsData.grouped.highDemand.length})
            </button>
            <button
              onClick={() => toggleLayer("recommended")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                layers.recommended
                  ? "bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-500/15 dark:border-blue-500/40 dark:text-blue-300"
                  : inactivePill
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 dark:bg-blue-400" />★ AI
              Recommended ({top3.length})
            </button>
            <button
              onClick={() => toggleLayer("vehicles")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                layers.vehicles
                  ? "bg-slate-900 border-slate-900 text-white dark:bg-teal-500 dark:border-teal-500 dark:text-slate-950 dark:font-semibold"
                  : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              Live EV Pins ({stationsData.liveFleetPositions.length})
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-8">
            <InfrastructureMap
              stations={stationsData.stations}
              riskHotspots={hotspotsData.grouped.batteryRisk}
              demandHotspots={hotspotsData.grouped.highDemand}
              recommendedTop3={top3}
              fleetPositions={stationsData.liveFleetPositions}
              layers={layers}
              focusTarget={localFocus}
              onSelectEntity={setSelectedEntity}
            />
          </div>

          {/* Right Geospatial Inspector */}
          <div className="xl:col-span-4 bg-slate-50/80 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/80 p-4 flex flex-col justify-between">
            {selectedEntity ? (
              <div className="space-y-3.5">
                <div>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${selectedEntity.badgeColor}`}
                  >
                    {selectedEntity.badge}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 mt-2">
                    {selectedEntity.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {selectedEntity.subtitle}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-1">
                    GPS: {selectedEntity.coords}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {selectedEntity.metrics.map((m) => (
                    <div
                      key={m.label}
                      className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-slate-200/80 dark:border-slate-700/80"
                    >
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                        {m.label}
                      </div>
                      <div className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                        {m.value}
                      </div>
                    </div>
                  ))}
                </div>

                {selectedEntity.note && (
                  <div className="bg-white dark:bg-slate-900 rounded-lg p-3 border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {selectedEntity.note}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400 py-10 text-center">
                Select any map marker to inspect station capacity, hotspot metrics, or AI site
                recommendations.
              </div>
            )}

            {/* Quick-jump to Top 3 Sites */}
            <div className="pt-3 mt-3 border-t border-slate-200/80 dark:border-slate-700/80">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-2">
                Quick-Fly to AI Recommended Hubs:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {top3.map((r) => (
                  <button
                    key={r.rank}
                    onClick={() => {
                      setLocalFocus({
                        latitude: r.latitude,
                        longitude: r.longitude,
                        label: r.corridor_label,
                        rank: r.rank,
                      });
                      setSelectedEntity({
                        kind: "recommended",
                        title: `Rank #${r.rank}: ${r.corridor_label}`,
                        subtitle: `${r.area} · Proposed ${r.recommended_ports}-Port ${r.recommended_power_kw} kW Hub`,
                        badge: `BLUE ★ · AI RECOMMENDED #${r.rank}`,
                        badgeColor:
                          "bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
                        coords: `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`,
                        metrics: [
                          {
                            label: "Optimization Score",
                            value: `${r.score.toFixed(1)} / 100`,
                          },
                          { label: "EV Coverage", value: `${r.expected_ev_coverage} EVs` },
                          {
                            label: "Delay Reduction",
                            value: `-${r.expected_delay_reduction_pct.toFixed(1)}%`,
                          },
                          {
                            label: "Risk Reduction",
                            value: `-${r.battery_risk_reduction_pct.toFixed(1)}%`,
                          },
                          {
                            label: "Nearest Station",
                            value: `${r.nearest_existing_station_distance.toFixed(2)} km`,
                          },
                          {
                            label: "Predicted Demand",
                            value: `${Math.round(
                              r.predicted_daily_demand_kwh
                            ).toLocaleString()} kWh/d`,
                          },
                        ],
                        note: r.rationale,
                      });
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 dark:bg-blue-500 text-white text-[11px] font-semibold hover:bg-blue-700 dark:hover:bg-blue-400 cursor-pointer"
                  >
                    <MapPin className="w-3 h-3" />#{r.rank} {r.area.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Existing Charging Stations Directory */}
      <SectionCard
        title="Existing Charging Infrastructure Directory"
        subtitle="Click any station row to focus and inspect its location on the interactive map"
      >
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-5">Station</th>
                <th className="py-2.5 px-3.5">Area</th>
                <th className="py-2.5 px-3.5">Ports</th>
                <th className="py-2.5 px-3.5">Max Power</th>
                <th className="py-2.5 px-3.5">Utilization</th>
                <th className="py-2.5 px-3.5">7d Energy</th>
                <th className="py-2.5 px-5">Avg Wait</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
              {stationsData.stations.map((st) => (
                <tr
                  key={st.station_id}
                  onClick={() => {
                    setLayers((prev) => ({ ...prev, stations: true }));
                    setLocalFocus({
                      latitude: st.latitude,
                      longitude: st.longitude,
                      label: st.name,
                    });
                    setSelectedEntity({
                      kind: "station",
                      title: st.name,
                      subtitle: `${st.station_id} · ${st.area} (${st.operator})`,
                      badge: "GREEN · EXISTING STATION",
                      badgeColor:
                        "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
                      coords: `${st.latitude.toFixed(4)}, ${st.longitude.toFixed(4)}`,
                      metrics: [
                        {
                          label: "Port Availability",
                          value: `${st.available_ports} / ${st.total_ports} open`,
                        },
                        { label: "Max Power", value: `${st.max_power_kw} kW` },
                        {
                          label: "Utilization",
                          value: `${st.avg_utilization_pct.toFixed(1)}%`,
                        },
                        { label: "7d Sessions", value: String(st.total_sessions) },
                        {
                          label: "Energy Dispensed",
                          value: `${st.total_energy_kwh.toLocaleString()} kWh`,
                        },
                        {
                          label: "Avg Queue Wait",
                          value: `${st.avg_wait_minutes.toFixed(1)} min`,
                        },
                      ],
                      note: `Connector: ${st.connector_type} · Tariff: $${st.price_per_kwh.toFixed(
                        2
                      )}/kWh`,
                    });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="hover:bg-emerald-50/40 dark:hover:bg-slate-800/60 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 px-5">
                    <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                      {st.station_id}
                    </span>{" "}
                    <span className="font-medium text-slate-900 dark:text-slate-100 ml-1">
                      {st.name}
                    </span>
                  </td>
                  <td className="py-2.5 px-3.5 text-slate-600 dark:text-slate-400">
                    {st.area}
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {st.available_ports}/{st.total_ports} open
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {st.max_power_kw} kW
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums">
                    <span
                      className={
                        st.avg_utilization_pct >= 82
                          ? "text-rose-600 dark:text-rose-400 font-semibold"
                          : "text-slate-800 dark:text-slate-200"
                      }
                    >
                      {st.avg_utilization_pct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {st.total_energy_kwh.toLocaleString()} kWh
                  </td>
                  <td className="py-2.5 px-5 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {st.avg_wait_minutes.toFixed(1)} min
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
