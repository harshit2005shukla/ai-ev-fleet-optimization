# AI-Powered EV Fleet Optimization & Charging Infrastructure Analytics

> **VoltGrid AI** — End-to-end production-style Data Engineering, Machine Learning, Geospatial Analytics, and Combinatorial Optimization platform for commercial electric vehicle (EV) logistics fleets.

---

## 1. Project Overview

Commercial EV delivery fleets face a tightly coupled operational challenge: battery discharge rates fluctuate dynamically with vehicle speed, payload mass, ambient temperature, and urban traffic congestion, while uneven DC fast-charger coverage forces long charging detours that trigger delivery SLA delays.

This system ingests and cleans synthetic EV telemetry data, persists normalized relational records into **PostgreSQL**, trains and compares reproducible **Machine Learning** models for remaining range, battery-risk classification, and area-level charging demand, discovers geospatial hotspots via **K-Means++ clustering**, solves a multi-criteria **Facility Location Optimization** problem to recommend the **Top 3 new charging station sites**, simulates exact **Before vs. After** delivery delay impact, and serves a 6-page executive analytics dashboard.

---

## 2. Problem Statement

Fleet operations leaders need real-time, data-backed answers to eight core questions:

1. **Which EVs are likely to run critically low on battery?**
2. **What is the predicted remaining range (km) of each vehicle?**
3. **Which geographic zones experience the highest battery-discharge risk?**
4. **Which operational areas face the highest charging demand by hour?**
5. **How far is every EV from the nearest existing charging station?**
6. **Where should the company build the next 3 DC fast-charging stations?**
7. **What measurable impact would those 3 stations have on delivery delays and critical battery events?**
8. **How can management monitor the entire EV fleet from a single interactive dashboard?**

---

## 3. Solution & System Architecture

```text
┌───────────────────────────┐
│  Synthetic EV Telemetry   │  scripts/generate_telemetry.py (--records 100000)
│  Generator (Physics-Based)│  & POST /api/data/generate
└─────────────┬─────────────┘
              ▼
┌───────────────────────────┐
│  Validation & Cleaning    │  Missing-value imputation, deduplication, GPS bounds,
│  + Feature Engineering    │  battery/speed checks, outlier capping, Haversine dist
└──────┬──────────────┬─────┘
       ▼              ▼
┌──────────────┐ ┌────────────────────────────────────┐
│  PostgreSQL  │ │  AWS S3 (Optional Cloud Storage)   │
│  9 Indexed   │ │  s3://bucket/{raw,processed,models}│
│  Tables      │ │  (Auto-fallback to local data/)    │
└──────┬───────┘ └──────────────────┬─────────────────┘
       ▼                            ▼
┌─────────────────────────────────────────────────────┐
│  Machine Learning & Optimization Engine             │
│  • Model 1: Range (Linear Reg vs RF vs XGBoost)     │
│  • Model 2: Battery Risk (RF Classifier: L/M/H)     │
│  • Model 3: Charging Demand Forecast (XGBoost)      │
│  • K-Means++ Hotspot Clustering (Risk/Demand/Act.)  │
│  • Top-3 Station Optimizer (OR-Tools / Exact ILP)   │
│  • Before vs. After Delivery Delay Impact Simulator │
└──────────────────────────┬──────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────┐
│  REST Analytics APIs (FastAPI & Next.js Route APIs) │
│  16 Validated Endpoints + Pagination + CORS + Health│
└──────────────────────────┬──────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────┐
│  React + TypeScript + Tailwind + Recharts + Leaflet │
│  6 Interactive Enterprise Analytics Pages           │
└─────────────────────────────────────────────────────┘
```

---

## 4. Key Features

- **Configurable Physics-Coupled Telemetry Generator**: Generates 100,000+ realistic EV telemetry records (`scripts/generate_telemetry.py --records 100000`) modeling quadratic aerodynamic drag with speed, payload rolling resistance, U-shaped cold/heat thermal battery losses, traffic congestion inefficiency, charging detour delays, and realistic raw sensor faults.
- **Automated Data Quality Pipeline**: Normalizes UTC timestamps, removes duplicate packets, filters out-of-bounds GPS pings and invalid speeds, corrects/filters invalid battery values, imputes missing sensor telemetry, and caps consumption outliers.
- **Multi-Model ML Suite (`random_state=42`)**:
  - **Remaining Range Prediction**: Benchmarks Linear Regression, Random Forest Regressor, and XGBoost Regressor using MAE, RMSE, R², and 5-fold cross-validation; auto-selects and persists the champion model.
  - **Battery Risk Classification (`LOW` / `MEDIUM` / `HIGH`)**: Multi-class Random Forest classifier reporting Accuracy, Precision, Recall, F1-score, and 3×3 Confusion Matrix.
  - **Charging Demand Prediction**: Area-by-hour XGBoost regressor forecasting 24-hour energy demand (kWh).
  - **Real-Time What-If Simulator**: Live inference endpoint (`POST /api/ml/predict`) connected to interactive telemetry sliders.
- **K-Means++ Geospatial Hotspot Analysis**: Identifies battery-discharge hotspots, high charging-demand clusters, and high-activity zones, persisting cluster assignments in PostgreSQL.
- **Transparent Charging Station Optimization**: Scores candidate sites across 5 weighted criteria and solves a spatially constrained 3-station Maximal-Covering Facility Location problem (Google OR-Tools CP-SAT in `backend/app/services/optimizer.py` and exact discrete combinatorial solver in `src/lib/optimizer.ts`).
- **Authentic Delivery Delay Impact Simulation**: Re-evaluates every telemetry point comparing `BEFORE` (existing 10 chargers) vs. `AFTER` (existing 10 + Top 3 recommended chargers), reporting exact computed delay reduction %, critical events prevented, and distance saved.
- **6-Page Interactive Dashboard with Light & Dark Mode**: Executive Overview, Fleet Monitoring (with slide-over vehicle inspector, CSV export, and 1-click map jump), AI Predictions, Charging Infrastructure (interactive OpenStreetMap/Leaflet map with automatic Light/Dark CARTO basemap switching), Optimization, and Deep Fleet Analytics — with flicker-free, persisted Light/Dark theme toggling.
- **Cloud & DevOps Ready**: Optional AWS S3 persistence with seamless local fallback, multi-container Docker Compose setup, Pytest test suite, and Render Blueprint (`render.yaml`).

---

## 5. Technology Stack

| Layer | Technologies |
|---|---|
| **Python Backend & Data Eng** | Python 3.11, FastAPI, Uvicorn, Pydantic v2, SQLAlchemy 2.0, Alembic, psycopg2-binary, Pandas, NumPy |
| **Machine Learning** | Scikit-learn (Linear Regression, Random Forest, K-Means), XGBoost, Joblib, 5-Fold Cross-Validation |
| **Geospatial & Optimization** | Haversine Geodesic Distance, Shapely, GeoPandas (optional), Google OR-Tools (CP-SAT), OpenStreetMap |
| **Fullstack Web & Frontend** | React 19, TypeScript, Next.js App Router, Drizzle ORM, Tailwind CSS, Recharts, Leaflet / React-Leaflet, Lucide Icons, Zod |
| **Database & Storage** | PostgreSQL 16, Optional AWS S3 (`boto3` & `@aws-sdk/client-s3`) with Local Storage Fallback |
| **DevOps & Deployment** | Docker, Docker Compose, Pytest, Git/GitHub, Render (`render.yaml`) |

> **Optional Dependencies Note**: `AWS S3` credentials are completely optional (local `data/{raw,processed,models}` storage is used automatically when omitted). In `backend/`, `shapely`/`geopandas` and `ortools` also include graceful pure-Python fallbacks so lightweight environments run reliably.

---

## 6. Dataset Description

Synthetic commercial EV logistics dataset covering **8 Greater Austin, TX operational zones** (`Downtown Core`, `North Tech Corridor`, `East Austin Logistics`, `South Congress & St. Elmo`, `Southeast Airport Freight`, `Round Rock North Depot`, `Sunset Valley & Southwest`, `Pflugerville Industrial`), **4 EV classes** (`Compact Cargo Van`, `Mid-Size Step Van`, `Refrigerated EV Van`, `Heavy Box Truck`), and **10 existing DC fast-charging stations** (`CS-001` through `CS-010`).

Generated fields include: `vehicle_id`, `trip_id`, `timestamp`, `latitude`, `longitude`, `battery_percentage`, `speed_kmh`, `distance_travelled_km`, `remaining_range_km`, `temperature_c`, `vehicle_weight_kg`, `energy_consumption_kwh_per_km`, `traffic_level`, `delivery_status`, `delivery_delay_minutes`, `charging_status`, `charging_station_id`, `nearest_station_id`, `nearest_station_distance_km`, and `area`.

---

## 7. ML Methodology & Verified Model Metrics

All metrics below were **genuinely calculated** on the default reproducible dataset (`seed=42`, 80/20 held-out test split, 5-fold cross-validation):

### Model 1 — Remaining Range Regression (`remaining_range_km`)

| Algorithm | Test MAE (km) ↓ | Test RMSE (km) ↓ | Test R² ↑ | 5-Fold CV R² | Selected |
|---|---:|---:|---:|---:|:---:|
| **XGBoost Regressor** | **5.208** | **7.439** | **0.9839** | **0.9729** | **Champion** |
| Random Forest Regressor | 7.528 | 10.978 | 0.9650 | 0.9555 | — |
| Linear Regression | 8.334 | 11.511 | 0.9615 | 0.9443 | — |

### Model 2 — Battery Risk Classification (`LOW`, `MEDIUM`, `HIGH`)

- **Algorithm**: Multi-Class Random Forest Classifier
- **Accuracy**: `96.14%` | **Macro Precision**: `94.77%` | **Macro Recall**: `94.70%` | **Macro F1**: `94.73%`
- **Held-Out Confusion Matrix** (`[LOW, MEDIUM, HIGH]`): `[[223, 2, 0], [4, 74, 4], [0, 7, 126]]`

### Model 3 — Charging Demand Forecast (`expected_charging_demand`)

- **Algorithm**: XGBoost Regressor (by `hour`, `day_of_week`, `area`, `number_of_active_evs`, `average_battery`, `historical_charging_events`, `temperature_c`, `traffic_level`)
- **Test MAE**: `7.097 kWh` | **Test RMSE**: `10.751 kWh` | **Test R²**: `0.9400`

### Optimization — Verified Before vs. After Delivery Delay Simulation (`seed=42`)

```text
Charging Score = 30% Battery-Risk Demand
               + 25% EV Traffic Density
               + 20% Delivery Delay Severity
               + 15% Distance from Existing Chargers
               + 10% Predicted Charging Demand
```

| Metric | BEFORE (10 Stations) | AFTER (10 + Top 3 Stations) | Calculated Change |
|---|---:|---:|---:|
| Avg Delivery Delay | `10.48 min` | `7.80 min` | **`-25.5%`** |
| Critical Battery Events | `974` | `762` | **`-21.8%`** (`212` prevented) |
| Avg Distance to Charger | `4.30 km` | `2.51 km` | **`-41.7%`** |
| Fleet within 3.5 km of Charger | `43.0%` | `77.0%` | **`+34.0 pts`** |

---

## 8. Database Schema (PostgreSQL)

Nine normalized tables with primary keys, cascading foreign keys, UTC timestamps, and B-tree indexes on `vehicle_id`, `timestamp`, `latitude`, `longitude`, `battery_percentage`, and `area`:

1. `vehicles` — Fleet asset registry, EV class, pack capacity (kWh), max payload, home depot, status.
2. `charging_stations` — Existing DC fast-charging hubs, GPS coordinates, port count, max kW, utilization %.
3. `trips` — Origin/destination routes, start/end timestamps, distance, battery consumed, cargo weight, delay.
4. `telemetry` — High-frequency time-series GPS, SoC %, speed, range, temperature, weight, kWh/km, traffic, delay, nearest charger Haversine distance, K-Means `cluster_id`.
5. `charging_events` — Historical charging sessions, delivered kWh, session duration, queue wait minutes.
6. `ml_predictions` — Latest per-vehicle predicted range, battery-risk class & class probabilities, area demand.
7. `charging_recommendations` — Ranked candidate & Top 3 optimal charging station locations, sub-scores, coverage, delay reduction, rationale.
8. `hotspot_clusters` — Persisted K-Means++ centroids, radii (km), severity scores, and affected EV counts.
9. `ml_model_runs` — Audit log of trained model runs, split counts, evaluation metrics, confusion matrices, and local/S3 artifact URIs.

---

## 9. REST API Documentation

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service liveness, PostgreSQL connectivity, row counts, and S3/local storage mode |
| `GET` | `/api/vehicles` | Paginated fleet list with filters (`risk`, `area`, `vehicle_type`, `time_range`, `search`, `page`, `limit`) |
| `GET` | `/api/vehicles/{vehicle_id}` | Single-vehicle profile, nearest charger, ML probabilities, telemetry trace & recent trips |
| `GET` | `/api/telemetry` | Paginated cleaned telemetry stream (`vehicle_id`, `area`, `traffic_level`, `min_battery`, `max_battery`) |
| `GET` | `/api/fleet/summary` | Executive KPIs, battery distribution, 7-day trends, and priority critical EV watchlist |
| `GET` | `/api/fleet/battery-risk` | Risk classifier metrics (Precision, Recall, F1, Confusion Matrix) & fleet risk predictions |
| `GET` | `/api/fleet/range-predictions` | Range model benchmark (Linear vs. RF vs. XGBoost: MAE, RMSE, R², CV) & vehicle predictions |
| `GET` | `/api/charging-stations` | Existing stations with 7-day session energy, utilization, wait times & live fleet pins |
| `GET` | `/api/charging-demand` | Charging demand model metrics, 24-hour curve & area demand forecast |
| `GET` | `/api/hotspots` | K-Means++ clusters (`BATTERY_RISK`, `HIGH_DEMAND`, `HIGH_ACTIVITY`) |
| `GET` | `/api/recommendations` | All ranked candidate charging station locations + transparent scoring methodology |
| `GET` | `/api/recommendations/top3` | Top 3 optimal new charging locations with impact metrics & rationale |
| `GET` | `/api/delivery-impact` | Simulated BEFORE vs. AFTER delivery delay, critical events & charger distance impact |
| `GET` | `/api/analytics` | Deep fleet correlations (area, battery, temp vs. range, speed vs. kWh/km, traffic vs. delay, hourly demand, class efficiency) |
| `POST` | `/api/ml/train` | Retrains all ML models, updates K-Means clusters, and recomputes Top 3 recommendations |
| `POST` | `/api/ml/predict` | Real-time range, battery-risk & dispatch prediction for custom telemetry parameters |
| `POST` | `/api/data/generate` | Runs configurable synthetic generation → validation → cleaning → PostgreSQL/S3 → ML pipeline |

---

## 10. Local Development Setup

### Prerequisites
- Node.js 20+ & npm
- Python 3.11+
- PostgreSQL 15+

### Environment Configuration
```bash
cp .env.example .env
# Edit DATABASE_URL in .env to point to your PostgreSQL instance
```

### Generate 100,000 Synthetic Telemetry Records
```bash
python3 scripts/generate_telemetry.py --records 100000
```

### Option A (Primary & Recommended) — Fullstack Next.js Dashboard + APIs + ML Engine (Port 3000)
Everything runs inside a single command — PostgreSQL schema creation, 4,800+ cleaned synthetic EV telemetry records, Linear Regression / Random Forest / XGBoost training, K-Means++ hotspot clustering, Top-3 charging station optimization, all 16 REST API endpoints, and the 6-page Light/Dark dashboard:

```bash
cp .env.example .env
# Ensure PostgreSQL has a database named `app_db` (createdb app_db)
npm install
npx drizzle-kit push
npm run dev
# Open http://localhost:3000 — auto-seeds DB & trains all ML models on first load!
```

For production build & start:
```bash
npm run build
npm run start
# Open http://localhost:3000 (Health check: http://localhost:3000/api/health)
```

### Option B — Python 3.11 FastAPI + ML + OR-Tools Service (Port 8000)
```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python -m scripts.seed_database
python -m ml.train_range_model
python -m ml.train_risk_model
python -m ml.train_demand_model
python -m scripts.train_all

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# Interactive Swagger docs: http://localhost:8000/docs
```

### Run Automated Tests (Pytest)
```bash
cd backend
pytest -v
```

---

## 11. Docker Setup

Start Option A (PostgreSQL 16 + Fullstack Next.js App, APIs & ML Engine) with a single command:

```bash
cp .env.example .env
docker compose up --build
```

- **Dashboard UI & REST APIs (Option A)**: `http://localhost:3000`
- **Health Check**: `http://localhost:3000/api/health`
- **PostgreSQL**: `localhost:5432` (`app_db`)
- **Optional Python FastAPI Service**: `docker compose --profile fastapi up --build` (`http://localhost:8000/docs`)

---

## 12. Optional AWS S3 Setup

When AWS environment variables are set, raw telemetry (`s3://<bucket>/raw/`), cleaned datasets (`s3://<bucket>/processed/`), and serialized ML models (`s3://<bucket>/models/`) are synced automatically. When omitted, local `data/` directories are used seamlessly.

1. Create a private S3 bucket (e.g., `ev-fleet-telemetry-prod`) in `us-east-1`.
2. Create an IAM policy scoped strictly to `s3:GetObject`, `s3:PutObject`, and `s3:ListBucket` on that bucket.
3. Add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and `S3_BUCKET_NAME` to `.env` or Render Environment Variables (never commit credentials to Git).

---

## 13. Render Deployment Guide

A ready-to-deploy Render Blueprint is included in `render.yaml`:

1. **Push to GitHub**: Push the repository (ensuring `.env` is excluded by `.gitignore`).
2. **Create Render PostgreSQL**: Provision `ev-fleet-postgres` (Free or Starter) and copy the Internal/External `DATABASE_URL` (`postgres://` URLs are automatically normalized to `postgresql://` with SSL enabled).
3. **Deploy FastAPI Web Service**: Root directory `backend`, Build Command `pip install --upgrade pip && pip install -r requirements.txt`, Start Command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, Health Check Path `/api/health`.
4. **Deploy Dashboard Service**: Build Command `npm ci && npm run build`, Start Command `npx next start -H 0.0.0.0 -p $PORT`, Health Check Path `/api/health`.
5. **Configure Environment Variables**: Set `DATABASE_URL`, `CORS_ORIGINS` (your Render frontend HTTPS URL), `MODEL_PATH=/tmp/ev_models`, and optional `AWS_*` / `S3_BUCKET_NAME` variables.
6. **Automatic Restart Resilience**: On startup, database tables, telemetry data, and ML models initialize automatically from PostgreSQL/S3 so ephemeral Render container restarts never lose persistent data.

---

## 14. Environment Variables

| Variable | Required | Description |
|---|:---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection URL |
| `CORS_ORIGINS` | No | Comma-separated allowed frontend origins (defaults to `*` in dev) |
| `MODEL_PATH` | No | Local path for serialized model artifacts (`data/models` or `ml/models`) |
| `AWS_ACCESS_KEY_ID` | No | Optional IAM access key for S3 persistence |
| `AWS_SECRET_ACCESS_KEY` | No | Optional IAM secret key for S3 persistence |
| `AWS_REGION` | No | AWS region (default `us-east-1`) |
| `S3_BUCKET_NAME` | No | Target S3 bucket for `raw/`, `processed/`, and `models/` |

---

## 15. Screenshots

- `docs/screenshots/01-executive-overview.png` — *Executive Overview KPIs & 7-Day Fleet Trends*
- `docs/screenshots/02-fleet-monitoring.png` — *Live Fleet Monitoring & Vehicle Telemetry Slide-Over Inspector*
- `docs/screenshots/03-ai-predictions.png` — *ML Model Benchmark, Confusion Matrix & Real-Time Simulator*
- `docs/screenshots/04-charging-infrastructure-map.png` — *OpenStreetMap Stations, Hotspots & Top-3 AI Locations*
- `docs/screenshots/05-station-optimization.png` — *Top-3 Site Cards & Before/After Delivery Delay Simulation*
- `docs/screenshots/06-deep-analytics.png` — *Thermal, Aerodynamic, Traffic & Efficiency Correlations*

---

## 16. Future Improvements

- Streaming MQTT / Apache Kafka telemetry ingestion for sub-second vehicle updates.
- PostGIS spatial R-tree indexing (`GEOGRAPHY(Point, 4326)`) and OSRM road-network drive-time routing.
- Dynamic utility time-of-use (TOU) tariff optimization and V2G smart-charging schedule solvers.
- Battery State-of-Health (SoH) cycle degradation survival modeling.

---

## 17. Author

Built as an end-to-end **Data Engineering, Machine Learning, Geospatial Optimization, and Cloud/DevOps** portfolio system.
