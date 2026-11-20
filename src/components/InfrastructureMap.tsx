"use client";

import React, { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  CircleMarker,
  useMap,
} from "react-leaflet";
import type {
  ChargingStationItem,
  HotspotItem,
  RecommendationItem,
  ChargingStationsResponse,
  MapFocusTarget,
} from "@/types/fleet";
import { useTheme } from "./ThemeProvider";

export interface SelectedMapEntity {
  kind: "station" | "risk_hotspot" | "demand_hotspot" | "recommended" | "vehicle";
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  coords: string;
  metrics: Array<{ label: string; value: string }>;
  note?: string;
}

function makePinIcon(bg: string, innerHtml: string, size = 30) {
  return L.divIcon({
    className: "ev-custom-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<div style="
      width:${size}px;
      height:${size}px;
      border-radius:9999px;
      background:${bg};
      color:#ffffff;
      border:2.5px solid #ffffff;
      box-shadow:0 3px 12px rgba(0,0,0,0.35);
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:12px;
      font-weight:700;
    ">${innerHtml}</div>`,
  });
}

function MapFlyController({ focusTarget }: { focusTarget: MapFocusTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (focusTarget) {
      map.flyTo([focusTarget.latitude, focusTarget.longitude], 12.5, {
        duration: 0.9,
      });
    }
  }, [focusTarget, map]);
  return null;
}

export default function InfrastructureMap({
  stations,
  riskHotspots,
  demandHotspots,
  recommendedTop3,
  fleetPositions,
  layers,
  focusTarget,
  onSelectEntity,
}: {
  stations: ChargingStationItem[];
  riskHotspots: HotspotItem[];
  demandHotspots: HotspotItem[];
  recommendedTop3: RecommendationItem[];
  fleetPositions: ChargingStationsResponse["liveFleetPositions"];
  layers: {
    stations: boolean;
    riskHotspots: boolean;
    demandHotspots: boolean;
    recommended: boolean;
    vehicles: boolean;
  };
  focusTarget: MapFocusTarget | null;
  onSelectEntity: (entity: SelectedMapEntity) => void;
}) {
  const { isDark } = useTheme();

  const tileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

  const icons = useMemo(
    () => ({
      station: makePinIcon(
        "#10b981",
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        30
      ),
      risk: makePinIcon(
        "#ef4444",
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        28
      ),
      demand: makePinIcon(
        "#f59e0b",
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
        28
      ),
      rec: (rank: number) =>
        makePinIcon(
          "#2563eb",
          `<span style="display:flex;align-items:center;gap:1px;">★${rank}</span>`,
          36
        ),
    }),
    []
  );

  return (
    <MapContainer
      center={[30.332, -97.705]}
      zoom={10.5}
      scrollWheelZoom={true}
      className="w-full h-[520px] rounded-xl border border-slate-200 dark:border-slate-700"
    >
      <TileLayer
        key={isDark ? "dark-tiles" : "light-tiles"}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO'
        url={tileUrl}
      />
      <MapFlyController focusTarget={focusTarget} />

      {/* RED: Battery-Risk Hotspots */}
      {layers.riskHotspots &&
        riskHotspots.map((hs) => (
          <React.Fragment key={`risk-${hs.clusterId}`}>
            <Circle
              center={[hs.centroidLat, hs.centroidLon]}
              radius={hs.radiusKm * 1000}
              pathOptions={{
                color: "#ef4444",
                weight: 1.5,
                fillColor: "#ef4444",
                fillOpacity: isDark ? 0.18 : 0.13,
              }}
            />
            <Marker
              position={[hs.centroidLat, hs.centroidLon]}
              icon={icons.risk}
              eventHandlers={{
                click: () =>
                  onSelectEntity({
                    kind: "risk_hotspot",
                    title: `${hs.area} — Discharge Cluster #${hs.clusterIndex + 1}`,
                    subtitle: "K-Means Battery-Risk Hotspot",
                    badge: "RED · BATTERY RISK",
                    badgeColor:
                      "bg-rose-50 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
                    coords: `${hs.centroidLat.toFixed(4)}, ${hs.centroidLon.toFixed(4)}`,
                    metrics: [
                      { label: "Severity Score", value: `${hs.severityScore.toFixed(1)} / 100` },
                      { label: "Critical Events", value: String(hs.criticalEvents) },
                      { label: "Avg Battery", value: `${hs.avgBatteryPct.toFixed(1)}%` },
                      { label: "Affected EVs", value: `${hs.vehicleCount} vehicles` },
                      {
                        label: "Nearest Charger",
                        value: `${hs.nearestStationDistanceKm.toFixed(2)} km`,
                      },
                      { label: "Avg Delay", value: `${hs.avgDelayMinutes.toFixed(1)} min` },
                    ],
                    note: `Cluster radius ${hs.radiusKm} km averaging ${hs.avgEnergyKwhPerKm.toFixed(
                      3
                    )} kWh/km discharge intensity.`,
                  }),
              }}
            >
              <Popup>
                <div className="min-w-[210px] text-xs space-y-1.5">
                  <div className="font-semibold text-rose-700 dark:text-rose-400 uppercase text-[10px] tracking-wide">
                    Battery-Risk Hotspot
                  </div>
                  <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                    {hs.area}
                  </div>
                  <div className="grid grid-cols-2 gap-1 pt-1 text-slate-600 dark:text-slate-300">
                    <span>Avg Battery:</span>
                    <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                      {hs.avgBatteryPct}%
                    </strong>
                    <span>Critical Events:</span>
                    <strong className="text-right font-mono text-rose-600 dark:text-rose-400">
                      {hs.criticalEvents}
                    </strong>
                    <span>Affected EVs:</span>
                    <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                      {hs.vehicleCount}
                    </strong>
                    <span>Nearest Charger:</span>
                    <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                      {hs.nearestStationDistanceKm.toFixed(1)} km
                    </strong>
                  </div>
                </div>
              </Popup>
            </Marker>
          </React.Fragment>
        ))}

      {/* ORANGE: High-Demand Areas */}
      {layers.demandHotspots &&
        demandHotspots.map((hs) => (
          <React.Fragment key={`demand-${hs.clusterId}`}>
            <Circle
              center={[hs.centroidLat, hs.centroidLon]}
              radius={hs.radiusKm * 950}
              pathOptions={{
                color: "#f59e0b",
                weight: 1.5,
                fillColor: "#f59e0b",
                fillOpacity: isDark ? 0.16 : 0.12,
              }}
            />
            <Marker
              position={[hs.centroidLat, hs.centroidLon]}
              icon={icons.demand}
              eventHandlers={{
                click: () =>
                  onSelectEntity({
                    kind: "demand_hotspot",
                    title: `${hs.area} — Demand Zone #${hs.clusterIndex + 1}`,
                    subtitle: "K-Means High Charging-Demand Cluster",
                    badge: "ORANGE · HIGH DEMAND",
                    badgeColor:
                      "bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
                    coords: `${hs.centroidLat.toFixed(4)}, ${hs.centroidLon.toFixed(4)}`,
                    metrics: [
                      { label: "Demand Index", value: hs.demandIntensity.toFixed(1) },
                      { label: "Active EVs", value: `${hs.vehicleCount} vehicles` },
                      { label: "Telemetry Events", value: String(hs.pointCount) },
                      { label: "Avg Battery", value: `${hs.avgBatteryPct.toFixed(1)}%` },
                      { label: "Avg Delay", value: `${hs.avgDelayMinutes.toFixed(1)} min` },
                      {
                        label: "Nearest Charger",
                        value: `${hs.nearestStationDistanceKm.toFixed(2)} km`,
                      },
                    ],
                  }),
              }}
            >
              <Popup>
                <div className="min-w-[210px] text-xs space-y-1.5">
                  <div className="font-semibold text-amber-700 dark:text-amber-400 uppercase text-[10px] tracking-wide">
                    High Charging-Demand Area
                  </div>
                  <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                    {hs.area}
                  </div>
                  <div className="grid grid-cols-2 gap-1 pt-1 text-slate-600 dark:text-slate-300">
                    <span>Demand Index:</span>
                    <strong className="text-right font-mono text-amber-700 dark:text-amber-400">
                      {hs.demandIntensity.toFixed(1)}
                    </strong>
                    <span>Active EVs:</span>
                    <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                      {hs.vehicleCount}
                    </strong>
                    <span>Avg Delay:</span>
                    <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                      {hs.avgDelayMinutes.toFixed(1)} min
                    </strong>
                    <span>Charger Dist:</span>
                    <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                      {hs.nearestStationDistanceKm.toFixed(1)} km
                    </strong>
                  </div>
                </div>
              </Popup>
            </Marker>
          </React.Fragment>
        ))}

      {/* GREEN: Existing Charging Stations */}
      {layers.stations &&
        stations.map((st) => (
          <Marker
            key={st.station_id}
            position={[st.latitude, st.longitude]}
            icon={icons.station}
            eventHandlers={{
              click: () =>
                onSelectEntity({
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
                    { label: "Utilization", value: `${st.avg_utilization_pct.toFixed(1)}%` },
                    { label: "7d Sessions", value: String(st.total_sessions) },
                    {
                      label: "Energy Dispensed",
                      value: `${st.total_energy_kwh.toLocaleString()} kWh`,
                    },
                    { label: "Avg Queue Wait", value: `${st.avg_wait_minutes.toFixed(1)} min` },
                  ],
                  note: `Connector: ${st.connector_type} · Tariff: $${st.price_per_kwh.toFixed(
                    2
                  )}/kWh`,
                }),
            }}
          >
            <Popup>
              <div className="min-w-[215px] text-xs space-y-1.5">
                <div className="font-semibold text-emerald-700 dark:text-emerald-400 uppercase text-[10px] tracking-wide">
                  Existing Station · {st.station_id}
                </div>
                <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  {st.name}
                </div>
                <div className="text-slate-500 dark:text-slate-400">{st.area}</div>
                <div className="grid grid-cols-2 gap-1 pt-1 text-slate-600 dark:text-slate-300">
                  <span>Ports Open:</span>
                  <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                    {st.available_ports}/{st.total_ports}
                  </strong>
                  <span>Max Power:</span>
                  <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                    {st.max_power_kw} kW
                  </strong>
                  <span>Utilization:</span>
                  <strong className="text-right font-mono text-emerald-700 dark:text-emerald-400">
                    {st.avg_utilization_pct}%
                  </strong>
                  <span>Avg Wait:</span>
                  <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                    {st.avg_wait_minutes} min
                  </strong>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

      {/* BLUE / STAR: AI-Recommended Top 3 Charging Stations */}
      {layers.recommended &&
        recommendedTop3.map((rec) => (
          <React.Fragment key={`rec-${rec.rank}`}>
            <Circle
              center={[rec.latitude, rec.longitude]}
              radius={4500}
              pathOptions={{
                color: isDark ? "#60a5fa" : "#2563eb",
                weight: 2,
                dashArray: "6 5",
                fillColor: "#3b82f6",
                fillOpacity: isDark ? 0.14 : 0.09,
              }}
            />
            <Marker
              position={[rec.latitude, rec.longitude]}
              icon={icons.rec(rec.rank)}
              eventHandlers={{
                click: () =>
                  onSelectEntity({
                    kind: "recommended",
                    title: `Rank #${rec.rank}: ${rec.corridor_label}`,
                    subtitle: `${rec.area} · Proposed ${rec.recommended_ports}-Port ${rec.recommended_power_kw} kW Hub`,
                    badge: `BLUE ★ · AI RECOMMENDED #${rec.rank}`,
                    badgeColor:
                      "bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
                    coords: `${rec.latitude.toFixed(4)}, ${rec.longitude.toFixed(4)}`,
                    metrics: [
                      { label: "Optimization Score", value: `${rec.score.toFixed(1)} / 100` },
                      { label: "EV Coverage", value: `${rec.expected_ev_coverage} EVs` },
                      {
                        label: "Delay Reduction",
                        value: `-${rec.expected_delay_reduction_pct.toFixed(1)}% (${rec.expected_delay_reduction.toFixed(1)}m)`,
                      },
                      {
                        label: "Risk Reduction",
                        value: `-${rec.battery_risk_reduction_pct.toFixed(1)}%`,
                      },
                      {
                        label: "Nearest Station",
                        value: `${rec.nearest_existing_station_distance.toFixed(2)} km`,
                      },
                      {
                        label: "Predicted Demand",
                        value: `${Math.round(rec.predicted_daily_demand_kwh).toLocaleString()} kWh/d`,
                      },
                    ],
                    note: rec.rationale,
                  }),
              }}
            >
              <Popup>
                <div className="min-w-[230px] text-xs space-y-1.5">
                  <div className="font-semibold text-blue-700 dark:text-blue-400 uppercase text-[10px] tracking-wide">
                    ★ AI Recommended Station #{rec.rank}
                  </div>
                  <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                    {rec.corridor_label}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">{rec.area}</div>
                  <div className="grid grid-cols-2 gap-1 pt-1 text-slate-600 dark:text-slate-300">
                    <span>Composite Score:</span>
                    <strong className="text-right font-mono text-blue-700 dark:text-blue-400">
                      {rec.score.toFixed(1)} / 100
                    </strong>
                    <span>EV Coverage:</span>
                    <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                      {rec.expected_ev_coverage} EVs
                    </strong>
                    <span>Delay Reduction:</span>
                    <strong className="text-right font-mono text-emerald-700 dark:text-emerald-400">
                      -{rec.expected_delay_reduction_pct.toFixed(1)}%
                    </strong>
                    <span>Nearest Existing:</span>
                    <strong className="text-right font-mono text-slate-900 dark:text-slate-100">
                      {rec.nearest_existing_station_distance.toFixed(1)} km
                    </strong>
                  </div>
                </div>
              </Popup>
            </Marker>
          </React.Fragment>
        ))}

      {/* Optional Live Fleet Vehicle Telemetry Pins */}
      {layers.vehicles &&
        fleetPositions.map((v) => {
          const dotColor =
            v.battery_risk === "HIGH"
              ? "#ef4444"
              : v.battery_risk === "MEDIUM"
                ? "#f59e0b"
                : "#14b8a6";
          return (
            <CircleMarker
              key={`veh-${v.vehicle_id}`}
              center={[v.latitude, v.longitude]}
              radius={5.5}
              pathOptions={{
                color: isDark ? "#0f172a" : "#ffffff",
                weight: 1.5,
                fillColor: dotColor,
                fillOpacity: 0.92,
              }}
              eventHandlers={{
                click: () =>
                  onSelectEntity({
                    kind: "vehicle",
                    title: `${v.vehicle_id} (${v.vehicle_type})`,
                    subtitle: `Live Fleet Position · ${v.area}`,
                    badge: `${v.battery_risk} RISK EV`,
                    badgeColor:
                      "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
                    coords: `${v.latitude.toFixed(4)}, ${v.longitude.toFixed(4)}`,
                    metrics: [
                      { label: "Battery SoC", value: `${v.battery_percentage.toFixed(1)}%` },
                      { label: "Predicted Range", value: `${v.predicted_range_km.toFixed(1)} km` },
                      { label: "Speed", value: `${v.speed_kmh.toFixed(0)} km/h` },
                      { label: "Nearest Station", value: v.nearest_station_id },
                      {
                        label: "Haversine Distance",
                        value: `${v.nearest_station_distance_km.toFixed(2)} km`,
                      },
                      { label: "Risk Status", value: v.battery_risk },
                    ],
                  }),
              }}
            >
              <Popup>
                <div className="text-xs space-y-1">
                  <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                    {v.vehicle_id} · {v.battery_percentage.toFixed(1)}%
                  </div>
                  <div className="text-slate-600 dark:text-slate-300">
                    Range: {v.predicted_range_km.toFixed(1)} km ·{" "}
                    {v.nearest_station_distance_km.toFixed(1)} km to {v.nearest_station_id}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
    </MapContainer>
  );
}
