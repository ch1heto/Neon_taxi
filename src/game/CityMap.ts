import {
  Building,
  District,
  ParkingZone,
  StreetLight,
  TrafficLight,
  TrafficCar,
  FuelStation,
} from '../types/game';
import { AudioEngine } from './AudioEngine';
import {
  circleVsAxisAlignedRect,
  circleVsCircle,
  catmullRomClosed,
  closestPointOnSegment,
  closestPointOnPolygon,
  hashNoise,
  normalizeAngle,
  pointInRoadCorridor,
  pointInPolygon,
  pointInRotatedEllipse,
  pointInRotatedRect,
  segmentIntersection,
  vehicleCollisionCircles,
  vehicleFootprintSamples,
  type CollisionCircle,
  type Contact,
  type Point,
} from './geometry';
import {
  getTrafficVehicleProfile,
  renderTrafficVehicle,
  TRAFFIC_COLOR_PALETTE,
  TRAFFIC_VEHICLE_SPAWN_POOL,
} from './TrafficVehicles';

export const DEBUG_PHYSICS = false;
export const CITY_GEOMETRY_SCALE = 1.35;
const BASE_WORLD_SIZE = 6400;
const BASE_AIRPORT_ISLAND = { x: 5400, y: 4900, radiusX: 780, radiusY: 680, angle: -0.4 };
const MAINLAND_CONTROL_POINTS: Point[] = [
  { x: 2450, y: 430 }, { x: 3650, y: 520 }, { x: 4850, y: 690 },
  { x: 5700, y: 1500 }, { x: 5820, y: 2700 }, { x: 5680, y: 3900 },
  { x: 4720, y: 4540 }, { x: 4210, y: 5630 }, { x: 3300, y: 6210 },
  { x: 2200, y: 6100 }, { x: 1120, y: 5310 }, { x: 430, y: 4310 },
  { x: 350, y: 3080 }, { x: 760, y: 2190 }, { x: 1480, y: 1270 },
];
const BASE_MAINLAND_POLYGON = catmullRomClosed(MAINLAND_CONTROL_POINTS, 10);
const EXPANDED_MAINLAND_POLYGON = BASE_MAINLAND_POLYGON.map(point => ({
  x: point.x * CITY_GEOMETRY_SCALE,
  y: point.y * CITY_GEOMETRY_SCALE,
}));
const EXPANDED_AIRPORT_ISLAND = {
  x: BASE_AIRPORT_ISLAND.x * CITY_GEOMETRY_SCALE,
  y: BASE_AIRPORT_ISLAND.y * CITY_GEOMETRY_SCALE,
  radiusX: BASE_AIRPORT_ISLAND.radiusX * 1.16,
  radiusY: BASE_AIRPORT_ISLAND.radiusY * 1.16,
  angle: BASE_AIRPORT_ISLAND.angle,
};

export interface RoadNode {
  id: number;
  x: number;
  y: number;
  district: string;
  neighbors: number[];
  junctionId: string | null;
}

export interface RoadSegment {
  id: string;
  fromNodeId: number;
  toNodeId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  isHighway?: boolean;
  kind: 'highway' | 'street' | 'alley';
}

export interface Roundabout {
  x: number;
  y: number;
  radius: number;
  width: number;
}

interface NavigationEdge {
  id: string;
  roadId: string;
  fromNodeId: number;
  toNodeId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

export interface Lane {
  id: string;
  edgeId: string;
  roadId: string;
  direction: 'forward' | 'reverse';
  fromNodeId: number;
  toNodeId: number;
  start: Point;
  end: Point;
  angle: number;
  length: number;
  width: number;
  offset: number;
  fromJunctionId: string | null;
  toJunctionId: string | null;
}

export interface Junction {
  id: string;
  nodeId: number;
  x: number;
  y: number;
  kind: 'intersection' | 'turn' | 'roundabout';
}

export interface CircularLane {
  id: string;
  junctionId: string;
  direction: 'clockwise' | 'counterclockwise';
  center: Point;
  radius: number;
  width: number;
}

export interface LaneTransition {
  id: string;
  fromLaneId: string;
  toLaneId: string;
  junctionId: string | null;
  kind: 'straight' | 'left' | 'right' | 'roundabout';
  points: Point[];
  length: number;
  startTangent: number;
  endTangent: number;
  sweep: number;
  conflictZoneId: string | null;
  circularLaneId: string | null;
  conflictingTransitionIds: string[];
  maxCurvature: number;
}

export interface TransitionReservation {
  ownerId: string;
  transitionId: string;
  expiresAt: number;
}

export interface GpsRoute {
  points: Point[];
  laneIds: string[];
  transitionIds: string[];
  cost: number;
  startLaneId: string;
  startLaneAngle: number;
}

interface GpsRouteProjection {
  point: Point;
  segmentIndex: number;
  distance: number;
  progress: number;
}

function stableStringNoise(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

export interface ParkingValidationResult {
  zoneId: string;
  valid: boolean;
  errors: string[];
}

export interface FuelStationValidationResult {
  stationId: string;
  valid: boolean;
  errors: string[];
}

interface OrientedRect extends Point {
  width: number;
  height: number;
  angle: number;
}

export class CityMap {
  public readonly width = BASE_WORLD_SIZE * CITY_GEOMETRY_SCALE;
  public readonly height = BASE_WORLD_SIZE * CITY_GEOMETRY_SCALE;

  // Районы киберпанк-мегаполиса
  public readonly districts: District[] = [
    {
      id: 'downtown',
      name: 'DOWNTOWN',
      label: 'Деловой Центр / Небоскребы',
      icon: '🏙️',
      color: '#06b6d4',
      centerX: 3200,
      centerY: 3200,
      radius: 1000,
    },
    {
      id: 'hills',
      name: 'HILLS',
      label: 'Северные Холмы / Виллы',
      icon: '🏠',
      color: '#22c55e',
      centerX: 2500,
      centerY: 1600,
      radius: 950,
    },
    {
      id: 'westside',
      name: 'WESTSIDE',
      label: 'Западный Квартал / ТЦ',
      icon: '🛒',
      color: '#f43f5e',
      centerX: 1650,
      centerY: 3300,
      radius: 900,
    },
    {
      id: 'industrial',
      name: 'INDUSTRIAL',
      label: 'Промзона / Кибер-Заводы',
      icon: '🏭',
      color: '#a855f7',
      centerX: 4650,
      centerY: 2100,
      radius: 1000,
    },
    {
      id: 'beach',
      name: 'BEACH',
      label: 'Курортное Побережье',
      icon: '🌴',
      color: '#f59e0b',
      centerX: 4900,
      centerY: 3550,
      radius: 850,
    },
    {
      id: 'port',
      name: 'PORT',
      label: 'Морской Порт / Доки',
      icon: '⚓',
      color: '#38bdf8',
      centerX: 3250,
      centerY: 5100,
      radius: 950,
    },
    {
      id: 'airport',
      name: 'AIRPORT',
      label: 'Островной Аэропорт',
      icon: '✈️',
      color: '#ef4444',
      centerX: 5400,
      centerY: 4900,
      radius: 850,
    },
  ];

  public buildings: Building[] = [];
  public roadSegments: RoadSegment[] = [];
  public roundabouts: Roundabout[] = [];
  public roadNodes: RoadNode[] = [];
  public junctions: Junction[] = [];
  public lanes: Lane[] = [];
  public circularLanes: CircularLane[] = [];
  public laneTransitions: LaneTransition[] = [];
  public parkingZones: ParkingZone[] = [];
  public fuelStations: FuelStation[] = [];
  public streetLights: StreetLight[] = [];
  public trafficLights: TrafficLight[] = [];

  // Наземные автомобили дорожного трафика
  public trafficCars: TrafficCar[] = [];
  private animTimer = 0;
  private navigationEdges: NavigationEdge[] = [];
  private laneById = new Map<string, Lane>();
  private outgoingLanes = new Map<number, string[]>();
  private transitionByPair = new Map<string, LaneTransition>();
  private outgoingTransitions = new Map<string, LaneTransition[]>();
  private transitionConflicts = new Map<string, Set<string>>();
  private transitionReservations = new Map<string, TransitionReservation>();
  private gpsCache: { targetX: number; targetY: number; route: GpsRoute; progress: number } | null = null;
  private readonly parkingCurbGap = 12;
  private geometryExpanded = false;

  constructor() {
    this.generateWorld();
    this.initTraffic();
  }

  private generateWorld() {
    // 1. Построение широкой и плавной сети дорог
    this.createRoadNetwork();

    // 2. Создание парковочных зон [P] у обочин
    this.createParkingZones();

    // 3. Создание зданий с безопасным отступом от расширенных трасс
    this.createBuildings();

    // Раздвигаем крупные узлы, сохраняя исходные размеры зданий и машин.
    this.expandWorldGeometry();

    // Финальная раскладка парковок считается от новых дорожных кромок.
    this.createParkingZones();

    // Четыре отдельные roadside service bay, не занимающие traffic lanes и пассажирские парковки.
    this.createFuelStations();

    // 4. Уличная инфраструктура (фонари, светофоры)
    this.createStreetInfrastructure();

    // 5. Построение графа узлов для GPS и трафика
    this.buildRoadGraph();

    const invalidParking = this.validateParkingZones().filter(result => !result.valid);
    if (invalidParking.length > 0) {
      throw new Error(`Invalid parking geometry: ${invalidParking.map(result =>
        `${result.zoneId} (${result.errors.join(', ')})`).join('; ')}`);
    }
    const invalidFuelStations = this.validateFuelStations().filter(result => !result.valid);
    if (invalidFuelStations.length > 0) {
      throw new Error(`Invalid fuel station geometry: ${invalidFuelStations.map(result =>
        `${result.stationId} (${result.errors.join(', ')})`).join('; ')}`);
    }
  }

  private expandWorldGeometry() {
    const expand = (point: Point) => ({
      x: point.x * CITY_GEOMETRY_SCALE,
      y: point.y * CITY_GEOMETRY_SCALE,
    });
    for (const road of this.roadSegments) {
      const start = expand({ x: road.x1, y: road.y1 });
      const end = expand({ x: road.x2, y: road.y2 });
      road.x1 = start.x;
      road.y1 = start.y;
      road.x2 = end.x;
      road.y2 = end.y;
    }
    for (const roundabout of this.roundabouts) {
      const center = expand(roundabout);
      roundabout.x = center.x;
      roundabout.y = center.y;
      roundabout.radius *= 1.12;
      roundabout.width *= 1.15;
    }
    for (const district of this.districts) {
      district.centerX *= CITY_GEOMETRY_SCALE;
      district.centerY *= CITY_GEOMETRY_SCALE;
      district.radius *= 1.12;
    }
    const expandedLandContains = (point: Point) =>
      pointInPolygon(point, EXPANDED_MAINLAND_POLYGON) ||
      pointInRotatedEllipse(point, EXPANDED_AIRPORT_ISLAND);
    for (const building of this.buildings) {
      const center = expand({
        x: building.x + building.width / 2,
        y: building.y + building.height / 2,
      });
      building.x = center.x - building.width / 2;
      building.y = center.y - building.height / 2;
      if (building.id.startsWith('b_row_')) {
        const nearestStreet = this.roadSegments
          .filter(road => road.kind === 'street')
          .map(road => ({ road, projection: closestPointOnSegment(center,
            { x: road.x1, y: road.y1 }, { x: road.x2, y: road.y2 }) }))
          .sort((a, b) => a.projection.distance - b.projection.distance)[0];
        if (nearestStreet) {
          const { road, projection } = nearestStreet;
          const horizontal = Math.abs(road.x2 - road.x1) >= Math.abs(road.y2 - road.y1);
          if (horizontal) {
            const side = Math.sign(center.y - projection.y) || 1;
            building.y = projection.y + side * (road.width / 2 + 12 + building.height / 2) - building.height / 2;
          } else {
            const side = Math.sign(center.x - projection.x) || 1;
            building.x = projection.x + side * (road.width / 2 + 12 + building.width / 2) - building.width / 2;
          }
        }
      }
      const corners = () => [
        { x: building.x, y: building.y },
        { x: building.x + building.width, y: building.y },
        { x: building.x, y: building.y + building.height },
        { x: building.x + building.width, y: building.y + building.height },
      ];
      const district = this.districts.find(candidate =>
        candidate.id.toLowerCase() === building.district?.toLowerCase() ||
        candidate.name.toLowerCase() === building.district?.toLowerCase());
      const target = district ?? { centerX: this.width / 2, centerY: this.height / 2 };
      for (let step = 0; step < 80 && corners().some(point => !expandedLandContains(point)); step++) {
        const dx = target.centerX - (building.x + building.width / 2);
        const dy = target.centerY - (building.y + building.height / 2);
        const distance = Math.max(1, Math.hypot(dx, dy));
        building.x += dx / distance * 6;
        building.y += dy / distance * 6;
      }
    }
    this.geometryExpanded = true;
  }

  private getMainlandPolygon() {
    return this.geometryExpanded ? EXPANDED_MAINLAND_POLYGON : BASE_MAINLAND_POLYGON;
  }

  private getAirportIsland() {
    return this.geometryExpanded ? EXPANDED_AIRPORT_ISLAND : BASE_AIRPORT_ISLAND;
  }

  /**
   * 1. Просторная дорожная сеть
   * Магистрали: 304px, улицы: 204px, переулки: 72px.
   */
  private createRoadNetwork() {
    this.roadSegments = [];
    this.roundabouts = [];

    const hwW = 304;
    const streetW = 204;

    const addSeg = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      width: number,
      isHighway = false,
      kind: RoadSegment['kind'] = isHighway ? 'highway' : 'street',
    ) => {
      const coordinateKey = [x1, y1, x2, y2].map(value => String(value).replace('.', '_')).join('_');
      this.roadSegments.push({
        id: `${kind === 'alley' ? 'alley' : 'road'}_${coordinateKey}`,
        fromNodeId: -1,
        toNodeId: -1,
        x1,
        y1,
        x2,
        y2,
        width,
        isHighway,
        kind,
      });
    };

    // --- 1. Сетка Downtown (просторные магистрали с шагом 700px) ---
    // Вертикальные проспекты
    addSeg(2500, 2100, 2500, 4300, streetW);
    addSeg(3200, 1900, 3200, 4500, streetW);
    addSeg(3900, 2100, 3900, 4300, streetW);

    // Горизонтальные проспекты
    addSeg(2100, 2500, 4300, 2500, streetW);
    addSeg(1900, 3200, 4500, 3200, streetW);
    addSeg(2100, 3900, 4300, 3900, streetW);

    // Центральная кольцевая площадь Downtown
    this.roundabouts.push({ x: 3200, y: 3200, radius: 132, width: 108 });

    // --- 2. Скоростная кольцевая магистраль (Grand Ring Highway) ---
    const ringCoords = [
      { x: 2100, y: 2100 },
      { x: 3200, y: 1900 },
      { x: 4300, y: 2100 },
      { x: 4500, y: 3200 },
      { x: 4300, y: 4300 },
      { x: 3200, y: 4500 },
      { x: 2100, y: 4300 },
      { x: 1900, y: 3200 },
    ];

    for (let i = 0; i < ringCoords.length; i++) {
      const next = ringCoords[(i + 1) % ringCoords.length];
      addSeg(ringCoords[i].x, ringCoords[i].y, next.x, next.y, hwW, true);
    }

    // Круговые развязки на 4 выездах кольцевой
    this.roundabouts.push({ x: 3200, y: 1900, radius: 112, width: 96 }); // Северная
    this.roundabouts.push({ x: 4500, y: 3200, radius: 112, width: 96 }); // Восточная
    this.roundabouts.push({ x: 3200, y: 4500, radius: 112, width: 96 }); // Южная
    this.roundabouts.push({ x: 1900, y: 3200, radius: 112, width: 96 }); // Западная

    // --- 3. Северная трасса в Hills (Северные Холмы) ---
    addSeg(3200, 1900, 2500, 1050, streetW);
    addSeg(2500, 1050, 1750, 1500, streetW);
    addSeg(1750, 1500, 1900, 3200, streetW); // замкнуто с западным кольцом!
    this.roundabouts.push({ x: 2500, y: 1050, radius: 112, width: 96 });

    // --- 4. Северо-восточная скоростная трасса в Industrial (Промзона) ---
    addSeg(3200, 1900, 4700, 1150, hwW, true);
    addSeg(4700, 1150, 5350, 2050, streetW);
    addSeg(5350, 2050, 4500, 3200, streetW); // замкнуто с восточным кольцом!
    this.roundabouts.push({ x: 4700, y: 1150, radius: 115, width: 100 });

    // --- 5. Западный бульвар в Westside (ТЦ и моллы) ---
    addSeg(1900, 3200, 950, 3200, streetW);
    addSeg(950, 3200, 1250, 4300, streetW);
    addSeg(1250, 4300, 2100, 4300, streetW); // замкнуто с юго-западным узлом!
    this.roundabouts.push({ x: 950, y: 3200, radius: 112, width: 96 });

    // --- 6. Прибрежный бульвар в Beach (Пляжи и курорты) ---
    addSeg(4500, 3200, 5350, 3500, streetW);
    addSeg(5350, 3500, 4750, 4400, streetW);
    addSeg(4750, 4400, 3200, 4500, streetW); // замкнуто с южным кольцом!
    this.roundabouts.push({ x: 5350, y: 3500, radius: 110, width: 94 });

    // --- 7. Южная магистраль в Port (Морской порт) ---
    addSeg(3200, 4500, 3200, 5650, hwW, true);
    addSeg(2350, 5250, 4050, 5250, streetW);
    addSeg(2350, 5250, 2100, 4300, streetW); // замкнуто с юго-западом!
    addSeg(4050, 5250, 4750, 4400, streetW); // замкнуто с Beach!
    this.roundabouts.push({ x: 3200, y: 5650, radius: 112, width: 96 });

    // --- 8. Морской Мост и скоростная трасса Аэропорта (Airport Highway) ---
    addSeg(4750, 4400, 5250, 4800, hwW, true);
    addSeg(5250, 4800, 6000, 4350, hwW, true);
    addSeg(6000, 4350, 6050, 5350, streetW);
    addSeg(6050, 5350, 5250, 4800, streetW);
    this.roundabouts.push({ x: 5250, y: 4800, radius: 116, width: 100 });

    // Узкие двусторонние shortcuts через крупные кварталы. Все концы лежат
    // на существующих улицах, поэтому переулки не заканчиваются тупиком.
    const alleyW = 72;
    addSeg(2500, 2850, 3200, 2850, alleyW, false, 'alley');
    addSeg(3200, 2850, 3900, 2850, alleyW, false, 'alley');
    addSeg(2500, 3550, 3200, 3550, alleyW, false, 'alley');
    addSeg(3200, 3550, 3900, 3550, alleyW, false, 'alley');
    addSeg(1282.5, 3200, 1462.5, 4300, alleyW, false, 'alley');
    addSeg(4400, 1300, 5025, 1600, alleyW, false, 'alley');
    addSeg(4882.5, 3335, 5050, 3950, alleyW, false, 'alley');
  }

  /**
   * 2. ПАРКОВОЧНЫЕ ЗОНЫ [ P ] НА ОБОЧИНАХ
   */
  private rotatedRectCorners(rect: OrientedRect, margin = 0): Point[] {
    const halfWidth = rect.width / 2 + margin;
    const halfHeight = rect.height / 2 + margin;
    const cos = Math.cos(rect.angle);
    const sin = Math.sin(rect.angle);
    return [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ].map(point => ({
      x: rect.x + point.x * cos - point.y * sin,
      y: rect.y + point.x * sin + point.y * cos,
    }));
  }

  private segmentToRotatedRectDistance(start: Point, end: Point, rect: OrientedRect): number {
    if (pointInRotatedRect(start, rect) || pointInRotatedRect(end, rect)) return 0;
    const corners = this.rotatedRectCorners(rect);
    let distance = Infinity;
    for (let index = 0; index < corners.length; index++) {
      const edgeStart = corners[index];
      const edgeEnd = corners[(index + 1) % corners.length];
      if (segmentIntersection(start, end, edgeStart, edgeEnd)) return 0;
      distance = Math.min(
        distance,
        closestPointOnSegment(start, edgeStart, edgeEnd).distance,
        closestPointOnSegment(end, edgeStart, edgeEnd).distance,
        closestPointOnSegment(edgeStart, start, end).distance,
      );
    }
    return distance;
  }

  private pointToRotatedRectDistance(point: Point, rect: OrientedRect): number {
    const cos = Math.cos(rect.angle);
    const sin = Math.sin(rect.angle);
    const dx = point.x - rect.x;
    const dy = point.y - rect.y;
    const localX = Math.abs(dx * cos + dy * sin) - rect.width / 2;
    const localY = Math.abs(-dx * sin + dy * cos) - rect.height / 2;
    return Math.hypot(Math.max(0, localX), Math.max(0, localY));
  }

  private orientedRectsOverlap(a: OrientedRect, b: OrientedRect): boolean {
    const cornersA = this.rotatedRectCorners(a);
    const cornersB = this.rotatedRectCorners(b);
    const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]
      .map(angle => ({ x: Math.cos(angle), y: Math.sin(angle) }));
    return axes.every(axis => {
      const projectionA = cornersA.map(point => point.x * axis.x + point.y * axis.y);
      const projectionB = cornersB.map(point => point.x * axis.x + point.y * axis.y);
      return Math.max(...projectionA) >= Math.min(...projectionB) - 1e-6 &&
        Math.max(...projectionB) >= Math.min(...projectionA) - 1e-6;
    });
  }

  private buildingRect(building: Building, margin = 0): OrientedRect {
    return {
      x: building.x + building.width / 2,
      y: building.y + building.height / 2,
      width: building.width + margin * 2,
      height: building.height + margin * 2,
      angle: 0,
    };
  }

  private getParkingAccessGeometry(zone: ParkingZone) {
    const segment = this.roadSegments.find(candidate => candidate.id === zone.accessRoadSegmentId);
    if (!segment) return null;
    const roadCenter = closestPointOnSegment(
      zone,
      { x: segment.x1, y: segment.y1 },
      { x: segment.x2, y: segment.y2 },
    );
    const roadLength = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) || 1;
    const baseNormal = {
      x: -(segment.y2 - segment.y1) / roadLength,
      y: (segment.x2 - segment.x1) / roadLength,
    };
    const side = (zone.x - roadCenter.x) * baseNormal.x + (zone.y - roadCenter.y) * baseNormal.y >= 0 ? 1 : -1;
    const normal = { x: baseNormal.x * side, y: baseNormal.y * side };
    const roadEdge = {
      x: roadCenter.x + normal.x * segment.width / 2,
      y: roadCenter.y + normal.y * segment.width / 2,
    };
    const bayEdge = {
      x: zone.x - normal.x * zone.height / 2,
      y: zone.y - normal.y * zone.height / 2,
    };
    const apronLength = Math.hypot(bayEdge.x - roadEdge.x, bayEdge.y - roadEdge.y);
    return {
      segment,
      roadCenter,
      roadEdge,
      bayEdge,
      apron: {
        x: (roadEdge.x + bayEdge.x) / 2,
        y: (roadEdge.y + bayEdge.y) / 2,
        width: zone.width,
        height: apronLength,
        angle: zone.angle,
      } satisfies OrientedRect,
    };
  }

  private canPlaceParkingZone(zone: ParkingZone, placedZones: ParkingZone[]): boolean {
    const accessRoad = this.roadSegments.find(candidate => candidate.id === zone.accessRoadSegmentId);
    if (!accessRoad || this.rotatedRectCorners(zone).some(point => !this.isPointOnLand(point.x, point.y, 2))) return false;
    const access = this.getParkingAccessGeometry(zone);
    if (!access || access.apron.height < 8 - 0.1 || access.apron.height > 16 + 0.1) return false;

    const ownRoadDistance = this.segmentToRotatedRectDistance(
      { x: accessRoad.x1, y: accessRoad.y1 },
      { x: accessRoad.x2, y: accessRoad.y2 },
      zone,
    );
    if (ownRoadDistance < accessRoad.width / 2 + this.parkingCurbGap - 0.1) return false;

    for (const road of this.roadSegments) {
      if (road.id === accessRoad.id) continue;
      const distance = this.segmentToRotatedRectDistance(
        { x: road.x1, y: road.y1 },
        { x: road.x2, y: road.y2 },
        zone,
      );
      if (distance <= road.width / 2 + 0.1) return false;
      const accessDistance = this.segmentToRotatedRectDistance(
        { x: road.x1, y: road.y1 },
        { x: road.x2, y: road.y2 },
        access.apron,
      );
      if (accessDistance <= road.width / 2 + 0.1) return false;
    }
    for (const roundabout of this.roundabouts) {
      if (this.pointToRotatedRectDistance(roundabout, zone) <= roundabout.radius + roundabout.width / 2 + 0.1) return false;
      if (this.pointToRotatedRectDistance(roundabout, access.apron) <= roundabout.radius + roundabout.width / 2 + 0.1) return false;
    }
    if (placedZones.some(placed => this.orientedRectsOverlap(
      { ...zone, width: zone.width + 12, height: zone.height + 12 },
      placed,
    ))) return false;
    return this.buildings.every(building =>
      !this.orientedRectsOverlap(zone, this.buildingRect(building, 10)) &&
      !this.orientedRectsOverlap(access.apron, this.buildingRect(building)));
  }

  private createParkingZones() {
    const zones: ParkingZone[] = [];
    const add = (
      id: string,
      roadId: string,
      t: number,
      side: -1 | 1,
      district: string,
      name: string,
    ) => {
      const segment = this.roadSegments.find(candidate => candidate.id === roadId);
      if (!segment) throw new Error(`Unknown parking access road: ${roadId}`);
      const dx = segment.x2 - segment.x1;
      const dy = segment.y2 - segment.y1;
      const length = Math.hypot(dx, dy) || 1;
      const width = 92;
      const height = 48;
      const lateralOffset = segment.width / 2 + this.parkingCurbGap + height / 2;
      const endInset = Math.min(0.45, (width / 2 + 8) / length);
      const offsets = [0];
      for (let step = 1; step <= 100; step++) offsets.push(step * 0.01, -step * 0.01);
      const makeCandidate = (
        candidateT: number,
        candidateSide: -1 | 1,
        data: Pick<ParkingZone, 'id' | 'district' | 'name'> = { id, district, name },
      ): ParkingZone => ({
        ...data,
        x: segment.x1 + dx * candidateT + (-dy / length) * candidateSide * lateralOffset,
        y: segment.y1 + dy * candidateT + (dx / length) * candidateSide * lateralOffset,
        width,
        height,
        angle: Math.atan2(dy, dx),
        accessRoadSegmentId: segment.id,
      });

      const candidateSides: Array<-1 | 1> = [side, side === 1 ? -1 : 1];
      for (const offset of offsets) {
        for (const candidateSide of candidateSides) {
          const candidateT = t + offset;
          if (candidateT < endInset || candidateT > 1 - endInset) continue;
          const candidate = makeCandidate(candidateT, candidateSide);
          if (!this.canPlaceParkingZone(candidate, zones)) continue;
          zones.push(candidate);
          return;
        }
      }
      throw new Error(`No safe parking position near road: ${id}`);
    };

    add('pk_dt_1', 'road_2100_2500_4300_2500', 0.32, -1, 'Downtown', 'Отель «Неон Палас»');
    add('pk_dt_2', 'road_2100_2500_4300_2500', 0.68, -1, 'Downtown', 'Синт-Банк 2099');
    add('pk_dt_3', 'road_2100_3900_4300_3900', 0.32, 1, 'Downtown', 'Кибер-Кафе «Глитч»');
    add('pk_dt_4', 'road_2100_3900_4300_3900', 0.68, 1, 'Downtown', 'Башня «Скайлайн»');
    add('pk_dt_5', 'road_2100_2500_4300_2500', 0.34, 1, 'Downtown', 'Клуб «Электра»');
    add('pk_dt_6', 'road_2100_3900_4300_3900', 0.68, -1, 'Downtown', 'Арт-Галерея «Вектор»');

    add('pk_hl_1', 'road_2500_1050_1750_1500', 0.30, 1, 'Hills', 'Вилла «Верде»');
    add('pk_hl_2', 'road_2500_1050_1750_1500', 0.70, -1, 'Hills', 'Особняк «Хиллтоп»');
    add('pk_hl_3', 'road_1750_1500_1900_3200', 0.28, 1, 'Hills', 'СПА-Отель «Дзен»');
    add('pk_hl_4', 'road_1750_1500_1900_3200', 0.68, -1, 'Hills', 'Смотровая Площадка');

    add('pk_ws_1', 'road_1900_3200_950_3200', 0.32, 1, 'Westside', 'Мегамолл «Вестсайд»');
    add('pk_ws_2', 'road_1250_4300_2100_4300', 0.65, -1, 'Westside', 'Кибер-Маркет «Нова»');
    add('pk_ws_3', 'road_950_3200_1250_4300', 0.32, 1, 'Westside', 'Аркада «Нео-Ретро»');
    add('pk_ws_4', 'road_950_3200_1250_4300', 0.68, -1, 'Westside', 'Фуд-Корт «Лапша 2099»');

    add('pk_in_1', 'road_4700_1150_5350_2050', 0.32, 1, 'Industrial', 'Завод «Роботикс»');
    add('pk_in_2', 'road_4700_1150_5350_2050', 0.68, -1, 'Industrial', 'Хим-Лаборатория 07');
    add('pk_in_3', 'road_5350_2050_4500_3200', 0.32, 1, 'Industrial', 'Склад «Хеви Стор»');
    add('pk_in_4', 'road_5350_2050_4500_3200', 0.68, -1, 'Industrial', 'Энергостанция «Синтез»');

    add('pk_bc_1', 'road_5350_3500_4750_4400', 0.30, 1, 'Beach', 'Пляжный Клуб «Океан»');
    add('pk_bc_2', 'road_5350_3500_4750_4400', 0.68, -1, 'Beach', 'Серф-Курорт «Бриз»');
    add('pk_bc_3', 'road_4750_4400_3200_4500', 0.38, 1, 'Beach', 'Бар «Тропик Неон»');

    add('pk_pt_1', 'road_2350_5250_4050_5250', 0.28, 1, 'Port', 'Морской Терминал');
    add('pk_pt_2', 'road_2350_5250_4050_5250', 0.72, -1, 'Port', 'Доки «Пирс 14»');
    add('pk_pt_3', 'road_2350_5250_2100_4300', 0.38, 1, 'Port', 'Контейнерный Хаб А');
    add('pk_pt_4', 'road_4050_5250_4750_4400', 0.62, -1, 'Port', 'Рыбный Рынок «Норд»');

    add('pk_ap_1', 'road_5250_4800_6000_4350', 0.28, 1, 'Airport', 'Терминал 1 (Вылет)');
    add('pk_ap_2', 'road_5250_4800_6000_4350', 0.62, -1, 'Airport', 'VIP-Ангар «Аэро-Кар»');
    add('pk_ap_3', 'road_6000_4350_6050_5350', 0.30, 1, 'Airport', 'Авиа-Отель «Флай»');
    add('pk_ap_4', 'road_6000_4350_6050_5350', 0.68, 1, 'Airport', 'Грузовой Авиа-Шлюз');
    this.parkingZones = zones;
  }

  private fuelStationZone(station: FuelStation): ParkingZone {
    return {
      id: station.id,
      name: station.name,
      district: 'Fuel',
      accessRoadSegmentId: station.accessRoadSegmentId,
      ...station.serviceZone,
    };
  }

  private createFuelStations() {
    const stations: FuelStation[] = [];
    const add = (
      id: string,
      name: string,
      roadId: string,
      preferredT: number,
      preferredSide: -1 | 1,
    ) => {
      const road = this.roadSegments.find(candidate => candidate.id === roadId);
      if (!road) throw new Error(`Unknown fuel station access road: ${roadId}`);
      if (road.kind === 'alley') throw new Error(`Fuel station cannot use alley: ${roadId}`);
      const dx = road.x2 - road.x1;
      const dy = road.y2 - road.y1;
      const length = Math.hypot(dx, dy) || 1;
      const width = 132;
      const height = 64;
      const lateralOffset = road.width / 2 + this.parkingCurbGap + height / 2;
      const endInset = Math.min(0.45, (width / 2 + 12) / length);
      const offsets = [0];
      for (let step = 1; step <= 45; step++) offsets.push(step * 0.015, -step * 0.015);
      const candidateSides: Array<-1 | 1> = [preferredSide, preferredSide === 1 ? -1 : 1];
      for (const offset of offsets) {
        for (const side of candidateSides) {
          const t = preferredT + offset;
          if (t < endInset || t > 1 - endInset) continue;
          const serviceZone = {
            x: road.x1 + dx * t + (-dy / length) * side * lateralOffset,
            y: road.y1 + dy * t + (dx / length) * side * lateralOffset,
            width,
            height,
            angle: Math.atan2(dy, dx),
          };
          const station: FuelStation = {
            id,
            name,
            x: serviceZone.x,
            y: serviceZone.y,
            angle: serviceZone.angle,
            accessRoadSegmentId: road.id,
            serviceZone,
          };
          const occupied = [
            ...this.parkingZones,
            ...stations.map(existing => this.fuelStationZone(existing)),
          ];
          if (!this.canPlaceParkingZone(this.fuelStationZone(station), occupied)) continue;
          stations.push(station);
          return;
        }
      }
      throw new Error(`No safe fuel station position near road: ${id}`);
    };

    add('fuel_west_hills', 'NEON FUEL WEST', 'road_1750_1500_1900_3200', 0.58, 1);
    add('fuel_downtown_industrial', 'VOLT GAS NORTH', 'road_3200_1900_4700_1150', 0.62, -1);
    add('fuel_port_beach', 'OCEAN DRIVE FUEL', 'road_4050_5250_4750_4400', 0.48, 1);
    add('fuel_airport', 'AERO FUEL 24', 'road_6000_4350_6050_5350', 0.52, -1);
    this.fuelStations = stations;
  }

  public validateFuelStations(): FuelStationValidationResult[] {
    return this.fuelStations.map(station => {
      const errors: string[] = [];
      const road = this.roadSegments.find(candidate => candidate.id === station.accessRoadSegmentId);
      if (!road) errors.push('access road is missing');
      else if (road.kind === 'alley') errors.push('access road is an alley');
      const candidate = this.fuelStationZone(station);
      const occupied = [
        ...this.parkingZones,
        ...this.fuelStations.filter(other => other.id !== station.id).map(other => this.fuelStationZone(other)),
      ];
      if (!this.canPlaceParkingZone(candidate, occupied)) errors.push('service bay is obstructed or off-road');
      if (!this.getParkingAccessGeometry(candidate)) errors.push('roadside access apron is missing');
      return { stationId: station.id, valid: errors.length === 0, errors };
    });
  }

  public validateParkingZones(): ParkingValidationResult[] {
    return this.parkingZones.map(zone => {
      const errors: string[] = [];
      const access = this.getParkingAccessGeometry(zone);
      if (!access) {
        errors.push('access road is missing');
        return { zoneId: zone.id, valid: false, errors };
      }

      const ownRoadDistance = this.segmentToRotatedRectDistance(
        { x: access.segment.x1, y: access.segment.y1 },
        { x: access.segment.x2, y: access.segment.y2 },
        zone,
      );
      const curbGap = ownRoadDistance - access.segment.width / 2;
      if (curbGap < 8 - 0.1 || curbGap > 16 + 0.1) errors.push(`curb gap is ${curbGap.toFixed(2)}px`);

      for (const road of this.roadSegments) {
        if (road.id === access.segment.id) continue;
        const distance = this.segmentToRotatedRectDistance(
          { x: road.x1, y: road.y1 },
          { x: road.x2, y: road.y2 },
          zone,
        );
        if (distance <= road.width / 2 + 0.1) {
          errors.push(`overlaps ${road.kind === 'alley' ? 'alley' : 'unrelated road'} ${road.id}`);
        }
        const accessDistance = this.segmentToRotatedRectDistance(
          { x: road.x1, y: road.y1 },
          { x: road.x2, y: road.y2 },
          access.apron,
        );
        if (accessDistance <= road.width / 2 + 0.1) errors.push(`access crosses ${road.kind} ${road.id}`);
      }

      for (const junction of this.junctions) {
        const connectedWidths = this.roadSegments
          .filter(road => pointInRoadCorridor(junction, { x: road.x1, y: road.y1 }, { x: road.x2, y: road.y2 }, 2))
          .map(road => road.width);
        const radius = Math.max(0, ...connectedWidths) / 2 + 2;
        if (this.pointToRotatedRectDistance(junction, zone) <= radius + 0.1) errors.push(`overlaps junction ${junction.id}`);
      }

      for (const roundabout of this.roundabouts) {
        if (this.pointToRotatedRectDistance(roundabout, zone) <= roundabout.radius + roundabout.width / 2 + 0.1) {
          errors.push(`overlaps roundabout at ${roundabout.x},${roundabout.y}`);
        }
        if (this.pointToRotatedRectDistance(roundabout, access.apron) <= roundabout.radius + roundabout.width / 2 + 0.1) {
          errors.push(`access crosses roundabout at ${roundabout.x},${roundabout.y}`);
        }
      }

      for (const building of this.buildings) {
        if (this.orientedRectsOverlap(zone, this.buildingRect(building))) errors.push(`overlaps building ${building.id}`);
        else if (this.orientedRectsOverlap(zone, this.buildingRect(building, 10))) errors.push(`too close to building ${building.id}`);
        if (this.orientedRectsOverlap(access.apron, this.buildingRect(building))) errors.push(`access blocked by building ${building.id}`);
      }

      if (access.apron.height < 8 - 0.1 || access.apron.height > 16 + 0.1) errors.push('access apron does not bridge the curb gap');
      if (!this.roadNodes.some(node => Math.hypot(node.x - access.roadCenter.x, node.y - access.roadCenter.y) < 1)) {
        errors.push('access path is absent from navigation graph');
      }
      const standardCar = { length: 56, width: 30, clearance: 8 };
      if (zone.width < standardCar.length + standardCar.clearance * 2 ||
          zone.height < standardCar.width + standardCar.clearance * 2) {
        errors.push('standard car does not fit');
      }
      if (this.checkVehicleCollision({
        x: zone.x,
        y: zone.y,
        angle: zone.angle,
        length: standardCar.length,
        width: standardCar.width,
      })) errors.push('standard car collides inside bay');
      for (let step = 0; step <= 4; step++) {
        const t = step / 4;
        if (this.checkVehicleCollision({
          x: access.roadEdge.x + (access.bayEdge.x - access.roadEdge.x) * t,
          y: access.roadEdge.y + (access.bayEdge.y - access.roadEdge.y) * t,
          angle: zone.angle,
          length: standardCar.length,
          width: standardCar.width,
        })) {
          errors.push('standard car access is obstructed');
          break;
        }
      }

      return { zoneId: zone.id, valid: errors.length === 0, errors };
    });
  }

  /**
   * 3. ЗДАНИЯ С БЕЗОПАСНЫМ БУФЕРОМ (тротуар > 50px от края широких дорог)
   */
  private createBuildings() {
    this.buildings = [];

    const neonSigns = [
      { text: 'НЕОН БАР', color: '#f43f5e', glow: '#fb7185' },
      { text: 'КИБЕР КАФЕ', color: '#00f0ff', glow: '#38bdf8' },
      { text: 'СИНТ ОТЕЛЬ', color: '#facc15', glow: '#fde047' },
      { text: 'КЛУБ 2099', color: '#c084fc', glow: '#e879f9' },
      { text: 'МЕГА МОЛЛ', color: '#38bdf8', glow: '#67e8f9' },
      { text: 'КИБЕР СПОРТ', color: '#4ade80', glow: '#86efac' },
      { text: 'СИНТ БАНК', color: '#f59e0b', glow: '#fbbf24' },
      { text: 'АПТЕКА 24/7', color: '#34d399', glow: '#6ee7b7' },
      { text: 'АВТО ШОП', color: '#fb923c', glow: '#fdba74' },
      { text: 'НОЧНОЙ КЛУБ', color: '#e879f9', glow: '#f472b6' },
      { text: 'МЕТРО ХАБ', color: '#06b6d4', glow: '#22d3ee' },
      { text: 'КАФЕ ЛАПША', color: '#f87171', glow: '#fca5a5' },
    ];

    let signIdx = 0;
    const getNextSign = () => neonSigns[signIdx++ % neonSigns.length];

    // Downtown (Кварталы небоскребов внутри сеток)
    const dtBlocks = [
      { x: 2680, y: 2645, w: 360, h: 140 }, { x: 2680, y: 2915, w: 360, h: 155 },
      { x: 3360, y: 2645, w: 360, h: 140 }, { x: 3360, y: 2915, w: 360, h: 155 },
      { x: 2680, y: 3330, w: 360, h: 155 }, { x: 2680, y: 3620, w: 360, h: 145 },
      { x: 3360, y: 3330, w: 360, h: 155 }, { x: 3360, y: 3620, w: 360, h: 145 },
    ];

    for (let i = 0; i < dtBlocks.length; i++) {
      const block = dtBlocks[i];
      let cursor = 0;
      let facadeIndex = 0;
      while (cursor < block.w - 34) {
        const remaining = block.w - cursor;
        const facade = Math.min(remaining, 42 + Math.floor(hashNoise(i, facadeIndex, 41) * 46));
        const depth = Math.min(block.h, 92 + Math.floor(hashNoise(i, facadeIndex, 77) * 55));
        const sign = getNextSign();
        this.buildings.push({
          id: `b_dt_${i}_${facadeIndex}`,
          x: block.x + cursor,
          y: i % 2 === 0 ? block.y : block.y + block.h - depth,
          width: facade,
          height: depth,
          roofColor: facadeIndex % 3 === 0 ? '#0d1728' : '#0a101d',
          neonBorderColor: '#06b6d4',
          glowColor: 'rgba(6, 182, 212, 0.4)',
          district: 'Downtown',
          type: facadeIndex % 3 === 0 ? 'commercial' : 'skyscraper',
          neonSign: facadeIndex % 4 === 0 ? {
            text: sign.text,
            color: sign.color,
            glowColor: sign.glow,
            size: 11,
            offsetX: facade / 2,
            offsetY: 24,
            angle: 0,
          } : undefined,
        });
        cursor += facade + 6;
        facadeIndex++;
      }
    }

    // Hills (Виллы)
    const hlBlocks = [
      { x: 2200, y: 720, w: 220, h: 160 },
      { x: 2600, y: 720, w: 220, h: 160 },
      { x: 1200, y: 1650, w: 200, h: 160 },
    ];
    for (let i = 0; i < hlBlocks.length; i++) {
      const b = hlBlocks[i];
      const sign = getNextSign();
      this.buildings.push({
        id: 'b_hl_' + i,
        x: b.x,
        y: b.y,
        width: b.w,
        height: b.h,
        roofColor: '#0f1a14',
        neonBorderColor: '#22c55e',
        glowColor: 'rgba(34, 197, 94, 0.4)',
        district: 'Hills',
        neonSign: {
          text: sign.text,
          color: sign.color,
          glowColor: sign.glow,
          size: 14,
          offsetX: b.w / 2,
          offsetY: 30,
          angle: 0,
        },
      });
    }

    // Westside (Моллы)
    const wsBlocks = [
      { x: 500, y: 2700, w: 220, h: 220 },
      { x: 500, y: 3400, w: 220, h: 220 },
      { x: 1100, y: 4450, w: 240, h: 180 },
    ];
    for (let i = 0; i < wsBlocks.length; i++) {
      const b = wsBlocks[i];
      const sign = getNextSign();
      this.buildings.push({
        id: 'b_ws_' + i,
        x: b.x,
        y: b.y,
        width: b.w,
        height: b.h,
        roofColor: '#1a0c14',
        neonBorderColor: '#f43f5e',
        glowColor: 'rgba(244, 63, 94, 0.4)',
        district: 'Westside',
        neonSign: {
          text: sign.text,
          color: sign.color,
          glowColor: sign.glow,
          size: 14,
          offsetX: b.w / 2,
          offsetY: 30,
          angle: 0,
        },
      });
    }

    // Industrial (Заводы)
    const inBlocks = [
      { x: 5050, y: 1050, w: 260, h: 180 },
      { x: 4200, y: 600, w: 260, h: 180 },
      { x: 5500, y: 2150, w: 220, h: 220 },
    ];
    for (let i = 0; i < inBlocks.length; i++) {
      const b = inBlocks[i];
      const sign = getNextSign();
      this.buildings.push({
        id: 'b_in_' + i,
        x: b.x,
        y: b.y,
        width: b.w,
        height: b.h,
        roofColor: '#140c1d',
        neonBorderColor: '#a855f7',
        glowColor: 'rgba(168, 85, 247, 0.4)',
        district: 'Industrial',
        neonSign: {
          text: sign.text,
          color: sign.color,
          glowColor: sign.glow,
          size: 14,
          offsetX: b.w / 2,
          offsetY: 30,
          angle: 0,
        },
      });
    }

    // Beach (Пляжные клубы)
    const bcBlocks = [
      { x: 5300, y: 4050, w: 220, h: 200 },
      { x: 5400, y: 3750, w: 220, h: 180 },
    ];
    for (let i = 0; i < bcBlocks.length; i++) {
      const b = bcBlocks[i];
      const sign = getNextSign();
      this.buildings.push({
        id: 'b_bc_' + i,
        x: b.x,
        y: b.y,
        width: b.w,
        height: b.h,
        roofColor: '#1c160c',
        neonBorderColor: '#f59e0b',
        glowColor: 'rgba(245, 158, 11, 0.4)',
        district: 'Beach',
        neonSign: {
          text: sign.text,
          color: sign.color,
          glowColor: sign.glow,
          size: 14,
          offsetX: b.w / 2,
          offsetY: 30,
          angle: 0,
        },
      });
    }

    // Port (Склады)
    const ptBlocks = [
      { x: 2850, y: 5900, w: 240, h: 180 },
      { x: 3300, y: 5900, w: 240, h: 180 },
    ];
    for (let i = 0; i < ptBlocks.length; i++) {
      const b = ptBlocks[i];
      const sign = getNextSign();
      this.buildings.push({
        id: 'b_pt_' + i,
        x: b.x,
        y: b.y,
        width: b.w,
        height: b.h,
        roofColor: '#0a1424',
        neonBorderColor: '#38bdf8',
        glowColor: 'rgba(56, 189, 248, 0.4)',
        district: 'Port',
        neonSign: {
          text: sign.text,
          color: sign.color,
          glowColor: sign.glow,
          size: 14,
          offsetX: b.w / 2,
          offsetY: 30,
          angle: 0,
        },
      });
    }

    // Airport (Аэровокзал)
    const apBlocks = [
      { x: 4900, y: 5100, w: 240, h: 180 },
      { x: 5150, y: 4250, w: 260, h: 180 },
      { x: 5650, y: 4750, w: 220, h: 180 },
    ];
    for (let i = 0; i < apBlocks.length; i++) {
      const b = apBlocks[i];
      const sign = getNextSign();
      this.buildings.push({
        id: 'b_ap_' + i,
        x: b.x,
        y: b.y,
        width: b.w,
        height: b.h,
        roofColor: '#171124',
        neonBorderColor: '#ef4444',
        glowColor: 'rgba(239, 68, 68, 0.4)',
        district: 'Airport',
        neonSign: {
          text: sign.text,
          color: sign.color,
          glowColor: sign.glow,
          size: 14,
          offsetX: b.w / 2,
          offsetY: 30,
          angle: 0,
        },
      });
    }

    const infillCandidates = [
      { x: 1500, y: 850, w: 180, h: 130, district: 'Hills', border: '#22c55e' },
      { x: 1050, y: 1850, w: 190, h: 140, district: 'Hills', border: '#22c55e' },
      { x: 2950, y: 850, w: 190, h: 135, district: 'Hills', border: '#22c55e' },
      { x: 700, y: 3800, w: 180, h: 150, district: 'Westside', border: '#f43f5e' },
      { x: 1450, y: 3650, w: 180, h: 155, district: 'Westside', border: '#f43f5e' },
      { x: 1550, y: 4620, w: 210, h: 145, district: 'Westside', border: '#f43f5e' },
      { x: 650, y: 4400, w: 170, h: 135, district: 'Westside', border: '#f43f5e' },
      { x: 3900, y: 850, w: 190, h: 145, district: 'Industrial', border: '#a855f7' },
      { x: 4500, y: 1750, w: 200, h: 150, district: 'Industrial', border: '#a855f7' },
      { x: 5200, y: 1350, w: 190, h: 145, district: 'Industrial', border: '#a855f7' },
      { x: 4500, y: 3550, w: 190, h: 145, district: 'Beach', border: '#f59e0b' },
      { x: 5100, y: 4300, w: 180, h: 140, district: 'Beach', border: '#f59e0b' },
      { x: 5550, y: 3150, w: 175, h: 135, district: 'Beach', border: '#f59e0b' },
      { x: 2500, y: 4700, w: 190, h: 145, district: 'Port', border: '#38bdf8' },
      { x: 2700, y: 5480, w: 170, h: 135, district: 'Port', border: '#38bdf8' },
      { x: 3600, y: 5480, w: 180, h: 135, district: 'Port', border: '#38bdf8' },
      { x: 4000, y: 5750, w: 190, h: 140, district: 'Port', border: '#38bdf8' },
      { x: 5350, y: 5400, w: 180, h: 130, district: 'Airport', border: '#ef4444' },
    ];
    const distanceToRect = (x: number, y: number, rect: { x: number; y: number; width: number; height: number }) => {
      const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.width));
      const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.height));
      return Math.hypot(x - closestX, y - closestY);
    };
    const canPlace = (candidate: { x: number; y: number; w: number; h: number }, buildingGap = 18) => {
      const rect = { x: candidate.x, y: candidate.y, width: candidate.w, height: candidate.h };
      const corners = [
        { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
        { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height },
      ];
      if (corners.some(point => !this.isPointOnLand(point.x, point.y, 12))) return false;
      for (const segment of this.roadSegments) {
        const steps = Math.max(2, Math.ceil(Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) / 24));
        for (let index = 0; index <= steps; index++) {
          const t = index / steps;
          if (distanceToRect(segment.x1 + (segment.x2 - segment.x1) * t, segment.y1 + (segment.y2 - segment.y1) * t, rect) < segment.width / 2 + 18) return false;
        }
      }
      for (const roundabout of this.roundabouts) {
        if (distanceToRect(roundabout.x, roundabout.y, rect) < roundabout.radius + roundabout.width / 2 + 18) return false;
      }
      for (const zone of this.parkingZones) {
        const paddedBuilding: OrientedRect = {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          width: rect.width + 36,
          height: rect.height + 36,
          angle: 0,
        };
        if (this.orientedRectsOverlap(zone, paddedBuilding)) return false;
        const access = this.getParkingAccessGeometry(zone);
        if (access && this.orientedRectsOverlap(access.apron, paddedBuilding)) return false;
      }
      return this.buildings.every(building =>
        rect.x + rect.width + buildingGap <= building.x || building.x + building.width + buildingGap <= rect.x ||
        rect.y + rect.height + buildingGap <= building.y || building.y + building.height + buildingGap <= rect.y);
    };

    for (const candidate of infillCandidates) {
      if (!canPlace(candidate)) continue;
      const sign = getNextSign();
      this.buildings.push({
        id: `b_fill_${this.buildings.length}`,
        x: candidate.x,
        y: candidate.y,
        width: candidate.w,
        height: candidate.h,
        roofColor: '#0c1320',
        neonBorderColor: candidate.border,
        glowColor: `${candidate.border}55`,
        district: candidate.district,
        type: 'residential',
        neonSign: this.buildings.length % 2 === 0 ? {
          text: sign.text,
          color: sign.color,
          glowColor: sign.glow,
          size: 12,
          offsetX: candidate.w / 2,
          offsetY: 25,
          angle: 0,
        } : undefined,
      });
    }

    // Continuous façade rows are derived from actual road edges rather than
    // scattered points. Existing special-area landmarks remain untouched.
    const districtPalette: Record<string, string> = {
      Downtown: '#06b6d4', Hills: '#22c55e', Westside: '#f43f5e', Beach: '#f59e0b',
    };
    const rowSegments = this.roadSegments.filter(segment => {
      const dx = Math.abs(segment.x2 - segment.x1);
      const dy = Math.abs(segment.y2 - segment.y1);
      if (segment.kind !== 'street' || Math.max(dx, dy) < 520 || Math.min(dx, dy) > 1) return false;
      const cx = (segment.x1 + segment.x2) / 2;
      const cy = (segment.y1 + segment.y2) / 2;
      const district = this.districts.reduce((best, item) =>
        Math.hypot(item.centerX - cx, item.centerY - cy) < Math.hypot(best.centerX - cx, best.centerY - cy) ? item : best,
      this.districts[0]);
      return !['industrial', 'port', 'airport'].includes(district.id);
    });
    let rowId = 0;
    for (const segment of rowSegments) {
      const horizontal = Math.abs(segment.x2 - segment.x1) >= Math.abs(segment.y2 - segment.y1);
      const start = horizontal ? Math.min(segment.x1, segment.x2) : Math.min(segment.y1, segment.y2);
      const end = horizontal ? Math.max(segment.x1, segment.x2) : Math.max(segment.y1, segment.y2);
      const cx = (segment.x1 + segment.x2) / 2;
      const cy = (segment.y1 + segment.y2) / 2;
      const district = this.districts.reduce((best, item) =>
        Math.hypot(item.centerX - cx, item.centerY - cy) < Math.hypot(best.centerX - cx, best.centerY - cy) ? item : best,
      this.districts[0]);
      const districtName = district.name[0] + district.name.slice(1).toLowerCase();
      const border = districtPalette[districtName] ?? '#38bdf8';
      for (const side of [-1, 1] as const) {
        let cursor = start + 170;
        let facadeIndex = 0;
        while (cursor < end - 170) {
          const facade = Math.min(end - 170 - cursor, 38 + Math.floor(hashNoise(rowId, facadeIndex, 101) * 51));
          if (facade < 30) break;
          const depth = 82 + Math.floor(hashNoise(rowId, facadeIndex, 151) * 105);
          const edgeOffset = segment.width / 2 + 20;
          const candidate = horizontal
            ? { x: cursor, y: segment.y1 + side * edgeOffset + (side < 0 ? -depth : 0), w: facade, h: depth }
            : { x: segment.x1 + side * edgeOffset + (side < 0 ? -depth : 0), y: cursor, w: depth, h: facade };
          if (canPlace(candidate, 6)) {
            const sign = getNextSign();
            this.buildings.push({
              id: `b_row_${rowId++}`,
              x: candidate.x,
              y: candidate.y,
              width: candidate.w,
              height: candidate.h,
              roofColor: facadeIndex % 3 === 0 ? '#101827' : '#0b1220',
              neonBorderColor: border,
              glowColor: `${border}55`,
              district: districtName,
              type: facadeIndex % 4 === 0 ? 'commercial' : 'residential',
              neonSign: facadeIndex % 5 === 0 ? {
                text: sign.text, color: sign.color, glowColor: sign.glow, size: 10,
                offsetX: candidate.w / 2, offsetY: 21, angle: 0,
              } : undefined,
            });
          }
          cursor += facade + 6;
          facadeIndex++;
        }
      }
    }
  }

  private createStreetInfrastructure() {
    this.streetLights = [];
    const lightCoords = [
      { x: 2500, y: 2500 }, { x: 3200, y: 2500 }, { x: 3900, y: 2500 },
      { x: 2500, y: 3200 }, { x: 3900, y: 3200 },
      { x: 2500, y: 3900 }, { x: 3200, y: 3900 }, { x: 3900, y: 3900 },
      { x: 2500, y: 1050 }, { x: 4700, y: 1150 }, { x: 950, y: 3200 },
      { x: 5350, y: 3500 }, { x: 3200, y: 5650 }, { x: 5250, y: 4800 },
    ];

    for (const p of lightCoords) {
      this.streetLights.push({
        x: p.x * CITY_GEOMETRY_SCALE,
        y: p.y * CITY_GEOMETRY_SCALE,
        color: 'rgba(6, 182, 212, 0.25)',
        radius: 200,
      });
    }

    const trafficLights: TrafficLight[] = [
      { x: 2500, y: 2500, state: 'green', timer: 0 },
      { x: 3900, y: 2500, state: 'red', timer: 3 },
      { x: 2500, y: 3900, state: 'red', timer: 3 },
      { x: 3900, y: 3900, state: 'green', timer: 0 },
    ];
    this.trafficLights = trafficLights.map(light => ({
      ...light,
      x: light.x * CITY_GEOMETRY_SCALE,
      y: light.y * CITY_GEOMETRY_SCALE,
    }));
  }

  private buildRoadGraph() {
    const cuts = this.roadSegments.map(() => [0, 1]);
    for (let i = 0; i < this.roadSegments.length; i++) {
      const a = this.roadSegments[i];
      for (let j = i + 1; j < this.roadSegments.length; j++) {
        const b = this.roadSegments[j];
        const crossing = segmentIntersection(
          { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 },
          { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 },
        );
        if (!crossing) continue;
        cuts[i].push(crossing.ta);
        cuts[j].push(crossing.tb);
      }
    }

    // Парковочный карман должен быть конечной точкой маршрута, а не просто
    // декоративным прямоугольником рядом с длинным дорожным ребром.
    for (const zone of this.parkingZones) {
      const segmentIndex = this.roadSegments.findIndex(segment => segment.id === zone.accessRoadSegmentId);
      if (segmentIndex < 0) continue;
      const segment = this.roadSegments[segmentIndex];
      const accessPoint = closestPointOnSegment(
        zone,
        { x: segment.x1, y: segment.y1 },
        { x: segment.x2, y: segment.y2 },
      );
      cuts[segmentIndex].push(accessPoint.t);
    }

    this.roadNodes = [];
    this.navigationEdges = [];
    const nodeByPosition = new Map<string, number>();
    const nodeAt = (x: number, y: number) => {
      const key = `${Math.round(x * 10)},${Math.round(y * 10)}`;
      const existing = nodeByPosition.get(key);
      if (existing !== undefined) return existing;
      const district = this.districts.reduce((best, candidate) =>
        Math.hypot(candidate.centerX - x, candidate.centerY - y) <
        Math.hypot(best.centerX - x, best.centerY - y) ? candidate : best,
      ).name;
      const id = this.roadNodes.length;
      this.roadNodes.push({ id, x, y, district, neighbors: [], junctionId: null });
      nodeByPosition.set(key, id);
      return id;
    };

    this.roadSegments.forEach((segment, segmentIndex) => {
      const uniqueCuts = [...new Set(cuts[segmentIndex].map(t => Math.round(t * 1e6) / 1e6))]
        .sort((a, b) => a - b);
      const dx = segment.x2 - segment.x1;
      const dy = segment.y2 - segment.y1;
      const endpointIds: number[] = [];
      for (let i = 0; i < uniqueCuts.length; i++) {
        const t = uniqueCuts[i];
        endpointIds.push(nodeAt(segment.x1 + dx * t, segment.y1 + dy * t));
      }
      segment.fromNodeId = endpointIds[0];
      segment.toNodeId = endpointIds[endpointIds.length - 1];
      for (let i = 0; i < endpointIds.length - 1; i++) {
        const from = this.roadNodes[endpointIds[i]];
        const to = this.roadNodes[endpointIds[i + 1]];
        if (Math.hypot(to.x - from.x, to.y - from.y) < 1) continue;
        const edge: NavigationEdge = {
          id: `${segment.id}:${i}`,
          roadId: segment.id,
          fromNodeId: from.id,
          toNodeId: to.id,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          width: segment.width,
        };
        this.navigationEdges.push(edge);
        from.neighbors.push(to.id);
        to.neighbors.push(from.id);
      }
    });

    this.junctions = [];
    for (const node of this.roadNodes) {
      const incident = this.navigationEdges.filter(edge => edge.fromNodeId === node.id || edge.toNodeId === node.id);
      const roadIds = new Set(incident.map(edge => edge.roadId));
      const roundabout = this.roundabouts.some(rb => Math.hypot(rb.x - node.x, rb.y - node.y) < 2);
      const outwardAngles = incident.map(edge => {
        const other = this.roadNodes[edge.fromNodeId === node.id ? edge.toNodeId : edge.fromNodeId];
        return Math.atan2(other.y - node.y, other.x - node.x);
      });
      const straightContinuation = outwardAngles.length === 2 &&
        Math.abs(Math.abs(normalizeAngle(outwardAngles[0] - outwardAngles[1])) - Math.PI) < 0.04;
      // A parking cut or any other degree-two split of one road is only a graph
      // connection. It becomes a traffic junction only when roads actually meet.
      if (!roundabout && (roadIds.size < 2 || straightContinuation)) continue;
      const id = `junction_${Math.round(node.x * 10)}_${Math.round(node.y * 10)}`;
      node.junctionId = id;
      this.junctions.push({
        id,
        nodeId: node.id,
        x: node.x,
        y: node.y,
        kind: roundabout ? 'roundabout' : incident.length >= 3 ? 'intersection' : 'turn',
      });
    }

    this.circularLanes = [];
    for (const roundabout of this.roundabouts) {
      const node = this.roadNodes.find(candidate => Math.hypot(candidate.x - roundabout.x, candidate.y - roundabout.y) < 2);
      if (!node?.junctionId) continue;
      // Right-hand traffic circulates counterclockwise on screen. Canvas Y is
      // inverted, so this is the negative mathematical angular direction.
      const direction = 'counterclockwise' as const;
      this.circularLanes.push({
        id: `roundabout_lane_${Math.round(roundabout.x)}_${Math.round(roundabout.y)}_${direction}`,
        junctionId: node.junctionId,
        direction,
        center: { x: roundabout.x, y: roundabout.y },
        radius: roundabout.radius,
        width: roundabout.width,
      });
    }

    this.lanes = [];
    this.laneById.clear();
    this.outgoingLanes.clear();
    const addLane = (edge: NavigationEdge, reverse: boolean) => {
      const fromNodeId = reverse ? edge.toNodeId : edge.fromNodeId;
      const toNodeId = reverse ? edge.fromNodeId : edge.toNodeId;
      const from = this.roadNodes[fromNodeId];
      const to = this.roadNodes[toNodeId];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const laneOffset = Math.min(78, edge.width * 0.25);
      const trim = (node: RoadNode, towardX: number, towardY: number) => {
        const roundabout = this.roundabouts.find(rb => Math.hypot(rb.x - node.x, rb.y - node.y) < 2);
        const junctionInset = roundabout?.radius ?? (node.junctionId ? Math.min(72, edge.width * 0.36) : 0);
        if (junctionInset === 0) return { x: node.x, y: node.y };
        const distance = Math.hypot(towardX - node.x, towardY - node.y) || 1;
        return {
          x: node.x + ((towardX - node.x) / distance) * junctionInset,
          y: node.y + ((towardY - node.y) / distance) * junctionInset,
        };
      };
      const baseStart = trim(from, to.x, to.y);
      const baseEnd = trim(to, from.x, from.y);
      // Canvas Y grows downward, so the right-hand normal is (-uy, ux).
      const rightX = -uy;
      const rightY = ux;
      const start = { x: baseStart.x + rightX * laneOffset, y: baseStart.y + rightY * laneOffset };
      const end = { x: baseEnd.x + rightX * laneOffset, y: baseEnd.y + rightY * laneOffset };
      const direction = reverse ? 'reverse' : 'forward';
      const lane: Lane = {
        id: `${edge.id}:${direction}`,
        edgeId: edge.id,
        roadId: edge.roadId,
        direction,
        fromNodeId,
        toNodeId,
        start,
        end,
        angle: Math.atan2(end.y - start.y, end.x - start.x),
        length: Math.hypot(end.x - start.x, end.y - start.y),
        width: Math.max(24, edge.width / 2 - 10),
        offset: laneOffset,
        fromJunctionId: from.junctionId,
        toJunctionId: to.junctionId,
      };
      this.lanes.push(lane);
      this.laneById.set(lane.id, lane);
      const outgoing = this.outgoingLanes.get(fromNodeId) ?? [];
      outgoing.push(lane.id);
      this.outgoingLanes.set(fromNodeId, outgoing);
    };
    for (const edge of this.navigationEdges) {
      addLane(edge, false);
      addLane(edge, true);
    }
    this.buildLaneTransitions();
    this.gpsCache = null;
  }

  /**
   * 4. ИНИЦИАЛИЗАЦИЯ НАЗЕМНОГО ТРАФИКА
   * 20+ автомобилей на дорогах, мешающих доставке, с правосторонним движением!
   */
  private initTraffic() {
    this.trafficCars = [];
    const trafficLanes = this.lanes.filter(lane =>
      this.getRoad(lane.roadId)?.kind !== 'alley' && (this.outgoingTransitions.get(lane.id)?.length ?? 0) > 0);
    const count = Math.min(30, trafficLanes.length);
    for (let i = 0; i < count; i++) {
      const lane = trafficLanes[(i * 5) % trafficLanes.length];
      const model = TRAFFIC_VEHICLE_SPAWN_POOL[i % TRAFFIC_VEHICLE_SPAWN_POOL.length];
      const profile = getTrafficVehicleProfile(model);
      const colorScheme = TRAFFIC_COLOR_PALETTE[(i * 7) % TRAFFIC_COLOR_PALETTE.length];
      const t = 0.15 + ((i * 37) % 70) / 100;
      const posX = lane.start.x + (lane.end.x - lane.start.x) * t;
      const posY = lane.start.y + (lane.end.y - lane.start.y) * t;
      const angle = lane.angle;
      const targetSpeed = Math.min(170, (120 + hashNoise(i, 13, 9) * 45) * profile.speedModifier);
      // Preserve the pre-variety collision footprint sequence exactly. Visual
      // proportions are separate so a van/truck silhouette cannot change AI spacing.
      const legacyCollisionType = i % 4;
      const collisionLength = legacyCollisionType === 2 ? 58 : legacyCollisionType === 1 ? 52 : 48;
      const collisionWidth = legacyCollisionType === 2 ? 28 : legacyCollisionType === 1 ? 26 : 24;

      this.trafficCars.push({
        id: `npc_${i}`,
        x: posX,
        y: posY,
        vx: Math.cos(angle) * 110,
        vy: Math.sin(angle) * 110,
        angle,
        speed: Math.min(targetSpeed, (110 + hashNoise(i, 7, 3) * 40) * profile.speedModifier),
        targetSpeed,
        maxSpeed: 170,
        width: collisionWidth,
        length: collisionLength,
        visualWidth: profile.width,
        visualLength: profile.length,
        color: colorScheme.body,
        glowColor: colorScheme.glow,
        modelType: model,
        currentRoadId: lane.roadId,
        targetNodeId: lane.toNodeId,
        isBraking: false,
        honkTimer: 0,
        currentLaneId: lane.id,
        laneProgress: t,
        nextLaneId: null,
        activeTransitionId: null,
        transitionPoints: [],
        transitionIndex: 0,
        reservationZoneId: null,
        waitingForJunction: false,
        waitingDuration: 0,
        blockingReason: null,
        blockingCarId: null,
        progressWindowTime: 0,
        progressWindowDistance: 0,
        stalledWindowCount: 0,
        stuckTimer: 0,
        recoveryCount: 0,
      });
    }
  }

  private getRoad(roadId: string): RoadSegment | undefined {
    return this.roadSegments.find(road => road.id === roadId);
  }

  private chooseNextLane(car: TrafficCar, lane: Lane): Lane | null {
    const candidates = (this.outgoingTransitions.get(lane.id) ?? [])
      .map(transition => this.laneById.get(transition.toLaneId))
      .filter((candidate): candidate is Lane => Boolean(candidate))
      .filter(candidate => this.getRoad(candidate.roadId)?.kind !== 'alley');
    if (candidates.length === 0) return null;
    const viable = candidates.filter(candidate => (this.outgoingTransitions.get(candidate.id)?.length ?? 0) > 0);
    const pool = viable.length > 0 ? viable : candidates;
    let best = pool[0];
    let bestScore = -Infinity;
    for (const candidate of pool) {
      const turn = Math.abs(normalizeAngle(candidate.angle - lane.angle));
      const deterministic = stableStringNoise(
        `${car.id}|${lane.id}|${candidate.id}|${car.recoveryCount}`,
      ) * 0.45;
      // Nearby opposite lanes can share the same narrow physical corridor for
      // hundreds of metres. Avoid entering one while its counterpart is occupied.
      const opposingOccupied = this.trafficCars.some(other => other.id !== car.id &&
        this.opposingLanesShareCorridor(candidate, this.laneById.get(other.currentLaneId)));
      const score = Math.cos(turn) + deterministic - (opposingOccupied ? 2 : 0);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  private opposingLanesShareCorridor(a: Lane, b: Lane | undefined): boolean {
    if (!b || a.id === b.id || Math.cos(a.angle - b.angle) > -0.9) return false;
    let closeSamples = 0;
    for (let step = 1; step < 12; step++) {
      const t = step / 12;
      const point = { x: a.start.x + (a.end.x - a.start.x) * t,
        y: a.start.y + (a.end.y - a.start.y) * t };
      if (closestPointOnSegment(point, b.start, b.end).distance < 28 && ++closeSamples >= 2) return true;
    }
    return false;
  }

  private predictsCrossLaneCollision(car: TrafficCar, other: TrafficCar): boolean {
    if (car.currentLaneId === other.currentLaneId ||
        car.transitionPoints.length > 0 || other.transitionPoints.length > 0) return false;
    const centerDistance = Math.hypot(other.x - car.x, other.y - car.y);
    if (centerDistance > 165) return false;
    const carVelocity = { x: Math.cos(car.angle) * car.speed, y: Math.sin(car.angle) * car.speed };
    const otherVelocity = { x: Math.cos(other.angle) * other.speed, y: Math.sin(other.angle) * other.speed };
    const relativePosition = { x: other.x - car.x, y: other.y - car.y };
    const relativeVelocity = { x: otherVelocity.x - carVelocity.x, y: otherVelocity.y - carVelocity.y };
    if (relativePosition.x * relativeVelocity.x + relativePosition.y * relativeVelocity.y >= 0) return false;

    for (const horizon of [0.2, 0.4, 0.6, 0.8]) {
      const carCircles = vehicleCollisionCircles({
        ...car,
        x: car.x + carVelocity.x * horizon,
        y: car.y + carVelocity.y * horizon,
      });
      const otherCircles = vehicleCollisionCircles({
        ...other,
        x: other.x + otherVelocity.x * horizon,
        y: other.y + otherVelocity.y * horizon,
      });
      if (carCircles.some(carCircle => otherCircles.some(otherCircle =>
        Math.hypot(otherCircle.x - carCircle.x, otherCircle.y - carCircle.y) <
        carCircle.radius + otherCircle.radius + 6))) return true;
    }
    return false;
  }

  /** A strict per-car order shared by prediction, following and collision rollback. */
  private compareTrafficPriority(a: TrafficCar, b: TrafficCar): number {
    if (a.id === b.id) return 0;
    const rank = (car: TrafficCar) => car.transitionPoints.length > 0 ? 2 :
      car.reservationZoneId && this.transitionReservations.get(car.reservationZoneId)?.ownerId === car.id ? 1 : 0;
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    // Cars farther through their current lane/turn have clearance priority.
    const progress = (car: TrafficCar) => car.transitionPoints.length > 0
      ? car.transitionIndex / Math.max(1, car.transitionPoints.length)
      : car.laneProgress;
    const progressDelta = progress(a) - progress(b);
    if (Math.abs(progressDelta) > 1e-9) return progressDelta;
    const waitDelta = a.waitingDuration - b.waitingDuration;
    if (Math.abs(waitDelta) > 1e-9) return waitDelta;
    const hashDelta = stableStringNoise(a.id) - stableStringNoise(b.id);
    return hashDelta !== 0 ? hashDelta : (a.id < b.id ? 1 : -1);
  }

  private yieldsForCrossLaneConflict(car: TrafficCar, other: TrafficCar): boolean {
    if (!this.predictsCrossLaneCollision(car, other)) return false;
    return this.compareTrafficPriority(car, other) < 0;
  }

  private resolveTrafficBlockerCycles() {
    const byId = new Map(this.trafficCars.map(car => [car.id, car]));
    const visited = new Set<string>();
    for (const root of this.trafficCars) {
      if (visited.has(root.id)) continue;
      const chain: TrafficCar[] = [];
      const position = new Map<string, number>();
      let current: TrafficCar | undefined = root;
      while (current && !visited.has(current.id)) {
        const cycleStart = position.get(current.id);
        if (cycleStart !== undefined) {
          const cycle = chain.slice(cycleStart);
          const winner = cycle.reduce((best, car) =>
            this.compareTrafficPriority(car, best) > 0 ? car : best);
          for (const car of cycle) {
            if (car === winner) {
              car.blockingCarId = null;
              if (car.blockingReason === 'vehicleAhead') car.blockingReason = null;
            } else {
              car.blockingCarId = winner.id;
              car.blockingReason = 'vehicleAhead';
              car.isBraking = true;
              car.speed = 0;
              car.vx = 0;
              car.vy = 0;
            }
          }
          break;
        }
        position.set(current.id, chain.length);
        chain.push(current);
        current = current.blockingCarId ? byId.get(current.blockingCarId) : undefined;
      }
      for (const car of chain) visited.add(car.id);
    }
  }

  private transitionSpeedLimit(car: TrafficCar, transition: LaneTransition): number {
    if (transition.kind === 'straight') return car.targetSpeed * 0.95;
    const angleRatio = Math.min(1.5, transition.sweep / (Math.PI / 2));
    const turnFactor = Math.max(0.38, Math.min(0.7, 0.68 - Math.max(0, angleRatio - 0.75) * 0.22));
    const curvatureLimit = transition.maxCurvature > 1e-4 ? 6 / transition.maxCurvature : car.targetSpeed;
    return Math.max(car.targetSpeed * 0.35, Math.min(car.targetSpeed * turnFactor, curvatureLimit));
  }

  private releaseTransitionReservation(car: TrafficCar) {
    if (car.reservationZoneId !== null && this.transitionReservations.get(car.reservationZoneId)?.ownerId === car.id) {
      this.transitionReservations.delete(car.reservationZoneId);
    }
    car.reservationZoneId = null;
    car.waitingForJunction = false;
    car.waitingDuration = 0;
  }

  private recoverTrafficCar(car: TrafficCar, lane: Lane) {
    if (car.transitionPoints.length > 0) {
      car.speed = 0;
      car.vx = 0;
      car.vy = 0;
      car.stuckTimer = 0;
      car.stalledWindowCount = 0;
      car.recoveryCount++;
      return;
    }
    this.releaseTransitionReservation(car);
    car.transitionPoints = [];
    car.transitionIndex = 0;
    car.nextLaneId = null;
    car.activeTransitionId = null;
    const recoveredProgress = Math.max(0, Math.min(1, car.laneProgress) - 6 / Math.max(1, lane.length));
    const recoveredX = lane.start.x + (lane.end.x - lane.start.x) * recoveredProgress;
    const recoveredY = lane.start.y + (lane.end.y - lane.start.y) * recoveredProgress;
    const recoveredCircles = vehicleCollisionCircles({ ...car, x: recoveredX, y: recoveredY, angle: lane.angle });
    const occupied = this.trafficCars.some(other => other.id !== car.id &&
      Math.hypot(other.x - recoveredX, other.y - recoveredY) < 80 &&
      recoveredCircles.some(circle => vehicleCollisionCircles(other).some(otherCircle =>
        Math.hypot(circle.x - otherCircle.x, circle.y - otherCircle.y) < circle.radius + otherCircle.radius + 2)));
    if (!occupied) {
      car.laneProgress = recoveredProgress;
      car.x = recoveredX;
      car.y = recoveredY;
    }
    car.angle = lane.angle;
    car.vx = 0;
    car.vy = 0;
    car.speed = 0;
    car.stuckTimer = 0;
    if (!occupied) car.recoveryCount++;
  }

  public getTransitionReservations(): ReadonlyMap<string, TransitionReservation> {
    return this.transitionReservations;
  }

  private getBlockingReservation(transition: LaneTransition, ownerId: string) {
    const conflicts = this.transitionConflicts.get(transition.id) ?? new Set([transition.id]);
    let strongest: { zoneId: string; reservation: TransitionReservation } | null = null;
    for (const [zoneId, reservation] of this.transitionReservations) {
      if (reservation.ownerId !== ownerId && conflicts.has(reservation.transitionId)) {
        const owner = this.trafficCars.find(car => car.id === reservation.ownerId);
        const previous = strongest && this.trafficCars.find(car => car.id === strongest.reservation.ownerId);
        if (!strongest || (owner && previous && this.compareTrafficPriority(owner, previous) > 0)) {
          strongest = { zoneId, reservation };
        }
      }
    }
    return strongest;
  }

  public getLaneTransition(fromLaneId: string, toLaneId: string): LaneTransition | undefined {
    return this.transitionByPair.get(`${fromLaneId}->${toLaneId}`);
  }

  private buildLaneTransitions() {
    this.laneTransitions = [];
    this.transitionByPair.clear();
    this.outgoingTransitions.clear();
    for (const from of this.lanes) {
      for (const toId of this.outgoingLanes.get(from.toNodeId) ?? []) {
        const to = this.laneById.get(toId);
        if (!to) continue;
        const transition = this.createLaneTransition(from, to);
        if (!transition) continue;
        this.laneTransitions.push(transition);
        this.transitionByPair.set(`${from.id}->${to.id}`, transition);
        const outgoing = this.outgoingTransitions.get(from.id) ?? [];
        outgoing.push(transition);
        this.outgoingTransitions.set(from.id, outgoing);
      }
    }
    this.buildTransitionConflicts();
  }

  private buildTransitionConflicts() {
    this.transitionConflicts.clear();
    for (const transition of this.laneTransitions) this.transitionConflicts.set(transition.id, new Set([transition.id]));
    const byJunction = new Map<string, LaneTransition[]>();
    for (const transition of this.laneTransitions) {
      if (!transition.junctionId) continue;
      const group = byJunction.get(transition.junctionId) ?? [];
      group.push(transition);
      byJunction.set(transition.junctionId, group);
    }
    for (const transitions of byJunction.values()) {
      for (let a = 0; a < transitions.length; a++) {
        for (let b = a + 1; b < transitions.length; b++) {
          if (!this.transitionPathsConflict(transitions[a], transitions[b])) continue;
          this.transitionConflicts.get(transitions[a].id)!.add(transitions[b].id);
          this.transitionConflicts.get(transitions[b].id)!.add(transitions[a].id);
        }
      }
    }
    for (const transition of this.laneTransitions) {
      transition.conflictingTransitionIds = [...(this.transitionConflicts.get(transition.id) ?? [])];
    }
  }

  private transitionPathsConflict(a: LaneTransition, b: LaneTransition): boolean {
    if (a.fromLaneId === b.fromLaneId || a.toLaneId === b.toLaneId) return true;
    const regions = (transition: LaneTransition): Point[][] => {
      const from = this.laneById.get(transition.fromLaneId)!;
      const path = [from.end, ...transition.points];
      if (transition.kind !== 'roundabout') return [path];
      return [this.pathSection(path, 72, false), this.pathSection(path, 72, true)];
    };
    for (const pathA of regions(a)) {
      for (const pathB of regions(b)) {
        if (this.polylinesConflict(pathA, pathB, 32) || this.transitionFootprintsConflict(pathA, pathB)) return true;
      }
    }
    return false;
  }

  private transitionFootprintsConflict(pathA: Point[], pathB: Point[]): boolean {
    // Path centerlines alone miss the front/rear of long cars cutting across a bend.
    const samples = (path: Point[]) => {
      const stride = Math.max(1, Math.ceil(path.length / 36));
      return path.filter((_point, index) => index % stride === 0 || index === path.length - 1)
        .map((point, index, sampled) => {
          const next = sampled[Math.min(index + 1, sampled.length - 1)];
          const previous = sampled[Math.max(0, index - 1)];
          return vehicleCollisionCircles({ ...point,
            angle: Math.atan2(next.y - previous.y, next.x - previous.x), length: 58, width: 28 });
        });
    };
    const aCircles = samples(pathA);
    const bCircles = samples(pathB);
    for (let a = 0; a < aCircles.length; a++) {
      for (let b = 0; b < bCircles.length; b++) {
        for (const circle of aCircles[a]) {
          for (const other of bCircles[b]) {
            if (Math.hypot(circle.x - other.x, circle.y - other.y) < circle.radius + other.radius + 6) return true;
          }
        }
      }
    }
    return false;
  }

  private pathSection(path: Point[], maxLength: number, fromEnd: boolean): Point[] {
    const source = fromEnd ? [...path].reverse() : path;
    const result = [source[0]];
    let length = 0;
    for (let index = 1; index < source.length; index++) {
      const step = Math.hypot(source[index].x - source[index - 1].x, source[index].y - source[index - 1].y);
      length += step;
      result.push(source[index]);
      if (length >= maxLength) break;
    }
    return fromEnd ? result.reverse() : result;
  }

  private polylinesConflict(a: Point[], b: Point[], clearance: number): boolean {
    const sample = (path: Point[]) => {
      const stride = Math.max(1, Math.ceil(path.length / 36));
      const result = path.filter((_point, index) => index % stride === 0);
      if (result[result.length - 1] !== path[path.length - 1]) result.push(path[path.length - 1]);
      return result;
    };
    const pathA = sample(a);
    const pathB = sample(b);
    for (let ai = 0; ai < pathA.length - 1; ai++) {
      for (let bi = 0; bi < pathB.length - 1; bi++) {
        if (segmentIntersection(pathA[ai], pathA[ai + 1], pathB[bi], pathB[bi + 1])) return true;
        const near = Math.min(
          closestPointOnSegment(pathA[ai], pathB[bi], pathB[bi + 1]).distance,
          closestPointOnSegment(pathA[ai + 1], pathB[bi], pathB[bi + 1]).distance,
          closestPointOnSegment(pathB[bi], pathA[ai], pathA[ai + 1]).distance,
          closestPointOnSegment(pathB[bi + 1], pathA[ai], pathA[ai + 1]).distance,
        );
        if (near < clearance) return true;
      }
    }
    return false;
  }

  private createLaneTransition(from: Lane, to: Lane): LaneTransition | null {
    const node = this.roadNodes[from.toNodeId];
    if (!node || to.fromNodeId !== node.id) return null;
    const signedTurn = normalizeAngle(to.angle - from.angle);
    const sweep = Math.abs(signedTurn);
    // Reversing back over the same edge (or any near-opposite movement) is a
    // U-turn. No road in the current model opts into that movement.
    if (to.edgeId === from.edgeId || sweep > Math.PI * 0.76) return null;
    const roundabout = this.roundabouts.find(rb => Math.hypot(rb.x - node.x, rb.y - node.y) < 2);
    const points: Point[] = [];
    if (roundabout) {
      const directedSweep = (start: number, end: number, direction: 1 | -1) => {
        let delta = normalizeAngle(end - start);
        if (direction > 0 && delta < 0) delta += Math.PI * 2;
        if (direction < 0 && delta > 0) delta -= Math.PI * 2;
        return delta;
      };
      // A roundabout has exactly one legal circulation direction. A longer arc
      // is valid only when the requested exit lies farther along that direction.
      const direction = -1 as const;
      const entryAngle = Math.atan2(from.end.y - roundabout.y, from.end.x - roundabout.x);
      const exitAngle = Math.atan2(to.start.y - roundabout.y, to.start.x - roundabout.x);
      const delta = directedSweep(entryAngle, exitAngle, direction);
      if (Math.abs(delta) > Math.PI * 1.75) return null;
      const entry = {
        x: roundabout.x + Math.cos(entryAngle) * roundabout.radius,
        y: roundabout.y + Math.sin(entryAngle) * roundabout.radius,
      };
      const exit = {
        x: roundabout.x + Math.cos(exitAngle) * roundabout.radius,
        y: roundabout.y + Math.sin(exitAngle) * roundabout.radius,
      };
      const appendCubic = (a: Point, c1: Point, c2: Point, b: Point) => {
        for (let i = 1; i <= 512; i++) {
          const t = i / 512;
          const u = 1 - t;
          points.push({
            x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x,
            y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y,
          });
        }
      };
      const entryDistance = Math.hypot(entry.x - from.end.x, entry.y - from.end.y);
      const entryControl = Math.min(58, Math.max(roundabout.width * 0.24, entryDistance * 0.42));
      const entryTangent = entryAngle + direction * Math.PI / 2;
      appendCubic(
        from.end,
        { x: from.end.x + Math.cos(from.angle) * entryControl, y: from.end.y + Math.sin(from.angle) * entryControl },
        { x: entry.x - Math.cos(entryTangent) * entryControl, y: entry.y - Math.sin(entryTangent) * entryControl },
        entry,
      );
      const steps = Math.max(10, Math.ceil(Math.abs(delta) * 28));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const angle = entryAngle + delta * t;
        points.push({
          x: roundabout.x + Math.cos(angle) * roundabout.radius,
          y: roundabout.y + Math.sin(angle) * roundabout.radius,
        });
      }
      const exitDistance = Math.hypot(to.start.x - exit.x, to.start.y - exit.y);
      const exitControl = Math.min(58, Math.max(roundabout.width * 0.24, exitDistance * 0.42));
      const exitTangent = exitAngle + direction * Math.PI / 2;
      appendCubic(
        exit,
        { x: exit.x + Math.cos(exitTangent) * exitControl, y: exit.y + Math.sin(exitTangent) * exitControl },
        { x: to.start.x - Math.cos(to.angle) * exitControl, y: to.start.y - Math.sin(to.angle) * exitControl },
        to.start,
      );
      points[points.length - 1] = { ...to.start };
      const circularLane = this.circularLanes.find(lane =>
        lane.junctionId === node.junctionId &&
        lane.direction === (direction > 0 ? 'clockwise' : 'counterclockwise'));
      return this.makeTransition(
        from, to, points, 'roundabout', Math.abs(delta), node.junctionId, circularLane?.id ?? null,
      );
    }

    // Разрезы ребра у парковочных въездов не должны заставлять поток делать
    // микропетлю через геометрический центр дороги.
    if (from.roadId === to.roadId && sweep < 0.05) {
      return this.makeTransition(from, to, [{ ...to.start }], 'straight', sweep, node.junctionId);
    }
    const chord = Math.hypot(to.start.x - from.end.x, to.start.y - from.end.y);
    const control = Math.max(12, Math.min(68, chord * 0.42));
    const c1 = { x: from.end.x + Math.cos(from.angle) * control, y: from.end.y + Math.sin(from.angle) * control };
    const c2 = { x: to.start.x - Math.cos(to.angle) * control, y: to.start.y - Math.sin(to.angle) * control };
    for (let index = 1; index <= 64; index++) {
      const t = index / 64;
      const u = 1 - t;
      points.push({
        x: u ** 3 * from.end.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * to.start.x,
        y: u ** 3 * from.end.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * to.start.y,
      });
    }
    points[points.length - 1] = { ...to.start };
    const kind = sweep < 0.12 ? 'straight' : signedTurn < 0 ? 'right' : 'left';
    return this.makeTransition(from, to, points, kind, sweep, node.junctionId);
  }

  private makeTransition(
    from: Lane,
    to: Lane,
    points: Point[],
    kind: LaneTransition['kind'],
    sweep: number,
    junctionId: string | null,
    circularLaneId: string | null = null,
  ): LaneTransition {
    let length = 0;
    let previous = from.end;
    for (const point of points) {
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
    }
    const id = `transition:${from.id}->${to.id}`;
    const path = [from.end, ...points];
    let maxCurvature = 0;
    for (let index = 1; index < path.length - 1; index++) {
      const before = Math.atan2(path[index].y - path[index - 1].y, path[index].x - path[index - 1].x);
      const after = Math.atan2(path[index + 1].y - path[index].y, path[index + 1].x - path[index].x);
      const span = Math.max(0.5, (
        Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y) +
        Math.hypot(path[index + 1].x - path[index].x, path[index + 1].y - path[index].y)
      ) / 2);
      maxCurvature = Math.max(maxCurvature, Math.abs(normalizeAngle(after - before)) / span);
    }
    return {
      id,
      fromLaneId: from.id,
      toLaneId: to.id,
      junctionId,
      kind,
      points,
      length,
      startTangent: from.angle,
      endTangent: to.angle,
      sweep,
      conflictZoneId: junctionId ? `conflict:${id}` : null,
      circularLaneId,
      conflictingTransitionIds: [],
      maxCurvature,
    };
  }

  /**
   * 5. ПРОВЕРКА ГРАНИЦЫ ОСТРОВА (Береговая линия и силовой барьер)
   * Машина больше не может вылететь в пустую тьму за пределы суши!
   */
  public checkIslandBoundary(
    x: number,
    y: number,
    radius: number
  ): { hit: boolean; normalX: number; normalY: number; overlap: number } | null {
    const point = { x, y };
    if (this.isPointInsideDrivableSurface(x, y, radius)) return null;

    const candidates: Contact[] = [];
    const mainlandPolygon = this.getMainlandPolygon();
    const airportIsland = this.getAirportIsland();
    const mainlandBoundary = closestPointOnPolygon(point, mainlandPolygon);
    const insideMainland = pointInPolygon(point, mainlandPolygon);
    const mainlandPushX = insideMainland ? x - mainlandBoundary.x : mainlandBoundary.x - x;
    const mainlandPushY = insideMainland ? y - mainlandBoundary.y : mainlandBoundary.y - y;
    const mainlandDistance = Math.hypot(mainlandPushX, mainlandPushY);
    candidates.push({
      hit: true,
      normalX: mainlandPushX / (mainlandDistance || 1),
      normalY: mainlandPushY / (mainlandDistance || 1),
      overlap: insideMainland ? Math.max(0, radius - mainlandBoundary.distance) : mainlandBoundary.distance + radius,
    });

    const ellipseContact = (ellipse: typeof BASE_AIRPORT_ISLAND) => {
      const cos = Math.cos(ellipse.angle);
      const sin = Math.sin(ellipse.angle);
      const dx = x - ellipse.x;
      const dy = y - ellipse.y;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const rx = ellipse.radiusX - radius;
      const ry = ellipse.radiusY - radius;
      const norm = Math.sqrt((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry));
      if (norm <= 1 || norm < 1e-6) return;
      const boundaryX = lx / norm;
      const boundaryY = ly / norm;
      const worldX = ellipse.x + boundaryX * cos - boundaryY * sin;
      const worldY = ellipse.y + boundaryX * sin + boundaryY * cos;
      const pushX = worldX - x;
      const pushY = worldY - y;
      const distance = Math.hypot(pushX, pushY);
      candidates.push({ hit: true, normalX: pushX / (distance || 1), normalY: pushY / (distance || 1), overlap: distance });
    };
    ellipseContact(airportIsland);

    for (const seg of this.roadSegments) {
      const nearest = closestPointOnSegment(point, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 });
      const allowed = Math.max(1, seg.width / 2 - radius);
      if (nearest.distance <= allowed) return null;
      const pushX = nearest.x - x;
      const pushY = nearest.y - y;
      const distance = Math.hypot(pushX, pushY);
      candidates.push({
        hit: true,
        normalX: pushX / (distance || 1),
        normalY: pushY / (distance || 1),
        overlap: Math.max(0, nearest.distance - allowed),
      });
    }

    for (const roundabout of this.roundabouts) {
      const dx = x - roundabout.x;
      const dy = y - roundabout.y;
      const distance = Math.hypot(dx, dy) || 1;
      const inner = roundabout.radius - roundabout.width / 2 + 10 + radius;
      const outer = roundabout.radius + roundabout.width / 2 - radius;
      if (distance >= inner && distance <= outer) return null;
      if (distance < inner) {
        candidates.push({ hit: true, normalX: dx / distance, normalY: dy / distance, overlap: inner - distance });
      } else {
        candidates.push({ hit: true, normalX: -dx / distance, normalY: -dy / distance, overlap: distance - outer });
      }
    }

    return candidates.reduce<Contact | null>(
      (best, candidate) => !best || candidate.overlap < best.overlap ? candidate : best,
      null,
    );
  }

  public findClosestRoadNode(x: number, y: number): RoadNode {
    let closest = this.roadNodes[0];
    let minDist = Infinity;
    for (const node of this.roadNodes) {
      const dist = Math.hypot(node.x - x, node.y - y);
      if (dist < minDist) {
        minDist = dist;
        closest = node;
      }
    }
    return closest;
  }

  public isPointOnRoad(x: number, y: number, margin = 0): boolean {
    for (const roundabout of this.roundabouts) {
      const distance = Math.hypot(x - roundabout.x, y - roundabout.y);
      const inner = roundabout.radius - roundabout.width / 2 + 10 - margin;
      const outer = roundabout.radius + roundabout.width / 2 + margin;
      if (distance <= outer) return distance >= inner;
    }
    return this.roadSegments.some(segment => pointInRoadCorridor(
      { x, y },
      { x: segment.x1, y: segment.y1 },
      { x: segment.x2, y: segment.y2 },
      segment.width,
      margin,
    ));
  }

  private isPointInParkingAccess(point: Point, margin = 0): boolean {
    return this.parkingZones.some(zone => {
      const access = this.getParkingAccessGeometry(zone);
      return access ? pointInRotatedRect(point, access.apron, margin) : false;
    });
  }

  private isPointInFuelStationAccess(point: Point, margin = 0): boolean {
    return this.fuelStations.some(station => {
      const zone = this.fuelStationZone(station);
      const access = this.getParkingAccessGeometry(zone);
      return pointInRotatedRect(point, zone, margin) ||
        Boolean(access && pointInRotatedRect(point, access.apron, margin));
    });
  }

  public isPointOnLand(x: number, y: number, inset = 0): boolean {
    const point = { x, y };
    const mainlandPolygon = this.getMainlandPolygon();
    return (pointInPolygon(point, mainlandPolygon) &&
      closestPointOnPolygon(point, mainlandPolygon).distance >= inset) ||
      pointInRotatedEllipse(point, this.getAirportIsland(), -inset);
  }

  public isPointInsideDrivableSurface(x: number, y: number, inset = 0): boolean {
    const point = { x, y };
    return this.isPointOnLand(x, y, inset) ||
      this.isPointOnRoad(x, y, -inset) ||
      this.parkingZones.some(zone => pointInRotatedRect(point, zone, -inset)) ||
      this.isPointInParkingAccess(point, -inset) ||
      this.isPointInFuelStationAccess(point, -inset);
  }

  public findGpsRoute(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    carAngle = 0,
  ): GpsRoute {
    const carPoint = { x: startX, y: startY };
    let startLane = this.lanes[0];
    let startProjection = closestPointOnSegment(carPoint, startLane.start, startLane.end);
    let bestStartScore = Infinity;
    const laneCandidates = this.lanes.map(lane => ({
      lane,
      projection: closestPointOnSegment(carPoint, lane.start, lane.end),
    }));
    const nearestLaneDistance = Math.min(...laneCandidates.map(candidate => candidate.projection.distance));
    for (const { lane, projection } of laneCandidates) {
      if (projection.distance > nearestLaneDistance + 72) continue;
      const headingAgreement = Math.cos(normalizeAngle(lane.angle - carAngle));
      const headingPenalty = (1 - headingAgreement) * 170 + (headingAgreement < 0 ? -headingAgreement * 650 : 0);
      const alleyPenalty = this.getRoad(lane.roadId)?.kind === 'alley' ? 4 : 0;
      const score = projection.distance + headingPenalty + alleyPenalty;
      if (score < bestStartScore) {
        bestStartScore = score;
        startLane = lane;
        startProjection = projection;
      }
    }

    const matchingZone = this.parkingZones.find(zone => Math.hypot(zone.x - targetX, zone.y - targetY) < 2);
    let targetNode = this.findClosestRoadNode(targetX, targetY);
    if (matchingZone) {
      const segment = this.roadSegments.find(candidate => candidate.id === matchingZone.accessRoadSegmentId);
      if (segment) {
        const accessPoint = closestPointOnSegment(matchingZone, { x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 });
        targetNode = this.findClosestRoadNode(accessPoint.x, accessPoint.y);
      }
    }

    const distances = new Map<string, number>([[startLane.id, startProjection.distance]]);
    const previous = new Map<string, { laneId: string; transitionId: string }>();
    const unvisited = new Set(this.lanes.map(lane => lane.id));
    let finalLaneId: string | null = null;
    let bestFinalCost = Infinity;
    const laneMultiplier = (lane: Lane) => this.getRoad(lane.roadId)?.kind === 'alley' ? 1.02 : 1;

    while (unvisited.size > 0) {
      let currentId: string | null = null;
      let currentCost = Infinity;
      for (const laneId of unvisited) {
        const cost = distances.get(laneId) ?? Infinity;
        if (cost < currentCost) {
          currentCost = cost;
          currentId = laneId;
        }
      }
      if (currentId === null || currentCost >= bestFinalCost) break;
      unvisited.delete(currentId);
      const current = this.laneById.get(currentId)!;
      const startT = currentId === startLane.id ? startProjection.t : 0;
      const arrivalCost = currentCost + current.length * (1 - startT) * laneMultiplier(current);
      if (current.toNodeId === targetNode.id && arrivalCost < bestFinalCost) {
        bestFinalCost = arrivalCost;
        finalLaneId = currentId;
      }

      for (const transition of this.outgoingTransitions.get(current.id) ?? []) {
        const next = this.laneById.get(transition.toLaneId)!;
        const turnPenalty = transition.kind === 'straight' ? 0 : 34 * (transition.sweep / Math.PI);
        const nextCost = arrivalCost + transition.length + turnPenalty;
        const nextId = next.id;
        if (nextCost < (distances.get(nextId) ?? Infinity)) {
          distances.set(nextId, nextCost);
          previous.set(nextId, { laneId: currentId, transitionId: transition.id });
        }
      }
    }

    if (finalLaneId === null) {
      return {
        points: [carPoint, { x: targetX, y: targetY }],
        laneIds: [],
        transitionIds: [],
        cost: Math.hypot(targetX - startX, targetY - startY),
        startLaneId: startLane.id,
        startLaneAngle: startLane.angle,
      };
    }

    const laneIds: string[] = [];
    const transitionIds: string[] = [];
    for (let laneId: string | undefined = finalLaneId; laneId !== undefined;) {
      laneIds.unshift(laneId);
      if (laneId === startLane.id) break;
      const prior = previous.get(laneId);
      if (!prior) break;
      transitionIds.unshift(prior.transitionId);
      laneId = prior.laneId;
    }
    const points: Point[] = [];
    const addPoint = (point: Point) => {
      const last = points[points.length - 1];
      if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 0.5) points.push({ ...point });
    };
    addPoint(carPoint);
    addPoint(startProjection);
    laneIds.forEach((laneId, index) => {
      const lane = this.laneById.get(laneId)!;
      if (index > 0) {
        const transition = this.transitionByPair.get(`${laneIds[index - 1]}->${laneId}`);
        for (const point of transition?.points ?? []) addPoint(point);
      }
      addPoint(lane.end);
    });
    addPoint(targetNode);
    addPoint({ x: targetX, y: targetY });
    return {
      points,
      laneIds,
      transitionIds,
      cost: bestFinalCost +
        Math.hypot(this.laneById.get(finalLaneId)!.end.x - targetNode.x, this.laneById.get(finalLaneId)!.end.y - targetNode.y) +
        Math.hypot(targetX - targetNode.x, targetY - targetNode.y),
      startLaneId: startLane.id,
      startLaneAngle: startLane.angle,
    };
  }

  public findGpsPath(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    carAngle = 0,
  ): Point[] {
    return this.getGpsRoute(startX, startY, targetX, targetY, carAngle).points;
  }

  public getGpsRoute(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    carAngle = 0,
  ): GpsRoute {
    const destinationChanged = !this.gpsCache ||
      Math.hypot(this.gpsCache.targetX - targetX, this.gpsCache.targetY - targetY) > 2;
    const routeInvalid = !this.gpsCache ||
      this.gpsCache.route.laneIds.some(id => !this.laneById.has(id));
    let offRoute = false;
    if (this.gpsCache && this.gpsCache.route.points.length > 1) {
      offRoute = this.gpsCache.route.points.slice(0, -1).reduce((best, point, index) =>
        Math.min(best, closestPointOnSegment(
          { x: startX, y: startY },
          point,
          this.gpsCache!.route.points[index + 1],
        ).distance), Infinity) > 140;
    }
    if (destinationChanged || routeInvalid || offRoute) {
      this.gpsCache = {
        targetX,
        targetY,
        route: this.findGpsRoute(startX, startY, targetX, targetY, carAngle),
        progress: 0,
      };
    }
    return this.gpsCache.route;
  }

  private projectOntoGpsRoute(
    point: Point,
    points: Point[],
    heading: number,
    minimumProgress: number,
  ): GpsRouteProjection | null {
    if (points.length < 2) return null;
    const candidates: Array<GpsRouteProjection & { headingDelta: number }> = [];
    let cumulative = 0;
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index];
      const end = points[index + 1];
      const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
      const projection = closestPointOnSegment(point, start, end);
      const progress = cumulative + segmentLength * projection.t;
      if (progress + 1e-6 >= minimumProgress) {
        candidates.push({
          point: { x: projection.x, y: projection.y },
          segmentIndex: index,
          distance: projection.distance,
          progress,
          headingDelta: Math.abs(normalizeAngle(Math.atan2(end.y - start.y, end.x - start.x) - heading)),
        });
      }
      cumulative += segmentLength;
    }
    if (candidates.length === 0) return null;
    const nearestDistance = Math.min(...candidates.map(candidate => candidate.distance));
    const nearby = candidates.filter(candidate => candidate.distance <= nearestDistance + 18);
    const best = nearby.reduce((current, candidate) => {
      const currentScore = current.distance + (1 - Math.cos(current.headingDelta)) * 24;
      const candidateScore = candidate.distance + (1 - Math.cos(candidate.headingDelta)) * 24;
      if (candidateScore < currentScore - 1e-6) return candidate;
      if (Math.abs(candidateScore - currentScore) <= 1e-6 && candidate.progress > current.progress) return candidate;
      return current;
    });
    return best;
  }

  public getRemainingGpsRoute(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    carAngle = 0,
  ): Point[] {
    let route = this.getGpsRoute(startX, startY, targetX, targetY, carAngle);
    let cache = this.gpsCache!;
    let projection = this.projectOntoGpsRoute(
      { x: startX, y: startY },
      route.points,
      carAngle,
      cache.progress,
    );
    if (projection && projection.distance > 140) {
      route = this.findGpsRoute(startX, startY, targetX, targetY, carAngle);
      this.gpsCache = { targetX, targetY, route, progress: 0 };
      cache = this.gpsCache;
      projection = this.projectOntoGpsRoute({ x: startX, y: startY }, route.points, carAngle, 0);
    }
    if (!projection) return route.points.map(point => ({ ...point }));
    cache.progress = Math.max(cache.progress, projection.progress);
    const remaining = [projection.point, ...route.points.slice(projection.segmentIndex + 1)];
    if (remaining.length > 1 && Math.hypot(
      remaining[1].x - remaining[0].x,
      remaining[1].y - remaining[0].y,
    ) < 0.5) remaining.splice(1, 1);
    return remaining;
  }

  public invalidateGpsRoute() {
    this.gpsCache = null;
  }

  public getNextGpsWaypoint(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    carAngle = 0,
  ): Point {
    const points = this.getRemainingGpsRoute(startX, startY, targetX, targetY, carAngle);
    const lookAhead = 100;
    let travelled = 0;
    for (let index = 1; index < points.length; index++) {
      const segmentLength = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
      if (travelled + segmentLength >= lookAhead) {
        const t = segmentLength > 0 ? (lookAhead - travelled) / segmentLength : 0;
        return {
          x: points[index - 1].x + (points[index].x - points[index - 1].x) * t,
          y: points[index - 1].y + (points[index].y - points[index - 1].y) * t,
        };
      }
      travelled += segmentLength;
    }
    return points[points.length - 1] ?? { x: targetX, y: targetY };
  }

  public checkCollision(
    x: number,
    y: number,
    radius: number
  ): { hit: boolean; normalX: number; normalY: number; overlap: number } | null {
    return this.checkCirclesAgainstWorld([{ x, y, radius }]);
  }

  public checkVehicleCollision(vehicle: {
    x: number; y: number; angle: number; length: number; width: number;
  }): Contact | null {
    return this.checkCirclesAgainstWorld(vehicleCollisionCircles(vehicle));
  }

  private checkCirclesAgainstWorld(circles: CollisionCircle[]): Contact | null {
    let best: Contact | null = null;
    for (const circle of circles) {
      for (const building of this.buildings) {
        const contact = circleVsAxisAlignedRect(circle, building);
        if (contact && (!best || contact.overlap > best.overlap)) best = contact;
      }
      for (const roundabout of this.roundabouts) {
        const innerRadius = Math.max(18, roundabout.radius - roundabout.width / 2 + 10);
        const contact = circleVsCircle(circle, { x: roundabout.x, y: roundabout.y, radius: innerRadius });
        if (contact && (!best || contact.overlap > best.overlap)) best = contact;
      }
    }
    return best;
  }

  /**
   * 6. КОЛЛИЗИЯ ИГРОКА С НАЗЕМНЫМИ МАШИНАМИ ТРАФИКА
   * Машины трафика становятся реальной преградой для доставки!
   */
  public checkTrafficCollision(
    vehicle: { x: number; y: number; angle: number; length: number; width: number }
  ): ({ hitCar: TrafficCar } & Contact) | null {
    const playerCircles = vehicleCollisionCircles(vehicle);
    let best: ({ hitCar: TrafficCar } & Contact) | null = null;
    for (const bot of this.trafficCars) {
      const botCircles = vehicleCollisionCircles(bot);
      for (const playerCircle of playerCircles) {
        for (const botCircle of botCircles) {
          const contact = circleVsCircle(playerCircle, botCircle);
          if (contact && (!best || contact.overlap > best.overlap)) {
            best = { hitCar: bot, ...contact };
          }
        }
      }
    }
    return best;
  }

  /**
   * 7. ОБНОВЛЕНИЕ ДВИЖЕНИЯ И ИНТЕЛЛЕКТА ТРАФИКА
   */
  public update(dt: number, playerCar?: {
    x: number; y: number; speed: number; angle: number; length: number; width: number;
  }) {
    this.animTimer += dt;

    // Reservations are leases, so a removed or stalled owner cannot hold a
    // conflict zone forever.
    for (const [zoneId, reservation] of this.transitionReservations) {
      const owner = this.trafficCars.find(car => car.id === reservation.ownerId);
      const ownerLane = owner ? this.laneById.get(owner.currentLaneId) : undefined;
      const planned = owner && ownerLane && owner.nextLaneId
        ? this.getLaneTransition(ownerLane.id, owner.nextLaneId)
        : null;
      const clearing = Boolean(owner && ownerLane && owner.activeTransitionId === null &&
        owner.reservationZoneId === zoneId && owner.laneProgress * ownerLane.length <= owner.length + 28);
      const ownsTrajectory = owner?.activeTransitionId === reservation.transitionId || planned?.id === reservation.transitionId || clearing;
      if (!owner || owner.reservationZoneId !== zoneId || !ownsTrajectory || reservation.expiresAt <= this.animTimer) {
        this.transitionReservations.delete(zoneId);
        if (owner?.reservationZoneId === zoneId) owner.reservationZoneId = null;
      }
    }

    // Светофоры
    for (const tl of this.trafficLights) {
      tl.timer += dt;
      if (tl.timer > 8) {
        tl.timer = 0;
        tl.state = tl.state === 'green' ? 'red' : 'green';
      }
    }

    // Наземный трафик движется по направленным полосам и непрерывным переходам.
    for (let i = 0; i < this.trafficCars.length; i++) {
      const bot = this.trafficCars[i];
      const previousX = bot.x;
      const previousY = bot.y;
      const previousAngle = bot.angle;
      const lane = this.laneById.get(bot.currentLaneId);
      if (!lane) continue;
      if (bot.reservationZoneId && bot.transitionPoints.length === 0 &&
          bot.laneProgress * lane.length > bot.length + 28) {
        this.releaseTransitionReservation(bot);
      }
      let shouldBrake = false;
      bot.waitingForJunction = false;
      bot.blockingReason = null;
      bot.blockingCarId = null;
      const distanceToJunction = lane.length * (1 - bot.laneProgress);

      if (bot.transitionPoints.length === 0 && bot.nextLaneId === null && distanceToJunction < 230) {
        bot.nextLaneId = this.chooseNextLane(bot, lane)?.id ?? null;
      }
      const plannedTransition = bot.nextLaneId === null
        ? null
        : this.getLaneTransition(lane.id, bot.nextLaneId) ?? null;

      if (playerCar) {
        const projection = closestPointOnSegment(playerCar, lane.start, lane.end);
        const gap = (projection.t - bot.laneProgress) * lane.length;
        if (bot.transitionPoints.length === 0 && projection.distance < lane.width * 0.55 && gap > 0 && gap < 145) {
          shouldBrake = true;
          bot.blockingReason = 'vehicleAhead';
          bot.blockingCarId = 'player';
          bot.honkTimer += dt;
          if (bot.honkTimer > 1.8) {
            AudioEngine.getInstance().playHonkSound();
            bot.honkTimer = 0;
          }
        }
      }

      let trafficBlocker: TrafficCar | null = null;
      for (let j = 0; j < this.trafficCars.length; j++) {
        if (i === j) continue;
        const other = this.trafficCars[j];
        const followingGap = Math.max(82, bot.length * 1.35 + bot.speed * 0.38);
        const sameLaneAhead = bot.transitionPoints.length === 0 &&
          other.transitionPoints.length === 0 &&
          other.currentLaneId === bot.currentLaneId &&
          other.laneProgress > bot.laneProgress &&
          (other.laneProgress - bot.laneProgress) * lane.length < followingGap;
        const sameTurnAhead = bot.transitionPoints.length > 0 && other.transitionPoints.length > 0 &&
          bot.activeTransitionId === other.activeTransitionId &&
          other.transitionIndex > bot.transitionIndex &&
          Math.hypot(other.x - bot.x, other.y - bot.y) < 95;
        const activeTransition = bot.activeTransitionId
          ? this.laneTransitions.find(transition => transition.id === bot.activeTransitionId)
          : null;
        const otherTransition = other.activeTransitionId
          ? this.laneTransitions.find(transition => transition.id === other.activeTransitionId)
          : null;
        const sameCircularLaneAhead = Boolean(
          activeTransition?.circularLaneId &&
          activeTransition.circularLaneId === otherTransition?.circularLaneId &&
          Math.hypot(other.x - bot.x, other.y - bot.y) < 82 &&
          (other.x - bot.x) * Math.cos(bot.angle) + (other.y - bot.y) * Math.sin(bot.angle) > 0,
        );
        const crossLaneConflict = !sameLaneAhead && !sameTurnAhead && !sameCircularLaneAhead &&
          this.yieldsForCrossLaneConflict(bot, other);
        if (sameLaneAhead || sameTurnAhead || sameCircularLaneAhead || crossLaneConflict) {
          shouldBrake = true;
          if (!trafficBlocker || this.compareTrafficPriority(other, trafficBlocker) > 0) trafficBlocker = other;
        }
      }
      if (trafficBlocker) {
        bot.blockingReason = 'vehicleAhead';
        bot.blockingCarId = trafficBlocker.id;
      }

      if (bot.transitionPoints.length === 0 && plannedTransition?.conflictZoneId && distanceToJunction < 180) {
        const zoneId = plannedTransition.conflictZoneId;
        const blocker = this.getBlockingReservation(plannedTransition, bot.id);
        if (blocker) {
          shouldBrake = true;
          bot.waitingForJunction = true;
          bot.blockingReason = 'conflictZone';
          bot.blockingCarId = blocker.reservation.ownerId;
          bot.waitingDuration += dt;
        } else if (!shouldBrake && distanceToJunction < 145) {
          this.transitionReservations.set(zoneId, {
            ownerId: bot.id,
            transitionId: plannedTransition.id,
            expiresAt: this.animTimer + 6,
          });
          bot.reservationZoneId = zoneId;
          bot.waitingDuration = 0;
        }
      }

      if (bot.reservationZoneId && bot.transitionPoints.length > 0) {
        const ownLease = this.transitionReservations.get(bot.reservationZoneId);
        if (ownLease?.ownerId === bot.id) ownLease.expiresAt = this.animTimer + 6;
      }
      if (bot.waitingDuration > 5) {
        const blocker = plannedTransition ? this.getBlockingReservation(plannedTransition, bot.id) : null;
        const holder = blocker && this.trafficCars.find(car => car.id === blocker.reservation.ownerId);
        const holderStalled = holder && holder.progressWindowTime >= 3 && holder.progressWindowDistance < 4;
        if (blocker && (!holder || blocker.reservation.expiresAt <= this.animTimer || holderStalled)) {
          this.transitionReservations.delete(blocker.zoneId);
          if (holder?.reservationZoneId === blocker.zoneId) holder.reservationZoneId = null;
        }
        bot.nextLaneId = null;
        bot.waitingDuration = 0;
      }

      // Регулировка скорости
      bot.isBraking = shouldBrake;
      if (shouldBrake) {
        bot.speed = Math.max(0, bot.speed - 360 * dt);
      } else {
        bot.speed = Math.min(bot.targetSpeed, bot.speed + 120 * dt);
        bot.honkTimer = Math.max(0, bot.honkTimer - dt);
      }
      if (bot.transitionPoints.length > 0) {
        const transition = bot.activeTransitionId
          ? this.laneTransitions.find(candidate => candidate.id === bot.activeTransitionId)
          : null;
        if (transition) bot.speed = Math.min(bot.speed, this.transitionSpeedLimit(bot, transition));
      }

      const movementState = {
        currentLaneId: bot.currentLaneId,
        currentRoadId: bot.currentRoadId,
        targetNodeId: bot.targetNodeId,
        laneProgress: bot.laneProgress,
        nextLaneId: bot.nextLaneId,
        activeTransitionId: bot.activeTransitionId,
        transitionPoints: bot.transitionPoints,
        transitionIndex: bot.transitionIndex,
      };
      let remaining = bot.speed * dt;
      if (shouldBrake && bot.transitionPoints.length === 0) {
        remaining = Math.min(remaining, Math.max(0, distanceToJunction - 18));
      }
      let desiredAngle = bot.angle;
      const allowsFrameStep = (nextX: number, nextY: number) => {
        const frameMoveX = nextX - previousX;
        const frameMoveY = nextY - previousY;
        const frameDistance = Math.hypot(frameMoveX, frameMoveY);
        if (frameDistance <= 0.001) return true;
        const frameAngle = Math.atan2(frameMoveY, frameMoveX);
        const headingDelta = normalizeAngle(frameAngle - bot.angle);
        if (Math.abs(headingDelta) <= 0.12) return true;
        if (Math.hypot(bot.x - previousX, bot.y - previousY) <= 0.001) {
          bot.angle = normalizeAngle(bot.angle + Math.sign(headingDelta) * 0.12);
        }
        remaining = 0;
        return false;
      };
      for (let guard = 0; guard < 24 && remaining > 0; guard++) {
        if (bot.transitionPoints.length > 0) {
          const target = bot.transitionPoints[bot.transitionIndex];
          if (!target) {
            const next = bot.nextLaneId === null ? null : this.laneById.get(bot.nextLaneId);
            bot.transitionPoints = [];
            bot.transitionIndex = 0;
            bot.nextLaneId = null;
            bot.activeTransitionId = null;
            if (next) {
              bot.currentLaneId = next.id;
              bot.currentRoadId = next.roadId;
              bot.targetNodeId = next.toNodeId;
              bot.laneProgress = 0;
            }
            continue;
          }
          const dx = target.x - bot.x;
          const dy = target.y - bot.y;
          const distance = Math.hypot(dx, dy);
          const targetAngle = Math.atan2(dy, dx);
          desiredAngle = targetAngle;
          if (distance <= remaining + 0.001) {
            if (!allowsFrameStep(target.x, target.y)) break;
            bot.x = target.x;
            bot.y = target.y;
            remaining -= distance;
            bot.transitionIndex++;
          } else {
            const nextX = bot.x + (dx / distance) * remaining;
            const nextY = bot.y + (dy / distance) * remaining;
            if (!allowsFrameStep(nextX, nextY)) break;
            bot.x = nextX;
            bot.y = nextY;
            remaining = 0;
          }
          continue;
        }

        const activeLane = this.laneById.get(bot.currentLaneId)!;
        const distanceToEnd = activeLane.length * (1 - bot.laneProgress);
        desiredAngle = activeLane.angle;
        if (remaining < distanceToEnd) {
          const nextProgress = bot.laneProgress + remaining / Math.max(1, activeLane.length);
          const nextX = activeLane.start.x + (activeLane.end.x - activeLane.start.x) * nextProgress;
          const nextY = activeLane.start.y + (activeLane.end.y - activeLane.start.y) * nextProgress;
          if (!allowsFrameStep(nextX, nextY)) break;
          bot.laneProgress = nextProgress;
          bot.x = nextX;
          bot.y = nextY;
          remaining = 0;
        } else {
          if (!allowsFrameStep(activeLane.end.x, activeLane.end.y)) break;
          bot.x = activeLane.end.x;
          bot.y = activeLane.end.y;
          bot.laneProgress = 1;
          remaining -= distanceToEnd;
          const nextLane = bot.nextLaneId ? this.laneById.get(bot.nextLaneId) ?? null : this.chooseNextLane(bot, activeLane);
          if (!nextLane) {
            bot.speed = 0;
            bot.blockingReason = 'routeUnavailable';
            remaining = 0;
            break;
          }
          const transition = this.getLaneTransition(activeLane.id, nextLane.id);
          if (!transition) {
            bot.nextLaneId = null;
            bot.speed = 0;
            bot.blockingReason = 'routeUnavailable';
            remaining = 0;
            break;
          }
          if (transition.conflictZoneId && bot.reservationZoneId !== transition.conflictZoneId) {
            bot.speed = 0;
            bot.waitingForJunction = true;
            bot.blockingReason = 'conflictZone';
            remaining = 0;
            break;
          }
          bot.nextLaneId = nextLane.id;
          bot.activeTransitionId = transition.id;
          bot.transitionPoints = transition.points;
          bot.transitionIndex = 0;
          const transitionSpeed = this.transitionSpeedLimit(bot, transition);
          bot.speed = Math.min(bot.speed, transitionSpeed);
          remaining = Math.min(remaining, transitionSpeed * dt);
        }
      }
      const proposedCircles = vehicleCollisionCircles(bot);
      const collidingCar = this.trafficCars.filter(other => other.id !== bot.id &&
        Math.hypot(other.x - bot.x, other.y - bot.y) < 80 &&
        proposedCircles.some(circle => vehicleCollisionCircles(other).some(otherCircle =>
          Math.hypot(otherCircle.x - circle.x, otherCircle.y - circle.y) <
          circle.radius + otherCircle.radius)))
        .sort((a, b) => this.compareTrafficPriority(b, a))[0];
      if (collidingCar && Math.hypot(bot.x - previousX, bot.y - previousY) > 0.001) {
        Object.assign(bot, movementState);
        bot.x = previousX;
        bot.y = previousY;
        bot.angle = previousAngle;
        bot.isBraking = true;
        bot.blockingReason = 'vehicleAhead';
        bot.blockingCarId = collidingCar.id;
        bot.speed = Math.max(0, bot.speed - 360 * dt);
      }
      const movedX = bot.x - previousX;
      const movedY = bot.y - previousY;
      const trajectoryAngle = Math.hypot(movedX, movedY) > 0.001 ? Math.atan2(movedY, movedX) : bot.angle;
      bot.angle = normalizeAngle(trajectoryAngle);
      bot.vx = Math.cos(trajectoryAngle) * bot.speed;
      bot.vy = Math.sin(trajectoryAngle) * bot.speed;
      const movedDistance = Math.hypot(movedX, movedY);
      bot.progressWindowTime += dt;
      bot.progressWindowDistance += movedDistance;
      if (bot.progressWindowTime >= 4) {
        const currentPlanned = bot.nextLaneId ? this.getLaneTransition(bot.currentLaneId, bot.nextLaneId) : null;
        const verifiedConflict = bot.blockingReason === 'conflictZone' && currentPlanned &&
          this.getBlockingReservation(currentPlanned, bot.id) !== null;
        const verifiedVehicle = bot.blockingReason === 'vehicleAhead' && bot.blockingCarId !== null;
        const verifiedBlocker = Boolean(verifiedConflict || verifiedVehicle);
        if (bot.progressWindowDistance < 45) {
          if (verifiedBlocker) {
            bot.stalledWindowCount = 0;
          } else {
            bot.stalledWindowCount++;
            if (bot.transitionPoints.length === 0) {
              this.releaseTransitionReservation(bot);
              bot.nextLaneId = null;
            }
            this.recoverTrafficCar(bot, lane);
          }
        } else {
          bot.stalledWindowCount = 0;
        }
        bot.progressWindowTime = 0;
        bot.progressWindowDistance = 0;
      }
      const protectedWait = bot.blockingReason === 'vehicleAhead' ||
        (bot.blockingReason === 'conflictZone' && bot.waitingDuration <= 5);
      if (protectedWait) {
        bot.stuckTimer = 0;
      } else if (bot.targetSpeed > 20 && movedDistance < 0.08) {
        bot.stuckTimer += dt;
      } else {
        bot.stuckTimer = 0;
      }
      if (bot.stuckTimer >= 2.5) this.recoverTrafficCar(bot, lane);
    }

    this.resolveTrafficBlockerCycles();

  }

  public renderGpsPath(
    ctx: CanvasRenderingContext2D,
    carX: number,
    carY: number,
    carAngle: number,
    targetX: number,
    targetY: number,
    color = '#06b6d4'
  ) {
    const path = this.getRemainingGpsRoute(carX, carY, targetX, targetY, carAngle);
    if (path.length < 2) return;

    ctx.save();
    const dashOffset = (-this.animTimer * 45) % 36;
    ctx.lineDashOffset = dashOffset;
    ctx.setLineDash([18, 14]);

    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.85;

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.stroke();

    ctx.restore();
  }

  public renderParkingBay(
    ctx: CanvasRenderingContext2D,
    zone: ParkingZone,
    isDropoff = false,
    spotName = ''
  ) {
    const bayL = zone.width;
    const bayW = zone.height;

    ctx.save();
    ctx.translate(zone.x, zone.y);
    ctx.rotate(zone.angle);

    const themeColor = isDropoff ? '#10b981' : '#facc15';

    // Асфальт парковочного кармана
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.fillRect(-bayL / 2, -bayW / 2, bayL, bayW);

    // Разметка
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-bayL / 2, -bayW / 2, bayL, bayW);
    ctx.setLineDash([]);

    // Буква [ P ]
    ctx.fillStyle = themeColor;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', 0, 0);

    // Подпись места назначения
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    const tagText = isDropoff ? `ФИНИШ: ${spotName || '[P]'}` : `ПОСАДКА: ${spotName || '[P]'}`;
    ctx.fillText(tagText, 0, -bayW / 2 - 14);

    ctx.restore();
  }

  private renderNeonSign(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    sign: { text: string; color: string; glowColor: string; size: number; offsetX: number; offsetY: number }
  ) {
    ctx.save();
    const sx = bx + sign.offsetX;
    const sy = by + sign.offsetY;

    const pulse = 0.85 + Math.sin(this.animTimer * 4 + bx) * 0.15;
    ctx.globalAlpha = pulse;

    ctx.shadowColor = sign.glowColor;
    ctx.shadowBlur = 14;

    ctx.font = `900 ${sign.size}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = sign.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sign.text, sx, sy);

    ctx.strokeStyle = sign.color;
    ctx.lineWidth = 1.5;
    const textW = ctx.measureText(sign.text).width;
    ctx.strokeRect(sx - textW / 2 - 8, sy - sign.size / 2 - 4, textW + 16, sign.size + 8);

    ctx.restore();
  }

  public render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number
  ) {
    const left = camX - viewW / 2 - 200;
    const top = camY - viewH / 2 - 200;
    const right = camX + viewW / 2 + 200;
    const bottom = camY + viewH / 2 + 200;
    const mainlandPolygon = this.getMainlandPolygon();
    const airportIsland = this.getAirportIsland();

    // 1. Океан вокруг острова
    ctx.fillStyle = '#020617';
    ctx.fillRect(left, top, viewW + 400, viewH + 400);

    // 2. Материк и Airport рисуются из тех же данных, что использует collision.
    ctx.save();
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.moveTo(mainlandPolygon[0].x, mainlandPolygon[0].y);
    for (let i = 1; i < mainlandPolygon.length; i++) ctx.lineTo(mainlandPolygon[i].x, mainlandPolygon[i].y);
    ctx.closePath();
    ctx.fill();

    // Остров Аэропорта
    ctx.beginPath();
    ctx.ellipse(airportIsland.x, airportIsland.y, airportIsland.radiusX, airportIsland.radiusY, airportIsland.angle, 0, Math.PI * 2);
    ctx.fill();

    // Мост в Аэропорт
    ctx.strokeStyle = '#1e293b';
    const bridge = this.roadSegments.find(seg => seg.id === 'road_4750_4400_5250_4800');
    ctx.lineWidth = bridge?.width ?? 176;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bridge?.x1 ?? 4750 * CITY_GEOMETRY_SCALE, bridge?.y1 ?? 4400 * CITY_GEOMETRY_SCALE);
    ctx.lineTo(bridge?.x2 ?? 5250 * CITY_GEOMETRY_SCALE, bridge?.y2 ?? 4800 * CITY_GEOMETRY_SCALE);
    ctx.stroke();

    // Неоновая светящаяся береговая линия (Силовой барьер)
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(mainlandPolygon[0].x, mainlandPolygon[0].y);
    for (let i = 1; i < mainlandPolygon.length; i++) ctx.lineTo(mainlandPolygon[i].x, mainlandPolygon[i].y);
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(airportIsland.x, airportIsland.y, airportIsland.radiusX, airportIsland.radiusY, airportIsland.angle, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 3. Сначала единый edge pass, затем asphalt pass: на junction нет внутренних бордюров.
    const visibleSegments = this.roadSegments.filter(seg => {
      const minX = Math.min(seg.x1, seg.x2) - seg.width;
      const maxX = Math.max(seg.x1, seg.x2) + seg.width;
      const minY = Math.min(seg.y1, seg.y2) - seg.width;
      const maxY = Math.max(seg.y1, seg.y2) + seg.width;
      return !(maxX < left || minX > right || maxY < top || minY > bottom);
    });
    ctx.save();
    ctx.lineCap = 'round';
    for (const seg of visibleSegments) {
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = seg.width + 8;
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }
    for (const rb of this.roundabouts) {
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = rb.width + 8;
      ctx.beginPath();
      ctx.arc(rb.x, rb.y, rb.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const seg of visibleSegments) {
      ctx.strokeStyle = '#1a2234';
      ctx.lineWidth = seg.width;
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }
    for (const rb of this.roundabouts) {
      ctx.strokeStyle = '#1a2234';
      ctx.lineWidth = rb.width;
      ctx.beginPath();
      ctx.arc(rb.x, rb.y, rb.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Стабильная процедурная фактура (никакого Math.random во время render).
    for (const seg of visibleSegments) {
      const dx = seg.x2 - seg.x1;
      const dy = seg.y2 - seg.y1;
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length;
      const ny = dx / length;
      ctx.fillStyle = 'rgba(148, 163, 184, 0.10)';
      for (let i = 0; i < Math.min(18, Math.ceil(length / 130)); i++) {
        const along = hashNoise(i, seg.id.length, 11);
        const across = (hashNoise(i, seg.id.length, 29) - 0.5) * (seg.width - 22);
        const px = seg.x1 + dx * along + nx * across;
        const py = seg.y1 + dy * along + ny * across;
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }

      // Разметка будет перекрыта чистыми junction patches ниже.
      if (seg.kind !== 'alley') {
        ctx.strokeStyle = seg.isHighway ? '#f59e0b' : '#94a3b8';
        ctx.lineWidth = seg.isHighway ? 3 : 2;
        ctx.setLineDash(seg.isHighway ? [24, 20] : [16, 18]);
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
      }
      if (seg.isHighway) {
        ctx.save();
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.42)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 24]);
        for (const side of [-1, 1] as const) {
          const laneOffset = seg.width * 0.25 * side;
          ctx.beginPath();
          ctx.moveTo(seg.x1 + nx * laneOffset, seg.y1 + ny * laneOffset);
          ctx.lineTo(seg.x2 + nx * laneOffset, seg.y2 + ny * laneOffset);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.shadowBlur = 10;
        const beaconCount = Math.max(2, Math.floor(length / 230));
        for (let index = 1; index < beaconCount; index++) {
          const t = index / beaconCount;
          for (const side of [-1, 1] as const) {
            const edgeOffset = (seg.width / 2 + 13) * side;
            ctx.fillStyle = side < 0 ? '#22d3ee' : '#f472b6';
            ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath();
            ctx.arc(seg.x1 + dx * t + nx * edgeOffset, seg.y1 + dy * t + ny * edgeOffset, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }
    ctx.setLineDash([]);

    // Чистые patches объединяют пересекающиеся улицы и скрывают разметку в центре.
    for (const node of this.roadNodes) {
      if (node.neighbors.length < 3 || this.roundabouts.some(rb => Math.hypot(rb.x - node.x, rb.y - node.y) < 2)) continue;
      const connected = this.navigationEdges.filter(edge => edge.fromNodeId === node.id || edge.toNodeId === node.id);
      const radius = Math.max(...connected.map(edge => edge.width), 100) / 2 + 2;
      ctx.fillStyle = '#1a2234';
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Центральные острова roundabout остаются физически и визуально solid.
    for (const rb of this.roundabouts) {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(rb.x, rb.y, rb.radius - rb.width / 2 + 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.restore();

    // 4. Парковочные зоны у обочин
    for (const p of this.parkingZones) {
      if (p.x + 100 < left || p.x - 100 > right || p.y + 100 < top || p.y - 100 > bottom) continue;

      const accessSegment = this.roadSegments.find(segment => segment.id === p.accessRoadSegmentId);
      if (accessSegment) {
        const access = this.getParkingAccessGeometry(p);
        if (!access) continue;
        ctx.save();
        ctx.translate(access.apron.x, access.apron.y);
        ctx.rotate(access.apron.angle);
        ctx.strokeStyle = '#475569';
        ctx.fillStyle = '#1a2234';
        ctx.fillRect(-access.apron.width / 2 - 3, -access.apron.height / 2, access.apron.width + 6, access.apron.height);
        ctx.strokeRect(-access.apron.width / 2 - 3, -access.apron.height / 2, access.apron.width + 6, access.apron.height);
        ctx.restore();
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);

      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(-p.width / 2, -p.height / 2, p.width, p.height);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', 0, 0);

      ctx.restore();
    }

    // 5. Уличные фонари
    for (const station of this.fuelStations) {
      if (station.x + 130 < left || station.x - 130 > right ||
          station.y + 130 < top || station.y - 130 > bottom) continue;
      const zone = this.fuelStationZone(station);
      const access = this.getParkingAccessGeometry(zone);
      if (access) {
        ctx.save();
        ctx.translate(access.apron.x, access.apron.y);
        ctx.rotate(access.apron.angle);
        ctx.fillStyle = '#1a2234';
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.fillRect(-access.apron.width / 2, -access.apron.height / 2, access.apron.width, access.apron.height);
        ctx.strokeRect(-access.apron.width / 2, -access.apron.height / 2, access.apron.width, access.apron.height);
        ctx.restore();
      }

      ctx.save();
      ctx.translate(station.x, station.y);
      ctx.rotate(station.angle);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 10;
      ctx.fillRect(-zone.width / 2, -zone.height / 2, zone.width, zone.height);
      ctx.strokeRect(-zone.width / 2, -zone.height / 2, zone.width, zone.height);
      ctx.shadowBlur = 0;

      ctx.fillStyle = 'rgba(8, 47, 73, 0.9)';
      ctx.fillRect(-zone.width / 2 + 7, -zone.height / 2 + 6, zone.width - 14, 18);
      ctx.fillStyle = '#67e8f9';
      ctx.font = '900 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FUEL · АЗС', 0, -zone.height / 2 + 15);

      for (const pumpX of [-38, 38]) {
        ctx.fillStyle = '#334155';
        ctx.fillRect(pumpX - 8, 3, 16, 23);
        ctx.fillStyle = '#facc15';
        ctx.fillRect(pumpX - 4, 7, 8, 7);
        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(pumpX - 8, 3, 16, 23);
      }
      ctx.fillStyle = '#22d3ee';
      ctx.globalAlpha = 0.7 + Math.sin(this.animTimer * 4) * 0.2;
      ctx.fillRect(-3, -3, 6, 26);
      ctx.restore();
    }

    // 6. Уличные фонари
    for (const sl of this.streetLights) {
      if (sl.x + sl.radius < left || sl.x - sl.radius > right || sl.y + sl.radius < top || sl.y - sl.radius > bottom) continue;

      ctx.save();
      const grad = ctx.createRadialGradient(sl.x, sl.y, 10, sl.x, sl.y, sl.radius);
      grad.addColorStop(0, sl.color);
      grad.addColorStop(1, 'rgba(6, 182, 212, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sl.x, sl.y, sl.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.arc(sl.x, sl.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 7. НАЗЕМНЫЙ ДОРОЖНЫЙ ТРАФИК (Машины на дорогах!)
    for (const car of this.trafficCars) {
      if (car.x + 80 < left || car.x - 80 > right || car.y + 80 < top || car.y - 80 > bottom) continue;

      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      renderTrafficVehicle(ctx, car);

      ctx.restore();
    }

    // 7. Здания и неоновые вывески
    for (const b of this.buildings) {
      if (b.x + b.width < left || b.x > right || b.y + b.height < top || b.y > bottom) continue;

      // A consistent 12px sidewalk ties façades into readable street blocks.
      ctx.fillStyle = b.district === 'Beach' ? '#292316' : '#111827';
      ctx.fillRect(b.x - 12, b.y - 12, b.width + 24, b.height + 24);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x - 12, b.y - 12, b.width + 24, b.height + 24);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(b.x + 8, b.y + 8, b.width, b.height);

      ctx.fillStyle = b.roofColor;
      ctx.fillRect(b.x, b.y, b.width, b.height);

      ctx.strokeStyle = b.neonBorderColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.width, b.height);

      if (b.neonSign) {
        this.renderNeonSign(ctx, b.x, b.y, b.neonSign);
      }
    }

  }

  public renderPhysicsDebug(
    ctx: CanvasRenderingContext2D,
    player: { x: number; y: number; angle: number; length: number; width: number },
  ) {
    if (!DEBUG_PHYSICS) return;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.setLineDash([10, 7]);

    ctx.strokeStyle = '#22d3ee';
    for (const segment of this.roadSegments) {
      ctx.lineWidth = segment.width;
      ctx.beginPath();
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
      ctx.stroke();
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f472b6';
    for (const lane of this.lanes) {
      ctx.beginPath();
      ctx.moveTo(lane.start.x, lane.start.y);
      ctx.lineTo(lane.end.x, lane.end.y);
      ctx.stroke();
    }
    for (const car of this.trafficCars) {
      if (car.transitionPoints.length > 0) {
        ctx.beginPath();
        ctx.moveTo(car.x, car.y);
        for (let i = car.transitionIndex; i < car.transitionPoints.length; i++) {
          ctx.lineTo(car.transitionPoints[i].x, car.transitionPoints[i].y);
        }
        ctx.stroke();
      }
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = '#facc15';
    for (const roundabout of this.roundabouts) {
      ctx.beginPath();
      ctx.arc(roundabout.x, roundabout.y, roundabout.radius - roundabout.width / 2 + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(roundabout.x, roundabout.y, roundabout.radius + roundabout.width / 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = '#34d399';
    const mainlandPolygon = this.getMainlandPolygon();
    const airportIsland = this.getAirportIsland();
    ctx.beginPath();
    ctx.moveTo(mainlandPolygon[0].x, mainlandPolygon[0].y);
    for (let i = 1; i < mainlandPolygon.length; i++) ctx.lineTo(mainlandPolygon[i].x, mainlandPolygon[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(airportIsland.x, airportIsland.y, airportIsland.radiusX, airportIsland.radiusY, airportIsland.angle, 0, Math.PI * 2);
    ctx.stroke();

    for (const zone of this.parkingZones) {
      const access = this.getParkingAccessGeometry(zone);
      if (access) {
        ctx.beginPath();
        ctx.moveTo(access.roadEdge.x, access.roadEdge.y);
        ctx.lineTo(access.bayEdge.x, access.bayEdge.y);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(zone.x, zone.y);
      ctx.rotate(zone.angle);
      ctx.strokeStyle = '#a3e635';
      ctx.strokeRect(-zone.width / 2, -zone.height / 2, zone.width, zone.height);
      ctx.restore();
    }

    const drawVehicle = (vehicle: typeof player, color: string) => {
      ctx.strokeStyle = color;
      for (const circle of vehicleCollisionCircles(vehicle)) {
        ctx.beginPath();
        ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    drawVehicle(player, '#ffffff');
    for (const car of this.trafficCars) drawVehicle(car, '#fb7185');
    ctx.fillStyle = '#ffffff';
    for (const point of vehicleFootprintSamples(player)) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
