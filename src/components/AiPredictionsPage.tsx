"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Award,
  BrainCircuit,
  ShieldAlert,
  Zap,
  RefreshCw,
  Sliders,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  AreaChart,
  Area,
  ReferenceLine,
} from "recharts";
import type {
  RangePredictionsResponse,
  BatteryRiskResponse,
  ChargingDemandResponse,
  BatteryRiskLevel,
} from "@/types/fleet";
import {
  KpiCard,
  SectionCard,
  RiskBadge,
  LoadingGrid,
  ErrorBanner,
  formatFeatureName,
} from "./ui";
import { useChartTheme } from "./ThemeProvider";

interface LivePredictResult {
  predictedRangeKm: number;
  rangeModel: string;
  batteryRisk: BatteryRiskLevel;
  riskConfidence: number;
  riskProbabilities: Record<string, number>;
  riskModel: string;
  predictedAreaDemandKwh: number;
  recommendedAction: string;
}

export default function AiPredictionsPage({
  refreshToken,
  onModelsRetrained,
}: {
  refreshToken: number;
  onModelsRetrained: () => void;
}) {
  const ct = useChartTheme();

  const [rangeData, setRangeData] = useState<RangePredictionsResponse | null>(null);
  const [riskData, setRiskData] = useState<BatteryRiskResponse | null>(null);
  const [demandData, setDemandData] = useState<ChargingDemandResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retraining, setRetraining] = useState(false);
  const [retrainNotice, setRetrainNotice] = useState<string | null>(null);
  const [selectedDemandArea, setSelectedDemandArea] = useState("ALL");

  // Interactive Live ML Simulator state
  const [simBattery, setSimBattery] = useState(24);
  const [simSpeed, setSimSpeed] = useState(74);
  const [simTemp, setSimTemp] = useState(35);
  const [simWeight, setSimWeight] = useState(4600);
  const [simEnergy, setSimEnergy] = useState(0.38);
  const [simTraffic, setSimTraffic] = useState<"LOW" | "MEDIUM" | "HIGH" | "SEVERE">("HIGH");
  const [simStationDist, setSimStationDist] = useState(5.8);
  const [simResult, setSimResult] = useState<LivePredictResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch("/api/fleet/range-predictions", { cache: "no-store" }),
        fetch("/api/fleet/battery-risk", { cache: "no-store" }),
        fetch(
          `/api/charging-demand${
            selectedDemandArea !== "ALL"
              ? `?area=${encodeURIComponent(selectedDemandArea)}`
              : ""
          }`,
          { cache: "no-store" }
        ),
      ]);
      const [j1, j2, j3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
      if (!r1.ok) throw new Error(j1.error || "Failed to load range predictions");
      if (!r2.ok) throw new Error(j2.error || "Failed to load risk predictions");
      if (!r3.ok) throw new Error(j3.error || "Failed to load demand forecast");
      setRangeData(j1);
      setRiskData(j2);
      setDemandData(j3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ML predictions");
    } finally {
      setLoading(false);
    }
  }, [selectedDemandArea]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadAll();
    }, 0);
    return () => clearTimeout(t);
  }, [loadAll, refreshToken]);

  const runLivePrediction = useCallback(async () => {
    setSimLoading(true);
    try {
      const res = await fetch("/api/ml/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          battery_percentage: simBattery,
          speed_kmh: simSpeed,
          temperature_c: simTemp,
          vehicle_weight_kg: simWeight,
          distance_travelled_km: 52,
          energy_consumption_kwh_per_km: simEnergy,
          traffic_level: simTraffic,
          nearest_station_distance_km: simStationDist,
          area:
            selectedDemandArea === "ALL"
              ? "Southeast Airport Freight"
              : selectedDemandArea,
        }),
      });
      const json = await res.json();
      if (res.ok) setSimResult(json);
    } finally {
      setSimLoading(false);
    }
  }, [
    simBattery,
    simSpeed,
    simTemp,
    simWeight,
    simEnergy,
    simTraffic,
    simStationDist,
    selectedDemandArea,
  ]);

  useEffect(() => {
    const t = setTimeout(() => {
      runLivePrediction();
    }, 150);
    return () => clearTimeout(t);
  }, [runLivePrediction, refreshToken]);

  async function handleRetrain() {
    setRetraining(true);
    setRetrainNotice(null);
    try {
      const res = await fetch("/api/ml/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ random_state: 42 }),
      });
      const json = await res.json();
      if (res.ok) {
        setRetrainNotice(
          json.message || "Successfully retrained all ML models and refreshed predictions."
        );
        await loadAll();
        onModelsRetrained();
      }
    } finally {
      setRetraining(false);
    }
  }

  if (loading && !rangeData) return <LoadingGrid cards={4} />;
  if (error || !rangeData || !riskData || !demandData) {
    return (
      <ErrorBanner
        message={error ?? "ML prediction data unavailable"}
        onRetry={loadAll}
      />
    );
  }

  const bestRange = rangeData.selectedModel;
  const riskMetrics = riskData.model?.metrics;
  const demandModel = demandData.model;

  const featureImportanceList = Object.entries(bestRange?.featureImportances ?? {})
    .map(([feature, importance]) => ({
      feature: formatFeatureName(feature),
      importancePct: Number((importance * 100).toFixed(1)),
    }))
    .sort((a, b) => b.importancePct - a.importancePct);

  const cm = riskMetrics?.confusionMatrix;
  const maxCell = cm ? Math.max(1, ...cm.matrix.flat()) : 1;

  return (
    <div className="space-y-6">
      {retrainNotice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            {retrainNotice}
          </span>
          <button
            onClick={() => setRetrainNotice(null)}
            className="text-emerald-700 dark:text-emerald-300 font-semibold hover:underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Evaluation Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <KpiCard
          label="Range MAE"
          value={bestRange ? bestRange.mae.toFixed(2) : "—"}
          unit="km"
          subtext={bestRange?.algorithmName ?? "Range Model"}
          icon={<Award className="w-4 h-4" />}
          tone="teal"
        />
        <KpiCard
          label="Range RMSE"
          value={bestRange ? bestRange.rmse.toFixed(2) : "—"}
          unit="km"
          subtext={`Test n=${bestRange?.testSamples ?? 0}`}
          icon={<BrainCircuit className="w-4 h-4" />}
          tone="blue"
        />
        <KpiCard
          label="Range R² Score"
          value={bestRange ? bestRange.r2.toFixed(4) : "—"}
          subtext={`5-Fold CV: ${bestRange?.cvR2Mean.toFixed(3) ?? "—"}`}
          icon={<CheckCircle2 className="w-4 h-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Risk Precision"
          value={
            riskMetrics ? `${(riskMetrics.macroPrecision * 100).toFixed(1)}%` : "—"
          }
          subtext="Macro 3-class score"
          icon={<ShieldAlert className="w-4 h-4" />}
          tone="amber"
        />
        <KpiCard
          label="Risk Recall"
          value={
            riskMetrics ? `${(riskMetrics.macroRecall * 100).toFixed(1)}%` : "—"
          }
          subtext={`Acc: ${riskMetrics ? (riskMetrics.accuracy * 100).toFixed(1) : 0}%`}
          icon={<ShieldAlert className="w-4 h-4" />}
          tone="red"
        />
        <KpiCard
          label="Risk F1-Score"
          value={riskMetrics ? `${(riskMetrics.macroF1 * 100).toFixed(1)}%` : "—"}
          subtext={`Weighted: ${riskMetrics ? (riskMetrics.weightedF1 * 100).toFixed(1) : 0}%`}
          icon={<Zap className="w-4 h-4" />}
          tone="teal"
        />
      </div>

      {/* MODEL 1: Range Prediction Model Comparison */}
      <SectionCard
        title="Model 1 — Remaining Range Regression Benchmark"
        subtitle="Automated model selection comparing Linear Regression, Random Forest Regressor, and XGBoost Regressor on an 80/20 held-out test split"
        action={
          <button
            onClick={handleRetrain}
            disabled={retraining}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 dark:bg-teal-500 text-white dark:text-slate-950 text-xs font-semibold hover:bg-teal-700 dark:hover:bg-teal-400 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${retraining ? "animate-spin" : ""}`} />
            {retraining ? "Retraining pipeline..." : "Retrain All Models"}
          </button>
        }
      >
        <div className="overflow-x-auto -mx-5 mb-5">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-5">Algorithm</th>
                <th className="py-2.5 px-4">MAE (km) ↓</th>
                <th className="py-2.5 px-4">RMSE (km) ↓</th>
                <th className="py-2.5 px-4">Test R² ↑</th>
                <th className="py-2.5 px-4">5-Fold CV R²</th>
                <th className="py-2.5 px-4">Split (Train/Test)</th>
                <th className="py-2.5 px-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
              {rangeData.modelComparison.map((m) => (
                <tr
                  key={m.algorithmName}
                  className={
                    m.isSelected
                      ? "bg-teal-50/45 dark:bg-teal-500/10"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  }
                >
                  <td className="py-3 px-5 font-semibold text-slate-900 dark:text-slate-100">
                    {m.algorithmName}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {m.mae.toFixed(3)}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {m.rmse.toFixed(3)}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                    {m.r2.toFixed(4)}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                    {m.cvR2Mean.toFixed(4)} ± {m.cvR2Std.toFixed(3)}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {m.trainSamples} / {m.testSamples}
                  </td>
                  <td className="py-3 px-5">
                    {m.isSelected ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-teal-600 dark:bg-teal-500 text-white dark:text-slate-950">
                        <Award className="w-3 h-3" /> Selected Champion
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Evaluated
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2">
          {/* Actual vs Predicted Scatter */}
          <div className="border border-slate-100 dark:border-slate-800 rounded-xl p-4 bg-slate-50/40 dark:bg-slate-800/40">
            <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-100 mb-1">
              Actual vs. Predicted Remaining Range (Test Set)
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
              Champion model ({bestRange?.algorithmName}) parity alignment along y = x
            </p>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.scatterGridStroke} />
                  <XAxis
                    type="number"
                    dataKey="actual"
                    name="Actual Range"
                    unit=" km"
                    tick={{ fontSize: 11, fill: ct.tickFill }}
                    axisLine={{ stroke: ct.axisStroke }}
                  />
                  <YAxis
                    type="number"
                    dataKey="predicted"
                    name="Predicted Range"
                    unit=" km"
                    tick={{ fontSize: 11, fill: ct.tickFill }}
                    axisLine={{ stroke: ct.axisStroke }}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={ct.tooltipStyle}
                    labelStyle={ct.tooltipLabelStyle}
                    itemStyle={ct.tooltipItemStyle}
                  />
                  <ReferenceLine
                    segment={[
                      { x: 0, y: 0 },
                      { x: 360, y: 360 },
                    ]}
                    stroke={ct.refLineStroke}
                    strokeDasharray="4 4"
                  />
                  <Scatter
                    name="Test EVs"
                    data={bestRange?.samplePredictions ?? []}
                    fill="#14b8a6"
                    fillOpacity={0.78}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Feature Importances */}
          <div className="border border-slate-100 dark:border-slate-800 rounded-xl p-4 bg-slate-50/40 dark:bg-slate-800/40">
            <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-100 mb-1">
              Range Model Feature Importance (%)
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
              Relative split-gain contribution across engineered telemetry predictors
            </p>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={featureImportanceList}
                  margin={{ top: 4, right: 18, left: 24, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={ct.scatterGridStroke}
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    unit="%"
                    tick={{ fontSize: 11, fill: ct.tickFill }}
                    axisLine={{ stroke: ct.axisStroke }}
                  />
                  <YAxis
                    type="category"
                    dataKey="feature"
                    width={132}
                    tick={{ fontSize: 11, fill: ct.categoryTickFill }}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: ct.cursorFill }}
                    contentStyle={ct.tooltipStyle}
                    labelStyle={ct.tooltipLabelStyle}
                    itemStyle={ct.tooltipItemStyle}
                    formatter={(val) => [`${val}%`, "Importance"]}
                  />
                  <Bar
                    dataKey="importancePct"
                    fill="#3b82f6"
                    radius={[0, 5, 5, 0]}
                    barSize={16}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* MODEL 2 & MODEL 3 Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* MODEL 2: Battery Risk Classification + Confusion Matrix */}
        <SectionCard
          title="Model 2 — Battery Risk Classification (LOW / MEDIUM / HIGH)"
          subtitle={`${riskData.model?.algorithmName ?? "Classifier"} · Confusion matrix & class-level F1 breakdown`}
        >
          {cm && riskMetrics && (
            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">
                  Test-Set Confusion Matrix (Rows = Actual, Columns = Predicted)
                </div>
                <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
                  <div className="py-2 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase">
                    Actual \ Pred
                  </div>
                  {cm.labels.map((lbl) => (
                    <div
                      key={`h-${lbl}`}
                      className="py-2 text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg"
                    >
                      {lbl}
                    </div>
                  ))}
                  {cm.matrix.map((row, rIdx) => (
                    <React.Fragment key={`r-${cm.labels[rIdx]}`}>
                      <div className="py-3 text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg flex items-center justify-center">
                        {cm.labels[rIdx]}
                      </div>
                      {row.map((val, cIdx) => {
                        const isDiag = rIdx === cIdx;
                        const intensity = Math.max(0.08, val / maxCell);
                        const bg = ct.isDark
                          ? isDiag
                            ? `rgba(20, 184, 166, ${0.2 + intensity * 0.58})`
                            : val > 0
                              ? `rgba(244, 63, 94, ${0.14 + intensity * 0.4})`
                              : "rgba(30, 41, 59, 0.55)"
                          : isDiag
                            ? `rgba(13, 148, 136, ${0.14 + intensity * 0.62})`
                            : val > 0
                              ? `rgba(239, 68, 68, ${0.08 + intensity * 0.35})`
                              : "#f8fafc";
                        return (
                          <div
                            key={`c-${rIdx}-${cIdx}`}
                            style={{ backgroundColor: bg }}
                            className={`py-3 rounded-lg font-mono font-bold tabular-nums border border-slate-200/60 dark:border-slate-700/70 ${
                              ct.isDark
                                ? val === 0 && !isDiag
                                  ? "text-slate-500"
                                  : "text-white"
                                : isDiag && intensity > 0.55
                                  ? "text-white"
                                  : "text-slate-800"
                            }`}
                          >
                            {val}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Per-class Precision / Recall / F1 */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 uppercase">
                      <th className="py-2">Class</th>
                      <th className="py-2">Precision</th>
                      <th className="py-2">Recall</th>
                      <th className="py-2">F1-Score</th>
                      <th className="py-2 text-right">Test Support</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {(["HIGH", "MEDIUM", "LOW"] as const).map((cls) => {
                      const pc = riskMetrics.perClass[cls];
                      return (
                        <tr key={cls}>
                          <td className="py-2 font-sans">
                            <RiskBadge risk={cls} />
                          </td>
                          <td className="py-2">
                            {pc ? `${(pc.precision * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-2">
                            {pc ? `${(pc.recall * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-2 font-semibold text-slate-900 dark:text-slate-100">
                            {pc ? `${(pc.f1 * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-2 text-right text-slate-500 dark:text-slate-400">
                            {pc?.support ?? 0}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SectionCard>

        {/* MODEL 3: Charging Demand Forecast */}
        <SectionCard
          title="Model 3 — Hourly Charging Demand Forecast"
          subtitle={`${demandModel?.algorithmName ?? "XGBoost"} · R² ${
            demandModel?.r2.toFixed(3) ?? "—"
          } · MAE ${demandModel?.mae.toFixed(1) ?? "—"} kWh`}
          action={
            <select
              aria-label="Filter demand area"
              value={selectedDemandArea}
              onChange={(e) => setSelectedDemandArea(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium"
            >
              <option value="ALL">All Metro Areas</option>
              {demandData.areaForecasts.map((a) => (
                <option key={a.area} value={a.area}>
                  {a.area}
                </option>
              ))}
            </select>
          }
        >
          <div className="mb-3 flex items-baseline justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              24-Hour Forecasted Energy Demand
            </span>
            <span className="font-mono text-sm font-bold text-teal-700 dark:text-teal-400 tabular-nums">
              {demandData.totalPredictedDailyDemandKwh.toLocaleString()} kWh
            </span>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={demandData.hourlyForecast}
                margin={{ top: 6, right: 10, left: -10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="demandForecastGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
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
                  tick={{ fontSize: 11, fill: ct.tickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={ct.tooltipStyle}
                  labelStyle={ct.tooltipLabelStyle}
                  itemStyle={ct.tooltipItemStyle}
                  formatter={(v) => [`${v} kWh`, "Predicted Demand"]}
                />
                <Area
                  type="monotone"
                  dataKey="predictedDemandKwh"
                  name="Predicted Demand (kWh)"
                  stroke="#3b82f6"
                  strokeWidth={2.2}
                  fill="url(#demandForecastGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      {/* Live Interactive What-If ML Inference Simulator */}
      <SectionCard
        title="Interactive Real-Time ML Range & Risk Simulator"
        subtitle="Adjust live vehicle telemetry features to run real-time inference against the persisted range, risk, and charging-demand models"
        action={
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
            <Sliders className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            POST /api/ml/predict
          </span>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <label className="block">
              <div className="flex justify-between mb-1 font-medium text-slate-700 dark:text-slate-300">
                <span>Battery Percentage</span>
                <span className="font-mono text-teal-700 dark:text-teal-400">
                  {simBattery}%
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                value={simBattery}
                onChange={(e) => setSimBattery(Number(e.target.value))}
                className="w-full accent-teal-600 dark:accent-teal-400 cursor-pointer"
              />
            </label>
            <label className="block">
              <div className="flex justify-between mb-1 font-medium text-slate-700 dark:text-slate-300">
                <span>Speed</span>
                <span className="font-mono text-teal-700 dark:text-teal-400">
                  {simSpeed} km/h
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={115}
                value={simSpeed}
                onChange={(e) => setSimSpeed(Number(e.target.value))}
                className="w-full accent-teal-600 dark:accent-teal-400 cursor-pointer"
              />
            </label>
            <label className="block">
              <div className="flex justify-between mb-1 font-medium text-slate-700 dark:text-slate-300">
                <span>Ambient Temperature</span>
                <span className="font-mono text-teal-700 dark:text-teal-400">
                  {simTemp}°C
                </span>
              </div>
              <input
                type="range"
                min={-5}
                max={42}
                value={simTemp}
                onChange={(e) => setSimTemp(Number(e.target.value))}
                className="w-full accent-teal-600 dark:accent-teal-400 cursor-pointer"
              />
            </label>
            <label className="block">
              <div className="flex justify-between mb-1 font-medium text-slate-700 dark:text-slate-300">
                <span>Gross Vehicle Weight</span>
                <span className="font-mono text-teal-700 dark:text-teal-400">
                  {simWeight.toLocaleString()} kg
                </span>
              </div>
              <input
                type="range"
                min={2000}
                max={7400}
                step={100}
                value={simWeight}
                onChange={(e) => setSimWeight(Number(e.target.value))}
                className="w-full accent-teal-600 dark:accent-teal-400 cursor-pointer"
              />
            </label>
            <label className="block">
              <div className="flex justify-between mb-1 font-medium text-slate-700 dark:text-slate-300">
                <span>Energy Consumption</span>
                <span className="font-mono text-teal-700 dark:text-teal-400">
                  {simEnergy.toFixed(2)} kWh/km
                </span>
              </div>
              <input
                type="range"
                min={0.18}
                max={0.68}
                step={0.02}
                value={simEnergy}
                onChange={(e) => setSimEnergy(Number(e.target.value))}
                className="w-full accent-teal-600 dark:accent-teal-400 cursor-pointer"
              />
            </label>
            <label className="block">
              <div className="flex justify-between mb-1 font-medium text-slate-700 dark:text-slate-300">
                <span>Nearest Charger Distance</span>
                <span className="font-mono text-teal-700 dark:text-teal-400">
                  {simStationDist.toFixed(1)} km
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={12}
                step={0.3}
                value={simStationDist}
                onChange={(e) => setSimStationDist(Number(e.target.value))}
                className="w-full accent-teal-600 dark:accent-teal-400 cursor-pointer"
              />
            </label>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2 pt-1">
              <span className="font-medium text-slate-700 dark:text-slate-300 mr-1">
                Traffic Level:
              </span>
              {(["LOW", "MEDIUM", "HIGH", "SEVERE"] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setSimTraffic(lvl)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                    simTraffic === lvl
                      ? "bg-slate-900 text-white border-slate-900 dark:bg-teal-500 dark:text-slate-950 dark:border-teal-500"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          {/* Prediction Result Panel */}
          <div className="lg:col-span-5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Live Model Output
              </span>
              {simLoading && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-600 dark:text-teal-400" />
              )}
            </div>
            {simResult && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white dark:bg-slate-900 rounded-lg p-3.5 border border-slate-200/80 dark:border-slate-700/80">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Predicted Range
                    </div>
                    <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-50 tabular-nums mt-1">
                      {simResult.predictedRangeKm.toFixed(1)}{" "}
                      <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                        km
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 truncate">
                      {simResult.rangeModel}
                    </div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 rounded-lg p-3.5 border border-slate-200/80 dark:border-slate-700/80">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                      Battery Risk
                    </div>
                    <RiskBadge risk={simResult.batteryRisk} />
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-1.5">
                      {(simResult.riskConfidence * 100).toFixed(0)}% confidence
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 rounded-lg p-3 border border-slate-200/80 dark:border-slate-700/80 leading-relaxed">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    AI Dispatch Guidance:{" "}
                  </span>
                  {simResult.recommendedAction}
                </div>
              </>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Fleet Vehicle Range & Risk Predictions Table */}
      <SectionCard
        title="Live Fleet Range & Battery-Risk Predictions"
        subtitle="Sorted by lowest predicted remaining range to highlight upcoming charging dispatches"
      >
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-5">Vehicle</th>
                <th className="py-2.5 px-3.5">Area</th>
                <th className="py-2.5 px-3.5">Battery</th>
                <th className="py-2.5 px-3.5">BMS Range</th>
                <th className="py-2.5 px-3.5">ML Predicted Range</th>
                <th className="py-2.5 px-3.5">Delta</th>
                <th className="py-2.5 px-3.5">Consumption</th>
                <th className="py-2.5 px-5">Predicted Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
              {rangeData.vehiclePredictions.slice(0, 12).map((vp) => (
                <tr
                  key={vp.vehicle_id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <td className="py-2.5 px-5 font-mono font-semibold text-teal-700 dark:text-teal-400">
                    {vp.vehicle_id}
                  </td>
                  <td className="py-2.5 px-3.5 text-slate-700 dark:text-slate-300">
                    {vp.area}
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {vp.battery_percentage.toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                    {vp.actual_range_km.toFixed(1)} km
                  </td>
                  <td className="py-2.5 px-3.5 font-mono font-semibold tabular-nums text-blue-700 dark:text-blue-400">
                    {vp.predicted_range_km.toFixed(1)} km
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {vp.error_km >= 0
                      ? `+${vp.error_km.toFixed(1)}`
                      : vp.error_km.toFixed(1)}{" "}
                    km
                  </td>
                  <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                    {vp.energy_consumption_kwh_per_km.toFixed(3)} kWh/km
                  </td>
                  <td className="py-2.5 px-5">
                    <RiskBadge risk={vp.battery_risk} />
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
