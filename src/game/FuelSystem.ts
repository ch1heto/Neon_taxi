import type { PlayerSaveData, FuelStation } from '../types/game';
import type { CityMap } from './CityMap';
import { closestPointOnSegment, pointInRotatedRect } from './geometry';

export const FUEL_CAPACITY = 100;
export const FULL_TANK_RANGE_WORLD_UNITS = 800_000;
export const FUEL_PER_WORLD_UNIT = FUEL_CAPACITY / FULL_TANK_RANGE_WORLD_UNITS;
export const FULL_TANK_PRICE = 70;
export const FUEL_FULL_PERFORMANCE_THRESHOLD = 60;
export const EMPTY_TANK_SPEED_MULTIPLIER = 0.25;
export const MIN_FUEL_MOVEMENT_DISTANCE = 0.05;
export const MAX_FUEL_MOVEMENT_DISTANCE = 120;
export const REFUEL_MAX_SPEED = 15;

export function clampFuel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return FUEL_CAPACITY;
  return Math.max(0, Math.min(FUEL_CAPACITY, value));
}

export function fuelSpeedMultiplier(fuel: number): number {
  const normalized = clampFuel(fuel);
  if (normalized >= FUEL_FULL_PERFORMANCE_THRESHOLD) return 1;
  return EMPTY_TANK_SPEED_MULTIPLIER +
    (1 - EMPTY_TANK_SPEED_MULTIPLIER) * (normalized / FUEL_FULL_PERFORMANCE_THRESHOLD);
}

export function consumeFuelForDistance(fuel: number, distanceMoved: number): number {
  const current = clampFuel(fuel);
  if (!Number.isFinite(distanceMoved) || distanceMoved < MIN_FUEL_MOVEMENT_DISTANCE ||
      distanceMoved > MAX_FUEL_MOVEMENT_DISTANCE) return current;
  return Math.max(0, current - distanceMoved * FUEL_PER_WORLD_UNIT);
}

export function consumeFuelForMovement(
  fuel: number,
  previous: { x: number; y: number },
  current: { x: number; y: number },
  enabled: boolean,
): number {
  if (!enabled) return clampFuel(fuel);
  return consumeFuelForDistance(fuel, Math.hypot(current.x - previous.x, current.y - previous.y));
}

export function refuelPrice(fuel: number): number {
  const missing = FUEL_CAPACITY - clampFuel(fuel);
  return missing <= 1e-6 ? 0 : Math.ceil(FULL_TANK_PRICE * missing / FUEL_CAPACITY);
}

export type RefuelResult =
  | { status: 'success'; cost: number; saveData: PlayerSaveData }
  | { status: 'full'; cost: 0 }
  | { status: 'insufficientFunds'; cost: number };

export function createRefuelPurchase(saveData: PlayerSaveData): RefuelResult {
  const cost = refuelPrice(saveData.fuel);
  if (cost === 0) return { status: 'full', cost: 0 };
  if (saveData.coins < cost) return { status: 'insufficientFunds', cost };
  return {
    status: 'success',
    cost,
    saveData: {
      ...saveData,
      coins: saveData.coins - cost,
      fuel: FUEL_CAPACITY,
      stats: { ...saveData.stats },
      unlockedSkinIds: [...saveData.unlockedSkinIds],
      settings: { ...saveData.settings },
    },
  };
}

export function stationContainsPoint(station: FuelStation, x: number, y: number): boolean {
  return pointInRotatedRect({ x, y }, station.serviceZone);
}

export function stationAccessPoint(map: CityMap, station: FuelStation) {
  const road = map.roadSegments.find(candidate => candidate.id === station.accessRoadSegmentId);
  if (!road) return { x: station.x, y: station.y };
  const projection = closestPointOnSegment(
    station,
    { x: road.x1, y: road.y1 },
    { x: road.x2, y: road.y2 },
  );
  return { x: projection.x, y: projection.y };
}

export interface FuelStationCoverage {
  maxRouteDistance: number;
  worstPointId: string;
  minStationRouteDistance: number;
  nearestByPoint: Array<{ pointId: string; stationId: string; routeDistance: number }>;
}

export function analyzeFuelStationCoverage(map: CityMap): FuelStationCoverage {
  const nearestByPoint = map.parkingZones.map(zone => {
    const zoneRoad = map.roadSegments.find(candidate => candidate.id === zone.accessRoadSegmentId);
    const start = zoneRoad
      ? closestPointOnSegment(zone, { x: zoneRoad.x1, y: zoneRoad.y1 }, { x: zoneRoad.x2, y: zoneRoad.y2 })
      : zone;
    let stationId = '';
    let routeDistance = Infinity;
    for (const station of map.fuelStations) {
      const access = stationAccessPoint(map, station);
      const distance = Math.min(
        map.findGpsRoute(start.x, start.y, access.x, access.y, zone.angle).cost,
        map.findGpsRoute(start.x, start.y, access.x, access.y, zone.angle + Math.PI).cost,
      );
      if (distance < routeDistance) {
        routeDistance = distance;
        stationId = station.id;
      }
    }
    return { pointId: zone.id, stationId, routeDistance };
  });
  const worst = nearestByPoint.reduce((current, candidate) =>
    candidate.routeDistance > current.routeDistance ? candidate : current,
    nearestByPoint[0] ?? { pointId: '', stationId: '', routeDistance: Infinity });

  let minStationRouteDistance = Infinity;
  for (let first = 0; first < map.fuelStations.length; first++) {
    for (let second = first + 1; second < map.fuelStations.length; second++) {
      const from = map.fuelStations[first];
      const to = map.fuelStations[second];
      const fromAccess = stationAccessPoint(map, from);
      const toAccess = stationAccessPoint(map, to);
      const forward = Math.min(
        map.findGpsRoute(fromAccess.x, fromAccess.y, toAccess.x, toAccess.y, from.angle).cost,
        map.findGpsRoute(fromAccess.x, fromAccess.y, toAccess.x, toAccess.y, from.angle + Math.PI).cost,
      );
      const reverse = Math.min(
        map.findGpsRoute(toAccess.x, toAccess.y, fromAccess.x, fromAccess.y, to.angle).cost,
        map.findGpsRoute(toAccess.x, toAccess.y, fromAccess.x, fromAccess.y, to.angle + Math.PI).cost,
      );
      minStationRouteDistance = Math.min(minStationRouteDistance, forward, reverse);
    }
  }
  return {
    maxRouteDistance: worst.routeDistance,
    worstPointId: worst.pointId,
    minStationRouteDistance,
    nearestByPoint,
  };
}
