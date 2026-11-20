export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface StationGeo extends GeoPoint {
  stationId: string;
  name?: string;
  area?: string;
}

export interface AreaDefinition {
  name: string;
  centerLat: number;
  centerLon: number;
  spreadLat: number;
  spreadLon: number;
  baseTraffic: number; // 0 to 1
  elevationFactor: number; // affects energy use
  freightIntensity: number; // affects average payload & trip count
  corridors: string[];
}

const EARTH_RADIUS_KM = 6371.0088;

// Valid land bounding box for Greater Austin, TX logistics basin
export const VALID_GPS_BOUNDS = {
  minLat: 30.1,
  maxLat: 30.56,
  minLon: -97.95,
  maxLon: -97.52,
};

export const FLEET_AREAS: AreaDefinition[] = [
  {
    name: "Downtown Core",
    centerLat: 30.2685,
    centerLon: -97.7428,
    spreadLat: 0.018,
    spreadLon: 0.02,
    baseTraffic: 0.78,
    elevationFactor: 1.02,
    freightIntensity: 0.85,
    corridors: ["Congress & 6th Freight Zone", "East Cesar Chavez Hub", "Guadalupe Parcel Plaza"],
  },
  {
    name: "North Tech Corridor",
    centerLat: 30.4018,
    centerLon: -97.7245,
    spreadLat: 0.022,
    spreadLon: 0.024,
    baseTraffic: 0.66,
    elevationFactor: 1.01,
    freightIntensity: 0.9,
    corridors: ["Domain Northside Depot", "Burnet & Braker Tech Hub", "Metric Blvd Fulfillment"],
  },
  {
    name: "East Austin Logistics",
    centerLat: 30.2725,
    centerLon: -97.6625,
    spreadLat: 0.022,
    spreadLon: 0.025,
    baseTraffic: 0.72,
    elevationFactor: 1.04,
    freightIntensity: 1.18,
    corridors: ["US-183 & MLK Distribution Plaza", "Springdale Freight Terminal", "Ed Bluestein Cross-Dock"],
  },
  {
    name: "South Congress & St. Elmo",
    centerLat: 30.2165,
    centerLon: -97.7565,
    spreadLat: 0.02,
    spreadLon: 0.022,
    baseTraffic: 0.62,
    elevationFactor: 1.03,
    freightIntensity: 0.82,
    corridors: ["St. Elmo Industrial Yard", "Ben White & S. Congress", "South 1st Last-Mile Hub"],
  },
  {
    name: "Southeast Airport Freight",
    centerLat: 30.2035,
    centerLon: -97.658,
    spreadLat: 0.024,
    spreadLon: 0.026,
    baseTraffic: 0.74,
    elevationFactor: 1.06,
    freightIntensity: 1.28,
    corridors: ["SH-71 Air Cargo Corridor", "Burleson Rd Logistics Park", "Montopolis Freight Gateway"],
  },
  {
    name: "Round Rock North Depot",
    centerLat: 30.4725,
    centerLon: -97.676,
    spreadLat: 0.024,
    spreadLon: 0.026,
    baseTraffic: 0.69,
    elevationFactor: 1.05,
    freightIntensity: 1.22,
    corridors: ["I-35 & Louis Henna Commerce Hub", "La Frontera Fleet Center", "Old Settlers Regional Depot"],
  },
  {
    name: "Sunset Valley & Southwest",
    centerLat: 30.2295,
    centerLon: -97.8195,
    spreadLat: 0.021,
    spreadLon: 0.023,
    baseTraffic: 0.58,
    elevationFactor: 1.09,
    freightIntensity: 0.86,
    corridors: ["US-290 Brodie Plaza", "Mopac Southwest Transit Hub", "William Cannon West Center"],
  },
  {
    name: "Pflugerville Industrial",
    centerLat: 30.4385,
    centerLon: -97.6145,
    spreadLat: 0.023,
    spreadLon: 0.025,
    baseTraffic: 0.67,
    elevationFactor: 1.04,
    freightIntensity: 1.24,
    corridors: ["SH-130 Pecan E-Commerce Park", "Wells Branch East Annex", "meister Ln Heavy EV Yard"],
  },
];

export const INITIAL_CHARGING_STATIONS = [
  {
    stationId: "CS-001",
    name: "Downtown Republic Fast Hub",
    area: "Downtown Core",
    latitude: 30.2662,
    longitude: -97.7468,
    totalPorts: 10,
    availablePorts: 3,
    maxPowerKw: 250,
    connectorType: "CCS / NACS",
    status: "operational",
    operator: "VoltGrid Network",
    avgUtilizationPct: 81.4,
    pricePerKwh: 0.34,
  },
  {
    stationId: "CS-002",
    name: "East 5th Plaza Supercharger",
    area: "Downtown Core",
    latitude: 30.2654,
    longitude: -97.7312,
    totalPorts: 8,
    availablePorts: 4,
    maxPowerKw: 180,
    connectorType: "CCS / NACS",
    status: "operational",
    operator: "VoltGrid Network",
    avgUtilizationPct: 74.2,
    pricePerKwh: 0.33,
  },
  {
    stationId: "CS-003",
    name: "Domain Tech Parkway Hub",
    area: "North Tech Corridor",
    latitude: 30.4024,
    longitude: -97.7262,
    totalPorts: 12,
    availablePorts: 5,
    maxPowerKw: 350,
    connectorType: "CCS / NACS",
    status: "operational",
    operator: "VoltGrid Network",
    avgUtilizationPct: 77.8,
    pricePerKwh: 0.31,
  },
  {
    stationId: "CS-004",
    name: "Research Blvd North Station",
    area: "North Tech Corridor",
    latitude: 30.3865,
    longitude: -97.7398,
    totalPorts: 8,
    availablePorts: 3,
    maxPowerKw: 150,
    connectorType: "CCS",
    status: "operational",
    operator: "ChargeAustin",
    avgUtilizationPct: 68.5,
    pricePerKwh: 0.29,
  },
  {
    stationId: "CS-005",
    name: "St. Elmo Fleet Plaza",
    area: "South Congress & St. Elmo",
    latitude: 30.2198,
    longitude: -97.7582,
    totalPorts: 10,
    availablePorts: 4,
    maxPowerKw: 250,
    connectorType: "CCS / NACS",
    status: "operational",
    operator: "VoltGrid Network",
    avgUtilizationPct: 72.1,
    pricePerKwh: 0.31,
  },
  {
    stationId: "CS-006",
    name: "South Lamar Transit Chargers",
    area: "South Congress & St. Elmo",
    latitude: 30.2392,
    longitude: -97.7724,
    totalPorts: 6,
    availablePorts: 2,
    maxPowerKw: 150,
    connectorType: "CCS",
    status: "operational",
    operator: "ChargeAustin",
    avgUtilizationPct: 64.9,
    pricePerKwh: 0.3,
  },
  {
    stationId: "CS-007",
    name: "Sunset Valley Brodie Station",
    area: "Sunset Valley & Southwest",
    latitude: 30.2312,
    longitude: -97.8165,
    totalPorts: 8,
    availablePorts: 5,
    maxPowerKw: 180,
    connectorType: "CCS / NACS",
    status: "operational",
    operator: "VoltGrid Network",
    avgUtilizationPct: 59.3,
    pricePerKwh: 0.28,
  },
  {
    stationId: "CS-008",
    name: "Mueller Central Charging Plaza",
    area: "East Austin Logistics",
    latitude: 30.2986,
    longitude: -97.7052,
    totalPorts: 6,
    availablePorts: 1,
    maxPowerKw: 150,
    connectorType: "CCS",
    status: "operational",
    operator: "GreenFleet TX",
    avgUtilizationPct: 89.6,
    pricePerKwh: 0.32,
  },
  {
    stationId: "CS-009",
    name: "Parmer Tech Ridge Station",
    area: "North Tech Corridor",
    latitude: 30.4155,
    longitude: -97.6845,
    totalPorts: 6,
    availablePorts: 1,
    maxPowerKw: 150,
    connectorType: "CCS / NACS",
    status: "operational",
    operator: "GreenFleet TX",
    avgUtilizationPct: 86.2,
    pricePerKwh: 0.31,
  },
  {
    stationId: "CS-010",
    name: "Riverside East QuickCharge",
    area: "South Congress & St. Elmo",
    latitude: 30.2385,
    longitude: -97.7165,
    totalPorts: 6,
    availablePorts: 2,
    maxPowerKw: 120,
    connectorType: "CCS",
    status: "operational",
    operator: "ChargeAustin",
    avgUtilizationPct: 83.7,
    pricePerKwh: 0.32,
  },
];

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Computes exact great-circle Haversine distance in kilometers between two GPS coordinates.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * c;
}

/**
 * Finds the closest charging station and distance in km from a GPS coordinate.
 */
export function findNearestStation<T extends StationGeo>(
  lat: number,
  lon: number,
  stations: T[]
): { station: T; distanceKm: number } {
  if (stations.length === 0) {
    throw new Error("At least one charging station is required");
  }
  let best = stations[0];
  let bestDist = haversineDistanceKm(lat, lon, best.latitude, best.longitude);
  for (let i = 1; i < stations.length; i++) {
    const s = stations[i];
    const d = haversineDistanceKm(lat, lon, s.latitude, s.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return { station: best, distanceKm: Number(bestDist.toFixed(3)) };
}

/**
 * Finds the nearest named operational area and corridor label for a coordinate.
 */
export function resolveAreaAndCorridor(
  lat: number,
  lon: number,
  indexHint = 0
): { area: string; corridor: string } {
  let closest = FLEET_AREAS[0];
  let bestDist = Infinity;
  for (const area of FLEET_AREAS) {
    const d = haversineDistanceKm(lat, lon, area.centerLat, area.centerLon);
    if (d < bestDist) {
      bestDist = d;
      closest = area;
    }
  }
  const corridor = closest.corridors[indexHint % closest.corridors.length];
  return {
    area: closest.name,
    corridor: corridor.charAt(0).toUpperCase() + corridor.slice(1),
  };
}

export function isValidGps(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= VALID_GPS_BOUNDS.minLat &&
    lat <= VALID_GPS_BOUNDS.maxLat &&
    lon >= VALID_GPS_BOUNDS.minLon &&
    lon <= VALID_GPS_BOUNDS.maxLon
  );
}
