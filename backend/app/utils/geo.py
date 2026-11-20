from __future__ import annotations

import math
from typing import Dict, Iterable, List, Tuple

try:
    from shapely.geometry import Point, box  # type: ignore

    AUSTIN_BBOX = box(-97.95, 30.10, -97.52, 30.56)
    HAS_SHAPELY = True
except ImportError:
    AUSTIN_BBOX = None
    HAS_SHAPELY = False

EARTH_RADIUS_KM = 6371.0088


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle distance in km between two WGS84 latitude/longitude points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    )
    return EARTH_RADIUS_KM * (2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a))))


def is_valid_austin_coordinate(lat: float, lon: float) -> bool:
    """Validates GPS point against the Greater Austin operational bounding geometry."""
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return False
    if HAS_SHAPELY and AUSTIN_BBOX is not None:
        return bool(AUSTIN_BBOX.covers(Point(lon, lat)))
    return 30.10 <= lat <= 30.56 and -97.95 <= lon <= -97.52


def find_nearest_station(
    lat: float,
    lon: float,
    stations: Iterable[Dict[str, float | str]],
) -> Tuple[Dict[str, float | str], float]:
    station_list: List[Dict[str, float | str]] = list(stations)
    if not station_list:
        raise ValueError("stations must contain at least one entry")
    best = station_list[0]
    best_dist = haversine_distance_km(
        lat, lon, float(best["latitude"]), float(best["longitude"])
    )
    for st in station_list[1:]:
        dist = haversine_distance_km(lat, lon, float(st["latitude"]), float(st["longitude"]))
        if dist < best_dist:
            best_dist = dist
            best = st
    return best, round(best_dist, 3)
