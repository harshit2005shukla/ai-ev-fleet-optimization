import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  telemetry,
  chargingStations,
  chargingEvents,
  mlPredictions,
  mlModelRuns,
  hotspotClusters,
} from "@/db/schema";
import { FLEET_AREAS, findNearestStation, haversineDistanceKm, resolveAreaAndCorridor } from "./geo";
import { SeededRng, TRAFFIC_ENCODED, deriveBatteryRiskLabel } from "./dataPipeline";
import { saveArtifact, loadArtifact } from "./s3";

// ---------------------------------------------------------------------------
// Data structures for serializable ML models
// ---------------------------------------------------------------------------

export interface RegTreeNode {
  leaf: boolean;
  value: number;
  feature?: number;
  threshold?: number;
  left?: RegTreeNode;
  right?: RegTreeNode;
}

export interface ClsTreeNode {
  leaf: boolean;
  probs: number[];
  feature?: number;
  threshold?: number;
  left?: ClsTreeNode;
  right?: ClsTreeNode;
}

export interface SerializedLinearModel {
  type: "linear_regression";
  featureNames: string[];
  means: number[];
  stds: number[];
  weights: number[];
  intercept: number;
}

export interface SerializedRFRegressor {
  type: "random_forest_regressor";
  featureNames: string[];
  trees: RegTreeNode[];
  featureImportances: Record<string, number>;
}

export interface SerializedXGBRegressor {
  type: "xgboost_regressor";
  featureNames: string[];
  baseScore: number;
  learningRate: number;
  trees: RegTreeNode[];
  featureImportances: Record<string, number>;
}

export type SerializedRegressor =
  | SerializedLinearModel
  | SerializedRFRegressor
  | SerializedXGBRegressor;

export interface SerializedRFClassifier {
  type: "random_forest_classifier";
  featureNames: string[];
  classes: string[];
  trees: ClsTreeNode[];
  featureImportances: Record<string, number>;
}

export interface RegressionMetrics {
  mae: number;
  rmse: number;
  r2: number;
  cvR2Mean?: number;
  cvR2Std?: number;
  featureImportances: Record<string, number>;
  samplePredictions: Array<{ actual: number; predicted: number; residual: number }>;
}

export interface ClassificationMetrics {
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  weightedF1: number;
  perClass: Record<
    string,
    { precision: number; recall: number; f1: number; support: number }
  >;
  confusionMatrix: {
    labels: string[];
    matrix: number[][];
  };
  featureImportances: Record<string, number>;
}

export const RANGE_FEATURE_NAMES = [
  "battery_percentage",
  "speed_kmh",
  "temperature_c",
  "vehicle_weight_kg",
  "distance_travelled_km",
  "energy_consumption_kwh_per_km",
  "traffic_level",
];

export const RISK_FEATURE_NAMES = [
  "battery_percentage",
  "remaining_range_km",
  "speed_kmh",
  "temperature_c",
  "traffic_level",
  "nearest_station_distance_km",
  "energy_consumption_kwh_per_km",
];

export const DEMAND_FEATURE_NAMES = [
  "hour",
  "day_of_week",
  "area_code",
  "number_of_active_evs",
  "average_battery",
  "historical_charging_events",
  "temperature_c",
  "traffic_level",
];

export const RISK_CLASSES = ["LOW", "MEDIUM", "HIGH"];

const AREA_CODE_MAP: Record<string, number> = Object.fromEntries(
  FLEET_AREAS.map((a, idx) => [a.name, idx])
);

// ---------------------------------------------------------------------------
// Core Math & Regression / Classification Algorithms
// ---------------------------------------------------------------------------

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) {
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const pivot = Math.abs(M[col][col]) < 1e-10 ? 1e-10 : M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }
  return M.map((row) => row[n]);
}

export function trainLinearRegression(
  X: number[][],
  y: number[],
  featureNames: string[],
  ridgeAlpha = 1e-4
): SerializedLinearModel {
  const n = X.length;
  const p = featureNames.length;
  const means = new Array<number>(p).fill(0);
  const stds = new Array<number>(p).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) means[j] += X[i][j];
  }
  for (let j = 0; j < p; j++) means[j] /= n;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      const d = X[i][j] - means[j];
      stds[j] += d * d;
    }
  }
  for (let j = 0; j < p; j++) {
    stds[j] = Math.sqrt(stds[j] / n) || 1;
  }

  const yMean = y.reduce((acc, v) => acc + v, 0) / n;
  const XtX: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);

  for (let i = 0; i < n; i++) {
    const yc = y[i] - yMean;
    const z = new Array<number>(p);
    for (let j = 0; j < p; j++) z[j] = (X[i][j] - means[j]) / stds[j];
    for (let j = 0; j < p; j++) {
      Xty[j] += z[j] * yc;
      for (let k = j; k < p; k++) {
        XtX[j][k] += z[j] * z[k];
      }
    }
  }
  for (let j = 0; j < p; j++) {
    XtX[j][j] += ridgeAlpha;
    for (let k = 0; k < j; k++) XtX[j][k] = XtX[k][j];
  }

  const weights = solveLinearSystem(XtX, Xty);
  return {
    type: "linear_regression",
    featureNames,
    means,
    stds,
    weights,
    intercept: yMean,
  };
}

function getCandidateThresholds(
  X: number[][],
  indices: number[],
  feature: number,
  maxBins = 16
): number[] {
  const vals: number[] = [];
  const step = Math.max(1, Math.floor(indices.length / 240));
  for (let i = 0; i < indices.length; i += step) {
    vals.push(X[indices[i]][feature]);
  }
  vals.sort((a, b) => a - b);
  const thresholds: number[] = [];
  for (let b = 1; b < maxBins; b++) {
    const pos = Math.floor((b / maxBins) * (vals.length - 1));
    const v = vals[pos];
    if (thresholds.length === 0 || v > thresholds[thresholds.length - 1] + 1e-9) {
      thresholds.push(v);
    }
  }
  return thresholds;
}

function sampleFeatures(total: number, count: number, rng: SeededRng): number[] {
  const arr = Array.from({ length: total }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(total, Math.max(1, count)));
}

function buildCartRegTree(
  X: number[][],
  y: number[],
  indices: number[],
  depth: number,
  maxDepth: number,
  minSamplesSplit: number,
  maxFeatures: number,
  importances: number[],
  rng: SeededRng
): RegTreeNode {
  const n = indices.length;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = y[indices[i]];
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / Math.max(1, n);
  const totalSse = Math.max(0, sumSq - (sum * sum) / Math.max(1, n));

  if (depth >= maxDepth || n < minSamplesSplit || totalSse < 1e-6) {
    return { leaf: true, value: Number(mean.toFixed(4)) };
  }

  const featCandidates = sampleFeatures(X[0].length, maxFeatures, rng);
  let bestGain = 0;
  let bestFeat = -1;
  let bestThresh = 0;

  for (const feat of featCandidates) {
    const thresholds = getCandidateThresholds(X, indices, feat, 14);
    for (const thresh of thresholds) {
      let lSum = 0;
      let lSumSq = 0;
      let lCount = 0;
      for (let i = 0; i < n; i++) {
        const idx = indices[i];
        if (X[idx][feat] <= thresh) {
          const v = y[idx];
          lSum += v;
          lSumSq += v * v;
          lCount++;
        }
      }
      const rCount = n - lCount;
      if (lCount < 3 || rCount < 3) continue;
      const rSum = sum - lSum;
      const rSumSq = sumSq - lSumSq;
      const lSse = Math.max(0, lSumSq - (lSum * lSum) / lCount);
      const rSse = Math.max(0, rSumSq - (rSum * rSum) / rCount);
      const gain = totalSse - (lSse + rSse);
      if (gain > bestGain) {
        bestGain = gain;
        bestFeat = feat;
        bestThresh = thresh;
      }
    }
  }

  if (bestFeat === -1 || bestGain <= 1e-5) {
    return { leaf: true, value: Number(mean.toFixed(4)) };
  }

  importances[bestFeat] += bestGain;
  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = indices[i];
    if (X[idx][bestFeat] <= bestThresh) leftIdx.push(idx);
    else rightIdx.push(idx);
  }

  return {
    leaf: false,
    value: Number(mean.toFixed(4)),
    feature: bestFeat,
    threshold: Number(bestThresh.toFixed(5)),
    left: buildCartRegTree(
      X,
      y,
      leftIdx,
      depth + 1,
      maxDepth,
      minSamplesSplit,
      maxFeatures,
      importances,
      rng
    ),
    right: buildCartRegTree(
      X,
      y,
      rightIdx,
      depth + 1,
      maxDepth,
      minSamplesSplit,
      maxFeatures,
      importances,
      rng
    ),
  };
}

function normalizeImportances(
  featureNames: string[],
  raw: number[]
): Record<string, number> {
  const total = raw.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const out: Record<string, number> = {};
  featureNames.forEach((name, idx) => {
    out[name] = Number((Math.max(0, raw[idx]) / total).toFixed(4));
  });
  return out;
}

export function trainRandomForestRegressor(
  X: number[][],
  y: number[],
  featureNames: string[],
  opts?: { nEstimators?: number; maxDepth?: number; seed?: number }
): SerializedRFRegressor {
  const nEstimators = opts?.nEstimators ?? 22;
  const maxDepth = opts?.maxDepth ?? 7;
  const rng = new SeededRng(opts?.seed ?? 42);
  const p = featureNames.length;
  const maxFeatures = Math.max(2, Math.ceil(p * 0.72));
  const importances = new Array<number>(p).fill(0);
  const trees: RegTreeNode[] = [];
  const n = X.length;

  for (let t = 0; t < nEstimators; t++) {
    const bootIdx = new Array<number>(n);
    for (let i = 0; i < n; i++) bootIdx[i] = Math.floor(rng.next() * n);
    trees.push(
      buildCartRegTree(X, y, bootIdx, 0, maxDepth, 8, maxFeatures, importances, rng)
    );
  }

  return {
    type: "random_forest_regressor",
    featureNames,
    trees,
    featureImportances: normalizeImportances(featureNames, importances),
  };
}

/**
 * Exact regularized Newton-step Gradient Boosted Regression Tree (XGBoost formulation):
 * Leaf weight w* = -G / (H + lambda)
 * Split Gain = 0.5 * [G_L^2/(H_L+lambda) + G_R^2/(H_R+lambda) - G^2/(H+lambda)] - gamma
 */
function buildXGBTree(
  X: number[][],
  gradients: number[],
  indices: number[],
  depth: number,
  maxDepth: number,
  regLambda: number,
  gamma: number,
  colsample: number,
  importances: number[],
  rng: SeededRng
): RegTreeNode {
  const n = indices.length;
  let G = 0;
  for (let i = 0; i < n; i++) G += gradients[indices[i]];
  const H = n; // For squared error loss, second derivative h_i = 1
  const leafWeight = -G / (H + regLambda);

  if (depth >= maxDepth || n < 8) {
    return { leaf: true, value: Number(leafWeight.toFixed(4)) };
  }

  const p = X[0].length;
  const featCandidates = sampleFeatures(p, Math.ceil(p * colsample), rng);
  const parentScore = (G * G) / (H + regLambda);
  let bestGain = 0;
  let bestFeat = -1;
  let bestThresh = 0;

  for (const feat of featCandidates) {
    const thresholds = getCandidateThresholds(X, indices, feat, 16);
    for (const thresh of thresholds) {
      let GL = 0;
      let HL = 0;
      for (let i = 0; i < n; i++) {
        const idx = indices[i];
        if (X[idx][feat] <= thresh) {
          GL += gradients[idx];
          HL += 1;
        }
      }
      const HR = H - HL;
      if (HL < 3 || HR < 3) continue;
      const GR = G - GL;
      const gain =
        0.5 * ((GL * GL) / (HL + regLambda) + (GR * GR) / (HR + regLambda) - parentScore) -
        gamma;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeat = feat;
        bestThresh = thresh;
      }
    }
  }

  if (bestFeat === -1 || bestGain <= 0) {
    return { leaf: true, value: Number(leafWeight.toFixed(4)) };
  }

  importances[bestFeat] += bestGain;
  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = indices[i];
    if (X[idx][bestFeat] <= bestThresh) leftIdx.push(idx);
    else rightIdx.push(idx);
  }

  return {
    leaf: false,
    value: Number(leafWeight.toFixed(4)),
    feature: bestFeat,
    threshold: Number(bestThresh.toFixed(5)),
    left: buildXGBTree(
      X,
      gradients,
      leftIdx,
      depth + 1,
      maxDepth,
      regLambda,
      gamma,
      colsample,
      importances,
      rng
    ),
    right: buildXGBTree(
      X,
      gradients,
      rightIdx,
      depth + 1,
      maxDepth,
      regLambda,
      gamma,
      colsample,
      importances,
      rng
    ),
  };
}

function predictRegTree(node: RegTreeNode, x: number[]): number {
  let curr = node;
  while (!curr.leaf && curr.feature !== undefined && curr.threshold !== undefined) {
    curr = x[curr.feature] <= curr.threshold ? curr.left! : curr.right!;
  }
  return curr.value;
}

export function trainXGBoostRegressor(
  X: number[][],
  y: number[],
  featureNames: string[],
  opts?: {
    nEstimators?: number;
    maxDepth?: number;
    learningRate?: number;
    regLambda?: number;
    subsample?: number;
    seed?: number;
  }
): SerializedXGBRegressor {
  const nEstimators = opts?.nEstimators ?? 38;
  const maxDepth = opts?.maxDepth ?? 5;
  const learningRate = opts?.learningRate ?? 0.14;
  const regLambda = opts?.regLambda ?? 1.2;
  const subsample = opts?.subsample ?? 0.85;
  const rng = new SeededRng(opts?.seed ?? 42);

  const n = X.length;
  const p = featureNames.length;
  const baseScore = y.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const preds = new Array<number>(n).fill(baseScore);
  const gradients = new Array<number>(n).fill(0);
  const importances = new Array<number>(p).fill(0);
  const trees: RegTreeNode[] = [];

  for (let m = 0; m < nEstimators; m++) {
    const subIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      gradients[i] = preds[i] - y[i]; // d/dy_hat [0.5*(y - y_hat)^2]
      if (rng.next() <= subsample) subIdx.push(i);
    }
    if (subIdx.length < 16) {
      for (let i = 0; i < Math.min(n, 32); i++) subIdx.push(i);
    }

    const tree = buildXGBTree(
      X,
      gradients,
      subIdx,
      0,
      maxDepth,
      regLambda,
      0.05,
      0.88,
      importances,
      rng
    );
    trees.push(tree);
    for (let i = 0; i < n; i++) {
      preds[i] += learningRate * predictRegTree(tree, X[i]);
    }
  }

  return {
    type: "xgboost_regressor",
    featureNames,
    baseScore: Number(baseScore.toFixed(4)),
    learningRate,
    trees,
    featureImportances: normalizeImportances(featureNames, importances),
  };
}

export function predictRegressor(model: SerializedRegressor, x: number[]): number {
  if (model.type === "linear_regression") {
    let out = model.intercept;
    for (let j = 0; j < model.weights.length; j++) {
      out += model.weights[j] * ((x[j] - model.means[j]) / model.stds[j]);
    }
    return Math.max(0, out);
  }
  if (model.type === "random_forest_regressor") {
    let sum = 0;
    for (const tree of model.trees) sum += predictRegTree(tree, x);
    return Math.max(0, sum / Math.max(1, model.trees.length));
  }
  let out = model.baseScore;
  for (const tree of model.trees) {
    out += model.learningRate * predictRegTree(tree, x);
  }
  return Math.max(0, out);
}

function evaluateRegressor(
  model: SerializedRegressor,
  XTest: number[][],
  yTest: number[]
): RegressionMetrics {
  const n = Math.max(1, XTest.length);
  const yMean = yTest.reduce((a, b) => a + b, 0) / n;
  let absErr = 0;
  let sqErr = 0;
  let ssTot = 0;
  const samplePredictions: Array<{ actual: number; predicted: number; residual: number }> = [];
  const sampleStride = Math.max(1, Math.floor(n / 90));

  for (let i = 0; i < n; i++) {
    const pred = predictRegressor(model, XTest[i]);
    const err = yTest[i] - pred;
    absErr += Math.abs(err);
    sqErr += err * err;
    const diffMean = yTest[i] - yMean;
    ssTot += diffMean * diffMean;
    if (i % sampleStride === 0 && samplePredictions.length < 90) {
      samplePredictions.push({
        actual: Number(yTest[i].toFixed(1)),
        predicted: Number(pred.toFixed(1)),
        residual: Number((pred - yTest[i]).toFixed(1)),
      });
    }
  }

  const mae = absErr / n;
  const rmse = Math.sqrt(sqErr / n);
  const r2 = ssTot > 1e-9 ? 1 - sqErr / ssTot : 0;

  let featureImportances: Record<string, number>;
  if (model.type === "linear_regression") {
    const absWeights = model.weights.map((w) => Math.abs(w));
    featureImportances = normalizeImportances(model.featureNames, absWeights);
  } else {
    featureImportances = model.featureImportances;
  }

  return {
    mae: Number(mae.toFixed(3)),
    rmse: Number(rmse.toFixed(3)),
    r2: Number(r2.toFixed(4)),
    featureImportances,
    samplePredictions,
  };
}

function crossValidateR2(
  X: number[][],
  y: number[],
  trainer: (xTr: number[][], yTr: number[]) => SerializedRegressor,
  k = 5
): { mean: number; std: number } {
  const n = X.length;
  const foldSize = Math.floor(n / k);
  const scores: number[] = [];

  for (let f = 0; f < k; f++) {
    const valStart = f * foldSize;
    const valEnd = f === k - 1 ? n : valStart + foldSize;
    const xTr: number[][] = [];
    const yTr: number[] = [];
    const xVal: number[][] = [];
    const yVal: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i >= valStart && i < valEnd) {
        xVal.push(X[i]);
        yVal.push(y[i]);
      } else {
        xTr.push(X[i]);
        yTr.push(y[i]);
      }
    }
    const m = trainer(xTr, yTr);
    const metrics = evaluateRegressor(m, xVal, yVal);
    scores.push(metrics.r2);
  }

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / scores.length;
  return {
    mean: Number(mean.toFixed(4)),
    std: Number(Math.sqrt(variance).toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// Multi-class Random Forest Classifier (Battery Risk: LOW / MEDIUM / HIGH)
// ---------------------------------------------------------------------------

function giniFromCounts(counts: number[], total: number): number {
  if (total === 0) return 0;
  let sumSq = 0;
  for (let c = 0; c < counts.length; c++) {
    const p = counts[c] / total;
    sumSq += p * p;
  }
  return 1 - sumSq;
}

function buildClsTree(
  X: number[][],
  y: number[],
  numClasses: number,
  indices: number[],
  depth: number,
  maxDepth: number,
  maxFeatures: number,
  importances: number[],
  rng: SeededRng
): ClsTreeNode {
  const n = indices.length;
  const counts = new Array<number>(numClasses).fill(0);
  for (let i = 0; i < n; i++) counts[y[indices[i]]]++;
  const probs = counts.map((c) => Number((c / Math.max(1, n)).toFixed(4)));
  const parentGini = giniFromCounts(counts, n);

  if (depth >= maxDepth || n < 6 || parentGini < 1e-5) {
    return { leaf: true, probs };
  }

  const featCandidates = sampleFeatures(X[0].length, maxFeatures, rng);
  let bestGain = 0;
  let bestFeat = -1;
  let bestThresh = 0;

  for (const feat of featCandidates) {
    const thresholds = getCandidateThresholds(X, indices, feat, 14);
    for (const thresh of thresholds) {
      const lCounts = new Array<number>(numClasses).fill(0);
      let lTotal = 0;
      for (let i = 0; i < n; i++) {
        const idx = indices[i];
        if (X[idx][feat] <= thresh) {
          lCounts[y[idx]]++;
          lTotal++;
        }
      }
      const rTotal = n - lTotal;
      if (lTotal < 2 || rTotal < 2) continue;
      const rCounts = counts.map((c, idx) => c - lCounts[idx]);
      const weightedChild =
        (lTotal / n) * giniFromCounts(lCounts, lTotal) +
        (rTotal / n) * giniFromCounts(rCounts, rTotal);
      const gain = (parentGini - weightedChild) * n;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeat = feat;
        bestThresh = thresh;
      }
    }
  }

  if (bestFeat === -1 || bestGain <= 1e-5) {
    return { leaf: true, probs };
  }

  importances[bestFeat] += bestGain;
  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = indices[i];
    if (X[idx][bestFeat] <= bestThresh) leftIdx.push(idx);
    else rightIdx.push(idx);
  }

  return {
    leaf: false,
    probs,
    feature: bestFeat,
    threshold: Number(bestThresh.toFixed(5)),
    left: buildClsTree(
      X,
      y,
      numClasses,
      leftIdx,
      depth + 1,
      maxDepth,
      maxFeatures,
      importances,
      rng
    ),
    right: buildClsTree(
      X,
      y,
      numClasses,
      rightIdx,
      depth + 1,
      maxDepth,
      maxFeatures,
      importances,
      rng
    ),
  };
}

export function trainRandomForestClassifier(
  X: number[][],
  y: number[],
  featureNames: string[],
  classes: string[],
  opts?: { nEstimators?: number; maxDepth?: number; seed?: number }
): SerializedRFClassifier {
  const nEstimators = opts?.nEstimators ?? 26;
  const maxDepth = opts?.maxDepth ?? 8;
  const rng = new SeededRng(opts?.seed ?? 42);
  const p = featureNames.length;
  const maxFeatures = Math.max(2, Math.ceil(Math.sqrt(p) + 1));
  const importances = new Array<number>(p).fill(0);
  const trees: ClsTreeNode[] = [];
  const n = X.length;

  for (let t = 0; t < nEstimators; t++) {
    const bootIdx = new Array<number>(n);
    for (let i = 0; i < n; i++) bootIdx[i] = Math.floor(rng.next() * n);
    trees.push(
      buildClsTree(X, y, classes.length, bootIdx, 0, maxDepth, maxFeatures, importances, rng)
    );
  }

  return {
    type: "random_forest_classifier",
    featureNames,
    classes,
    trees,
    featureImportances: normalizeImportances(featureNames, importances),
  };
}

export function predictClassifierProbs(
  model: SerializedRFClassifier,
  x: number[]
): { label: string; classIndex: number; confidence: number; probabilities: Record<string, number> } {
  const k = model.classes.length;
  const avg = new Array<number>(k).fill(0);
  for (const tree of model.trees) {
    let curr = tree;
    while (!curr.leaf && curr.feature !== undefined && curr.threshold !== undefined) {
      curr = x[curr.feature] <= curr.threshold ? curr.left! : curr.right!;
    }
    for (let c = 0; c < k; c++) avg[c] += curr.probs[c];
  }
  let bestIdx = 0;
  const probabilities: Record<string, number> = {};
  for (let c = 0; c < k; c++) {
    avg[c] /= Math.max(1, model.trees.length);
    probabilities[model.classes[c]] = Number(avg[c].toFixed(4));
    if (avg[c] > avg[bestIdx]) bestIdx = c;
  }
  return {
    label: model.classes[bestIdx],
    classIndex: bestIdx,
    confidence: Number(avg[bestIdx].toFixed(4)),
    probabilities,
  };
}

function evaluateClassifier(
  model: SerializedRFClassifier,
  XTest: number[][],
  yTest: number[]
): ClassificationMetrics {
  const k = model.classes.length;
  const matrix: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  let correct = 0;

  for (let i = 0; i < XTest.length; i++) {
    const pred = predictClassifierProbs(model, XTest[i]);
    matrix[yTest[i]][pred.classIndex]++;
    if (pred.classIndex === yTest[i]) correct++;
  }

  const perClass: ClassificationMetrics["perClass"] = {};
  let sumPrec = 0;
  let sumRec = 0;
  let sumF1 = 0;
  let weightedF1Sum = 0;
  const total = Math.max(1, XTest.length);

  for (let c = 0; c < k; c++) {
    const tp = matrix[c][c];
    let fp = 0;
    let fn = 0;
    for (let j = 0; j < k; j++) {
      if (j !== c) {
        fp += matrix[j][c];
        fn += matrix[c][j];
      }
    }
    const support = tp + fn;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = support > 0 ? tp / support : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[model.classes[c]] = {
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1: Number(f1.toFixed(4)),
      support,
    };
    sumPrec += precision;
    sumRec += recall;
    sumF1 += f1;
    weightedF1Sum += f1 * support;
  }

  return {
    accuracy: Number((correct / total).toFixed(4)),
    macroPrecision: Number((sumPrec / k).toFixed(4)),
    macroRecall: Number((sumRec / k).toFixed(4)),
    macroF1: Number((sumF1 / k).toFixed(4)),
    weightedF1: Number((weightedF1Sum / total).toFixed(4)),
    perClass,
    confusionMatrix: {
      labels: model.classes,
      matrix,
    },
    featureImportances: model.featureImportances,
  };
}

// ---------------------------------------------------------------------------
// Deterministic K-Means++ Geospatial Clustering
// ---------------------------------------------------------------------------

interface KMeansResult {
  centroids: Array<[number, number]>;
  assignments: number[];
  inertia: number;
}

export function runKMeansPlusPlus(
  points: Array<[number, number]>,
  k: number,
  seed = 42,
  maxIter = 35
): KMeansResult {
  const n = points.length;
  const actualK = Math.max(1, Math.min(k, n));
  const rng = new SeededRng(seed);

  // K-Means++ initialization
  const centroids: Array<[number, number]> = [points[Math.floor(rng.next() * n)]];
  const distSq = new Array<number>(n).fill(Infinity);

  for (let c = 1; c < actualK; c++) {
    let totalD = 0;
    const prev = centroids[c - 1];
    for (let i = 0; i < n; i++) {
      const dx = points[i][0] - prev[0];
      const dy = points[i][1] - prev[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < distSq[i]) distSq[i] = d2;
      totalD += distSq[i];
    }
    let threshold = rng.next() * totalD;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      threshold -= distSq[i];
      if (threshold <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push([points[chosen][0], points[chosen][1]]);
  }

  const assignments = new Array<number>(n).fill(0);
  let inertia = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    inertia = 0;
    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < actualK; c++) {
        const dx = points[i][0] - centroids[c][0];
        const dy = points[i][1] - centroids[c][1];
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      inertia += bestD;
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed = true;
      }
    }
    if (!changed && iter > 0) break;

    const sums: Array<[number, number, number]> = Array.from({ length: actualK }, () => [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      sums[c][0] += points[i][0];
      sums[c][1] += points[i][1];
      sums[c][2] += 1;
    }
    for (let c = 0; c < actualK; c++) {
      if (sums[c][2] > 0) {
        centroids[c] = [sums[c][0] / sums[c][2], sums[c][1] / sums[c][2]];
      }
    }
  }

  return { centroids, assignments, inertia: Number(inertia.toFixed(5)) };
}

// ---------------------------------------------------------------------------
// Full End-to-End ML Training, Hotspot Clustering & DB Persistence
// ---------------------------------------------------------------------------

function trainTestSplitIndices(n: number, testRatio = 0.2, seed = 42) {
  const rng = new SeededRng(seed);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const split = Math.max(1, Math.floor(n * (1 - testRatio)));
  return {
    trainIdx: idx.slice(0, split),
    testIdx: idx.slice(split),
  };
}

export interface FullTrainingSummary {
  rangeModels: Array<{
    algorithm: string;
    selected: boolean;
    mae: number;
    rmse: number;
    r2: number;
    cvR2Mean: number;
  }>;
  selectedRangeModel: string;
  batteryRiskModel: {
    algorithm: string;
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
  };
  chargingDemandModel: {
    algorithm: string;
    mae: number;
    rmse: number;
    r2: number;
  };
  hotspotsGenerated: number;
  vehiclePredictionsStored: number;
  storageBackend: "s3" | "local";
  durationMs: number;
}

export async function trainAllModelsAndClusters(seed = 42): Promise<FullTrainingSummary> {
  const t0 = Date.now();

  // Load up to 4,500 most recent cleaned telemetry records for training
  const rows = await db
    .select()
    .from(telemetry)
    .orderBy(desc(telemetry.timestamp))
    .limit(4500);

  if (rows.length < 40) {
    throw new Error("Insufficient telemetry records in database to train ML models.");
  }

  const stations = await db.select().from(chargingStations);
  const events = await db.select().from(chargingEvents);

  // Use a stratified random sample up to 2,200 rows for ultra-crisp, responsive training + 5-fold CV
  const rng = new SeededRng(seed);
  const samplePool = rows.length > 2200 ? rows.filter((_, i) => i % Math.ceil(rows.length / 2200) === 0 || rng.next() < 2200 / rows.length).slice(0, 2200) : rows;
  const { trainIdx, testIdx } = trainTestSplitIndices(samplePool.length, 0.2, seed);

  // -------------------------------------------------------------------------
  // MODEL 1: Remaining Range Prediction (Linear Regression vs RF vs XGBoost)
  // -------------------------------------------------------------------------
  const XRange = samplePool.map((r) => [
    r.batteryPercentage,
    r.speedKmh,
    r.temperatureC,
    r.vehicleWeightKg,
    r.distanceTravelledKm,
    r.energyConsumptionKwhPerKm,
    TRAFFIC_ENCODED[r.trafficLevel] ?? 1,
  ]);
  const yRange = samplePool.map((r) => r.remainingRangeKm);

  const XRangeTrain = trainIdx.map((i) => XRange[i]);
  const yRangeTrain = trainIdx.map((i) => yRange[i]);
  const XRangeTest = testIdx.map((i) => XRange[i]);
  const yRangeTest = testIdx.map((i) => yRange[i]);

  // 5-fold CV sample (up to 1,000 rows for rapid 5x training)
  const cvN = Math.min(1000, XRangeTrain.length);
  const XCv = XRangeTrain.slice(0, cvN);
  const yCv = yRangeTrain.slice(0, cvN);

  const linModel = trainLinearRegression(XRangeTrain, yRangeTrain, RANGE_FEATURE_NAMES);
  const linMetrics = evaluateRegressor(linModel, XRangeTest, yRangeTest);
  const linCv = crossValidateR2(
    XCv,
    yCv,
    (xt, yt) => trainLinearRegression(xt, yt, RANGE_FEATURE_NAMES),
    5
  );
  linMetrics.cvR2Mean = linCv.mean;
  linMetrics.cvR2Std = linCv.std;

  const rfRegModel = trainRandomForestRegressor(XRangeTrain, yRangeTrain, RANGE_FEATURE_NAMES, {
    nEstimators: 22,
    maxDepth: 7,
    seed,
  });
  const rfRegMetrics = evaluateRegressor(rfRegModel, XRangeTest, yRangeTest);
  const rfCv = crossValidateR2(
    XCv,
    yCv,
    (xt, yt) =>
      trainRandomForestRegressor(xt, yt, RANGE_FEATURE_NAMES, {
        nEstimators: 14,
        maxDepth: 7,
        seed,
      }),
    5
  );
  rfRegMetrics.cvR2Mean = rfCv.mean;
  rfRegMetrics.cvR2Std = rfCv.std;

  const xgbRegModel = trainXGBoostRegressor(XRangeTrain, yRangeTrain, RANGE_FEATURE_NAMES, {
    nEstimators: 40,
    maxDepth: 5,
    learningRate: 0.14,
    regLambda: 1.2,
    subsample: 0.85,
    seed,
  });
  const xgbRegMetrics = evaluateRegressor(xgbRegModel, XRangeTest, yRangeTest);
  const xgbCv = crossValidateR2(
    XCv,
    yCv,
    (xt, yt) =>
      trainXGBoostRegressor(xt, yt, RANGE_FEATURE_NAMES, {
        nEstimators: 28,
        maxDepth: 5,
        learningRate: 0.15,
        regLambda: 1.2,
        seed,
      }),
    5
  );
  xgbRegMetrics.cvR2Mean = xgbCv.mean;
  xgbRegMetrics.cvR2Std = xgbCv.std;

  const rangeCandidates: Array<{
    name: string;
    model: SerializedRegressor;
    metrics: RegressionMetrics;
  }> = [
    { name: "Linear Regression", model: linModel, metrics: linMetrics },
    { name: "Random Forest Regressor", model: rfRegModel, metrics: rfRegMetrics },
    { name: "XGBoost Regressor", model: xgbRegModel, metrics: xgbRegMetrics },
  ];

  // Auto-select best range model by lowest held-out RMSE (highest R²)
  rangeCandidates.sort((a, b) => a.metrics.rmse - b.metrics.rmse);
  const championRange = rangeCandidates[0];

  const savedRange = await saveArtifact(
    "models",
    "best_range_model.json",
    JSON.stringify({
      algorithmName: championRange.name,
      trainedAt: new Date().toISOString(),
      metrics: championRange.metrics,
      model: championRange.model,
    })
  );

  // -------------------------------------------------------------------------
  // MODEL 2: Battery Risk Classification (LOW / MEDIUM / HIGH)
  // -------------------------------------------------------------------------
  const XRisk = samplePool.map((r) => [
    r.batteryPercentage,
    r.remainingRangeKm,
    r.speedKmh,
    r.temperatureC,
    TRAFFIC_ENCODED[r.trafficLevel] ?? 1,
    r.nearestStationDistanceKm,
    r.energyConsumptionKwhPerKm,
  ]);
  const yRisk = samplePool.map((r) => {
    const lbl = deriveBatteryRiskLabel(r);
    return RISK_CLASSES.indexOf(lbl);
  });

  const XRiskTrain = trainIdx.map((i) => XRisk[i]);
  const yRiskTrain = trainIdx.map((i) => yRisk[i]);
  const XRiskTest = testIdx.map((i) => XRisk[i]);
  const yRiskTest = testIdx.map((i) => yRisk[i]);

  const riskModel = trainRandomForestClassifier(
    XRiskTrain,
    yRiskTrain,
    RISK_FEATURE_NAMES,
    RISK_CLASSES,
    { nEstimators: 28, maxDepth: 8, seed }
  );
  const riskMetrics = evaluateClassifier(riskModel, XRiskTest, yRiskTest);

  const savedRisk = await saveArtifact(
    "models",
    "battery_risk_model.json",
    JSON.stringify({
      algorithmName: "Random Forest Classifier",
      trainedAt: new Date().toISOString(),
      metrics: riskMetrics,
      model: riskModel,
    })
  );

  // -------------------------------------------------------------------------
  // MODEL 3: Charging Demand Prediction by Area / Hour / Day-of-Week
  // -------------------------------------------------------------------------
  // Pre-count historical charging events per (area, hour)
  const histEventMap = new Map<string, number>();
  const areaEventTotals = new Map<string, number>();
  for (const ev of events) {
    const hr = new Date(ev.startTime).getUTCHours();
    const k = `${ev.area}|${hr}`;
    histEventMap.set(k, (histEventMap.get(k) ?? 0) + 1);
    areaEventTotals.set(ev.area, (areaEventTotals.get(ev.area) ?? 0) + 1);
  }

  // Group telemetry into (area, day_of_week, hour) slices
  const bucketMap = new Map<
    string,
    {
      hour: number;
      dayOfWeek: number;
      area: string;
      areaCode: number;
      vehicles: Set<string>;
      batterySum: number;
      tempSum: number;
      trafficSum: number;
      lowBatteryCount: number;
      energyNeedKwh: number;
      count: number;
    }
  >();

  for (const r of rows) {
    const dt = new Date(r.timestamp);
    const hr = dt.getUTCHours();
    const dow = dt.getUTCDay();
    const key = `${r.area}|${dow}|${hr}`;
    let b = bucketMap.get(key);
    if (!b) {
      b = {
        hour: hr,
        dayOfWeek: dow,
        area: r.area,
        areaCode: AREA_CODE_MAP[r.area] ?? 0,
        vehicles: new Set(),
        batterySum: 0,
        tempSum: 0,
        trafficSum: 0,
        lowBatteryCount: 0,
        energyNeedKwh: 0,
        count: 0,
      };
      bucketMap.set(key, b);
    }
    b.vehicles.add(r.vehicleId);
    b.batterySum += r.batteryPercentage;
    b.tempSum += r.temperatureC;
    b.trafficSum += TRAFFIC_ENCODED[r.trafficLevel] ?? 1;
    if (r.batteryPercentage < 35) b.lowBatteryCount += 1;
    // Charging energy deficit factor (kWh expected charging demand)
    b.energyNeedKwh += Math.max(0, (82 - r.batteryPercentage) * 0.42);
    b.count += 1;
  }

  const demandBuckets = Array.from(bucketMap.values());
  const XDemand: number[][] = [];
  const yDemand: number[] = [];

  for (const b of demandBuckets) {
    const activeEvs = b.vehicles.size;
    const avgBattery = b.batterySum / b.count;
    const avgTemp = b.tempSum / b.count;
    const avgTraffic = b.trafficSum / b.count;
    const histEvents =
      (histEventMap.get(`${b.area}|${b.hour}`) ?? 0) +
      (areaEventTotals.get(b.area) ?? 0) * 0.04;

    XDemand.push([
      b.hour,
      b.dayOfWeek,
      b.areaCode,
      activeEvs,
      Number(avgBattery.toFixed(2)),
      Number(histEvents.toFixed(2)),
      Number(avgTemp.toFixed(2)),
      Number(avgTraffic.toFixed(2)),
    ]);

    // Expected charging demand (kWh per area-hour period)
    const demandTarget =
      activeEvs * ((100 - avgBattery) / 100) * 24.5 +
      histEvents * 6.8 +
      b.lowBatteryCount * 8.2 +
      avgTraffic * 4.5 +
      (Math.abs(avgTemp - 21) > 10 ? 7.5 : 1.5);
    yDemand.push(Number(demandTarget.toFixed(2)));
  }

  const demandSplit = trainTestSplitIndices(XDemand.length, 0.2, seed);
  const XDTrain = demandSplit.trainIdx.map((i) => XDemand[i]);
  const yDTrain = demandSplit.trainIdx.map((i) => yDemand[i]);
  const XDTest = demandSplit.testIdx.map((i) => XDemand[i]);
  const yDTest = demandSplit.testIdx.map((i) => yDemand[i]);

  const demandModel = trainXGBoostRegressor(XDTrain, yDTrain, DEMAND_FEATURE_NAMES, {
    nEstimators: 36,
    maxDepth: 5,
    learningRate: 0.14,
    regLambda: 1.0,
    seed,
  });
  const demandMetrics = evaluateRegressor(demandModel, XDTest, yDTest);
  const demandCv = crossValidateR2(
    XDemand,
    yDemand,
    (xt, yt) =>
      trainXGBoostRegressor(xt, yt, DEMAND_FEATURE_NAMES, {
        nEstimators: 26,
        maxDepth: 5,
        learningRate: 0.15,
        seed,
      }),
    5
  );
  demandMetrics.cvR2Mean = demandCv.mean;
  demandMetrics.cvR2Std = demandCv.std;

  // Precompute current 24-hour multi-area demand forecast using the trained model
  const areaDemandBaseline = FLEET_AREAS.map((area, areaIdx) => {
    const areaRows = rows.filter((r) => r.area === area.name);
    const uniqueEvs = new Set(areaRows.map((r) => r.vehicleId)).size || 6;
    const avgBat =
      areaRows.reduce((s, r) => s + r.batteryPercentage, 0) / Math.max(1, areaRows.length) || 55;
    const avgTemp =
      areaRows.reduce((s, r) => s + r.temperatureC, 0) / Math.max(1, areaRows.length) || 23;
    const avgTraffic =
      areaRows.reduce((s, r) => s + (TRAFFIC_ENCODED[r.trafficLevel] ?? 1), 0) /
        Math.max(1, areaRows.length) || 1.3;
    const histTotal = areaEventTotals.get(area.name) ?? 4;

    let total24hKwh = 0;
    const hourly: Array<{ hour: number; predictedDemandKwh: number }> = [];
    for (let hr = 0; hr < 24; hr++) {
      const hourFactor =
        hr >= 7 && hr <= 19 ? 0.65 + 0.35 * Math.sin(((hr - 6) / 14) * Math.PI) : 0.25;
      const evsAtHour = Math.max(1, Math.round(uniqueEvs * hourFactor * 0.48));
      const batAtHour = Math.max(22, avgBat - (hr >= 13 && hr <= 20 ? 11 : -5));
      const histHr = (histEventMap.get(`${area.name}|${hr}`) ?? 0) + histTotal * 0.04;
      const trafficHr = hr === 8 || hr === 17 || hr === 18 ? Math.min(3, avgTraffic + 0.8) : avgTraffic;
      const pred = predictRegressor(demandModel, [
        hr,
        new Date().getUTCDay(),
        areaIdx,
        evsAtHour,
        batAtHour,
        histHr,
        avgTemp,
        trafficHr,
      ]);
      const cleanPred = Number(pred.toFixed(1));
      total24hKwh += cleanPred;
      hourly.push({ hour: hr, predictedDemandKwh: cleanPred });
    }
    return {
      area: area.name,
      predictedDailyDemandKwh: Number(total24hKwh.toFixed(1)),
      peakHourDemandKwh: Math.max(...hourly.map((h) => h.predictedDemandKwh)),
      activeVehicles: uniqueEvs,
      avgBatteryPct: Number(avgBat.toFixed(1)),
      hourly,
    };
  });

  const savedDemand = await saveArtifact(
    "models",
    "charging_demand_model.json",
    JSON.stringify({
      algorithmName: "XGBoost Regressor",
      trainedAt: new Date().toISOString(),
      metrics: demandMetrics,
      areaForecasts: areaDemandBaseline,
      model: demandModel,
    })
  );

  // -------------------------------------------------------------------------
  // COMPONENT 4: K-Means++ Hotspot Clustering (Risk, Demand, High Activity)
  // -------------------------------------------------------------------------
  await db.delete(hotspotClusters);

  const clusterInserts: Array<typeof hotspotClusters.$inferInsert> = [];

  const buildClusterCategory = (
    subset: typeof rows,
    category: "BATTERY_RISK" | "HIGH_DEMAND" | "HIGH_ACTIVITY",
    k: number,
    seedOffset: number
  ) => {
    if (subset.length < k) return { km: null as KMeansResult | null };
    const pts: Array<[number, number]> = subset.map((r) => [r.latitude, r.longitude]);
    const km = runKMeansPlusPlus(pts, k, seed + seedOffset);

    for (let c = 0; c < km.centroids.length; c++) {
      const members = subset.filter((_, idx) => km.assignments[idx] === c);
      if (members.length === 0) continue;
      const [cLat, cLon] = km.centroids[c];
      const { area } = resolveAreaAndCorridor(cLat, cLon, c);
      const uniqueVehicles = new Set(members.map((m) => m.vehicleId)).size;
      const avgBat =
        members.reduce((s, m) => s + m.batteryPercentage, 0) / members.length;
      const criticalCount = members.filter((m) => m.batteryPercentage < 22).length;
      const avgEnergy =
        members.reduce((s, m) => s + m.energyConsumptionKwhPerKm, 0) / members.length;
      const avgDelay =
        members.reduce((s, m) => s + m.deliveryDelayMinutes, 0) / members.length;
      const nearest = findNearestStation(cLat, cLon, stations);

      // P80 spatial radius in km
      const dists = members
        .map((m) => haversineDistanceKm(cLat, cLon, m.latitude, m.longitude))
        .sort((a, b) => a - b);
      const radiusKm = Math.max(
        0.9,
        Math.min(4.2, dists[Math.floor(dists.length * 0.8)] ?? 1.8)
      );

      const areaForecast =
        areaDemandBaseline.find((a) => a.area === area)?.peakHourDemandKwh ?? 85;
      const demandIntensity = Number(
        (members.length * ((100 - avgBat) / 100) * 1.4 + areaForecast * 0.45).toFixed(1)
      );

      const severity = Math.min(
        99.5,
        Math.max(
          18,
          (100 - avgBat) * 0.42 +
            Math.min(30, nearest.distanceKm * 3.8) +
            Math.min(20, criticalCount * 0.75) +
            Math.min(15, avgDelay * 0.8)
        )
      );

      clusterInserts.push({
        clusterIndex: c,
        clusterCategory: category,
        area,
        centroidLat: Number(cLat.toFixed(6)),
        centroidLon: Number(cLon.toFixed(6)),
        radiusKm: Number(radiusKm.toFixed(2)),
        pointCount: members.length,
        vehicleCount: uniqueVehicles,
        avgBatteryPct: Number(avgBat.toFixed(1)),
        criticalEvents: criticalCount,
        avgEnergyKwhPerKm: Number(avgEnergy.toFixed(3)),
        avgDelayMinutes: Number(avgDelay.toFixed(1)),
        demandIntensity,
        nearestStationDistanceKm: nearest.distanceKm,
        severityScore: Number(severity.toFixed(1)),
      });
    }
    return { km };
  };

  // 1) Battery discharge risk hotspots
  const riskSubset = rows.filter(
    (r) => r.batteryPercentage < 32 || (r.batteryPercentage < 40 && r.energyConsumptionKwhPerKm > 0.36)
  );
  const riskClusterRes = buildClusterCategory(
    riskSubset.length >= 12 ? riskSubset : rows.slice(0, 200),
    "BATTERY_RISK",
    6,
    101
  );

  // 2) Charging demand clusters (low-to-mid battery + active charging + high delay zones)
  const demandSubset = rows.filter(
    (r) => r.chargingStatus === "CHARGING" || r.batteryPercentage < 44
  );
  buildClusterCategory(
    demandSubset.length >= 12 ? demandSubset : rows.slice(0, 300),
    "HIGH_DEMAND",
    6,
    202
  );

  // 3) Overall EV activity clusters (store cluster_id back on telemetry rows)
  const activityRes = buildClusterCategory(rows, "HIGH_ACTIVITY", 8, 303);
  if (clusterInserts.length > 0) {
    await db.insert(hotspotClusters).values(clusterInserts);
  }

  // Persist cluster labels back to PostgreSQL telemetry table
  if (activityRes.km) {
    const byCluster = new Map<number, number[]>();
    rows.forEach((r, idx) => {
      const cid = activityRes.km!.assignments[idx];
      const list = byCluster.get(cid) ?? [];
      list.push(r.id);
      byCluster.set(cid, list);
    });
    for (const [cid, ids] of byCluster.entries()) {
      for (let i = 0; i < ids.length; i += 600) {
        await db
          .update(telemetry)
          .set({ clusterId: cid, clusterCategory: "HIGH_ACTIVITY" })
          .where(inArray(telemetry.id, ids.slice(i, i + 600)));
      }
    }
  }
  if (riskClusterRes.km && riskSubset.length >= 12) {
    const byRiskCluster = new Map<number, number[]>();
    riskSubset.forEach((r, idx) => {
      const cid = riskClusterRes.km!.assignments[idx];
      const list = byRiskCluster.get(cid) ?? [];
      list.push(r.id);
      byRiskCluster.set(cid, list);
    });
    for (const [cid, ids] of byRiskCluster.entries()) {
      for (let i = 0; i < ids.length; i += 600) {
        await db
          .update(telemetry)
          .set({ clusterId: cid, clusterCategory: "BATTERY_RISK" })
          .where(inArray(telemetry.id, ids.slice(i, i + 600)));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Store latest per-vehicle ML predictions into `ml_predictions`
  // -------------------------------------------------------------------------
  const latestPerVehicle = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    // `rows` is sorted DESC by timestamp so first hit is latest
    if (!latestPerVehicle.has(r.vehicleId)) {
      latestPerVehicle.set(r.vehicleId, r);
    }
  }

  await db.delete(mlPredictions);
  const predictionInserts: Array<typeof mlPredictions.$inferInsert> = [];
  const areaPeakMap = new Map(
    areaDemandBaseline.map((a) => [a.area, a.peakHourDemandKwh])
  );

  for (const r of latestPerVehicle.values()) {
    const predRange = predictRegressor(championRange.model, [
      r.batteryPercentage,
      r.speedKmh,
      r.temperatureC,
      r.vehicleWeightKg,
      r.distanceTravelledKm,
      r.energyConsumptionKwhPerKm,
      TRAFFIC_ENCODED[r.trafficLevel] ?? 1,
    ]);

    const riskPred = predictClassifierProbs(riskModel, [
      r.batteryPercentage,
      r.remainingRangeKm,
      r.speedKmh,
      r.temperatureC,
      TRAFFIC_ENCODED[r.trafficLevel] ?? 1,
      r.nearestStationDistanceKm,
      r.energyConsumptionKwhPerKm,
    ]);

    predictionInserts.push({
      vehicleId: r.vehicleId,
      telemetryId: r.id,
      area: r.area,
      predictedRangeKm: Number(predRange.toFixed(1)),
      actualRangeKm: Number(r.remainingRangeKm.toFixed(1)),
      rangeModelName: championRange.name,
      batteryRisk: riskPred.label,
      riskProbability: riskPred.confidence,
      riskProbabilities: {
        LOW: riskPred.probabilities.LOW ?? 0,
        MEDIUM: riskPred.probabilities.MEDIUM ?? 0,
        HIGH: riskPred.probabilities.HIGH ?? 0,
      },
      predictedChargingDemand: areaPeakMap.get(r.area) ?? 95,
      nearestStationDistanceKm: r.nearestStationDistanceKm,
    });
  }

  if (predictionInserts.length > 0) {
    await db.insert(mlPredictions).values(predictionInserts);
  }

  // -------------------------------------------------------------------------
  // Record all model runs & exact evaluation metrics into `ml_model_runs`
  // -------------------------------------------------------------------------
  await db.delete(mlModelRuns);
  const runRows: Array<typeof mlModelRuns.$inferInsert> = [];

  for (const cand of rangeCandidates) {
    const isBest = cand.name === championRange.name;
    runRows.push({
      modelTask: "range_prediction",
      algorithmName: cand.name,
      isSelected: isBest,
      trainSamples: XRangeTrain.length,
      testSamples: XRangeTest.length,
      metrics: cand.metrics as unknown as Record<string, unknown>,
      artifactPath: isBest ? savedRange.uri : `data/models/${cand.model.type}.json`,
      storageBackend: savedRange.backend,
    });
  }

  runRows.push({
    modelTask: "battery_risk",
    algorithmName: "Random Forest Classifier",
    isSelected: true,
    trainSamples: XRiskTrain.length,
    testSamples: XRiskTest.length,
    metrics: riskMetrics as unknown as Record<string, unknown>,
    artifactPath: savedRisk.uri,
    storageBackend: savedRisk.backend,
  });

  runRows.push({
    modelTask: "charging_demand",
    algorithmName: "XGBoost Regressor",
    isSelected: true,
    trainSamples: XDTrain.length,
    testSamples: XDTest.length,
    metrics: {
      ...demandMetrics,
      areaForecasts: areaDemandBaseline,
    } as unknown as Record<string, unknown>,
    artifactPath: savedDemand.uri,
    storageBackend: savedDemand.backend,
  });

  runRows.push({
    modelTask: "kmeans_hotspots",
    algorithmName: "K-Means++ Spatial Clustering",
    isSelected: true,
    trainSamples: rows.length,
    testSamples: clusterInserts.length,
    metrics: {
      totalClusters: clusterInserts.length,
      batteryRiskClusters: clusterInserts.filter((c) => c.clusterCategory === "BATTERY_RISK").length,
      highDemandClusters: clusterInserts.filter((c) => c.clusterCategory === "HIGH_DEMAND").length,
      highActivityClusters: clusterInserts.filter((c) => c.clusterCategory === "HIGH_ACTIVITY").length,
      activityInertia: activityRes.km?.inertia ?? 0,
    },
    artifactPath: "postgresql://hotspot_clusters",
    storageBackend: savedRange.backend,
  });

  await db.insert(mlModelRuns).values(runRows);

  return {
    rangeModels: rangeCandidates.map((c) => ({
      algorithm: c.name,
      selected: c.name === championRange.name,
      mae: c.metrics.mae,
      rmse: c.metrics.rmse,
      r2: c.metrics.r2,
      cvR2Mean: c.metrics.cvR2Mean ?? c.metrics.r2,
    })),
    selectedRangeModel: championRange.name,
    batteryRiskModel: {
      algorithm: "Random Forest Classifier",
      accuracy: riskMetrics.accuracy,
      precision: riskMetrics.macroPrecision,
      recall: riskMetrics.macroRecall,
      f1: riskMetrics.macroF1,
    },
    chargingDemandModel: {
      algorithm: "XGBoost Regressor",
      mae: demandMetrics.mae,
      rmse: demandMetrics.rmse,
      r2: demandMetrics.r2,
    },
    hotspotsGenerated: clusterInserts.length,
    vehiclePredictionsStored: predictionInserts.length,
    storageBackend: savedRange.backend,
    durationMs: Date.now() - t0,
  };
}

/**
 * Real-time interactive inference using the saved champion ML artifacts.
 */
export async function predictLiveTelemetry(
  input: {
    batteryPercentage: number;
    speedKmh: number;
    temperatureC: number;
    vehicleWeightKg: number;
    distanceTravelledKm: number;
    energyConsumptionKwhPerKm: number;
    trafficLevel: string;
    nearestStationDistanceKm: number;
    area?: string;
    hour?: number;
  },
  _retried = false
): Promise<{
  predictedRangeKm: number;
  rangeModel: string;
  batteryRisk: string;
  riskConfidence: number;
  riskProbabilities: Record<string, number>;
  riskModel: string;
  predictedAreaDemandKwh: number;
  recommendedAction: string;
}> {
  const [rangeRaw, riskRaw, demandRaw] = await Promise.all([
    loadArtifact("models", "best_range_model.json"),
    loadArtifact("models", "battery_risk_model.json"),
    loadArtifact("models", "charging_demand_model.json"),
  ]);

  if (!rangeRaw || !riskRaw) {
    if (_retried) {
      throw new Error("Trained ML model artifacts are temporarily unavailable.");
    }
    await trainAllModelsAndClusters();
    return predictLiveTelemetry(input, true);
  }

  const rangeBundle = JSON.parse(rangeRaw) as {
    algorithmName: string;
    model: SerializedRegressor;
  };
  const riskBundle = JSON.parse(riskRaw) as {
    algorithmName: string;
    model: SerializedRFClassifier;
  };

  const trafficCode = TRAFFIC_ENCODED[input.trafficLevel] ?? 1;
  const predictedRangeKm = Number(
    predictRegressor(rangeBundle.model, [
      input.batteryPercentage,
      input.speedKmh,
      input.temperatureC,
      input.vehicleWeightKg,
      input.distanceTravelledKm,
      input.energyConsumptionKwhPerKm,
      trafficCode,
    ]).toFixed(1)
  );

  const riskResult = predictClassifierProbs(riskBundle.model, [
    input.batteryPercentage,
    predictedRangeKm,
    input.speedKmh,
    input.temperatureC,
    trafficCode,
    input.nearestStationDistanceKm,
    input.energyConsumptionKwhPerKm,
  ]);

  let predictedAreaDemandKwh = 0;
  if (demandRaw) {
    const demandBundle = JSON.parse(demandRaw) as { model: SerializedRegressor };
    const areaCode = AREA_CODE_MAP[input.area ?? "East Austin Logistics"] ?? 2;
    const hr = input.hour ?? 15;
    predictedAreaDemandKwh = Number(
      predictRegressor(demandBundle.model, [
        hr,
        new Date().getUTCDay(),
        areaCode,
        7,
        input.batteryPercentage,
        4.5,
        input.temperatureC,
        trafficCode,
      ]).toFixed(1)
    );
  }

  return {
    predictedRangeKm,
    rangeModel: rangeBundle.algorithmName,
    batteryRisk: riskResult.label,
    riskConfidence: riskResult.confidence,
    riskProbabilities: riskResult.probabilities,
    riskModel: riskBundle.algorithmName,
    predictedAreaDemandKwh,
    recommendedAction:
      riskResult.label === "HIGH"
        ? `Immediate charge dispatch advised — route to nearest station (${input.nearestStationDistanceKm.toFixed(1)} km away) before next stop.`
        : riskResult.label === "MEDIUM"
          ? `Schedule opportunity top-up within next ${Math.max(18, Math.round(predictedRangeKm * 0.45))} km to avoid peak queue delays.`
          : `Healthy range buffer (${predictedRangeKm} km). Continue planned route at optimal cruise efficiency.`,
  };
}

export async function getAreaDemandForecastsFromDb() {
  const runs = await db
    .select()
    .from(mlModelRuns)
    .where(eq(mlModelRuns.modelTask, "charging_demand"))
    .orderBy(desc(mlModelRuns.trainedAt))
    .limit(1);

  if (runs.length === 0) return [];
  const m = runs[0].metrics as {
    areaForecasts?: Array<{
      area: string;
      predictedDailyDemandKwh: number;
      peakHourDemandKwh: number;
      activeVehicles: number;
      avgBatteryPct: number;
      hourly: Array<{ hour: number; predictedDemandKwh: number }>;
    }>;
  };
  return m.areaForecasts ?? [];
}
