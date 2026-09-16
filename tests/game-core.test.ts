import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY_GEOMETRY_SCALE, CityMap, type LaneTransition } from '../src/game/CityMap';
import { OrdersManager } from '../src/game/OrdersManager';
import { Car, calculateImpactDamage } from '../src/game/Car';
import { CAR_SKINS } from '../src/game/Skins';
import { createSkinPurchase, createUpgradePurchase, GameEngine, getCameraProfile, speedToKmh } from '../src/game/GameEngine';
import { DEFAULT_SAVE_DATA, migrateSaveData } from '../src/services/YandexAPI';
import { closestPointOnSegment, orientationDifference, pointInRoadCorridor, pointInRotatedEllipse, pointInRotatedRect, vehicleCollisionCircles } from '../src/game/geometry';
import type { ParkingZone, TrafficCar } from '../src/types/game';

function stageCarForTransition(map: CityMap, car: TrafficCar, transition: LaneTransition, distanceToEnd = 20) {
  const lane = map.lanes.find(candidate => candidate.id === transition.fromLaneId)!;
  const progress = Math.max(0, 1 - distanceToEnd / lane.length);
  Object.assign(car, {
    currentLaneId: lane.id,
    currentRoadId: lane.roadId,
    targetNodeId: lane.toNodeId,
    laneProgress: progress,
    x: lane.start.x + (lane.end.x - lane.start.x) * progress,
    y: lane.start.y + (lane.end.y - lane.start.y) * progress,
    angle: lane.angle,
    speed: 80,
    targetSpeed: 130,
    nextLaneId: transition.toLaneId,
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
  });
}

test('airport render transform and collision transform use the same rotated ellipse', () => {
  const airport = {
    x: 5400 * CITY_GEOMETRY_SCALE,
    y: 4900 * CITY_GEOMETRY_SCALE,
    radiusX: 780 * 1.16,
    radiusY: 680 * 1.16,
    angle: -0.4,
  };
  const local = { x: 740, y: 0 };
  const point = {
    x: airport.x + local.x * Math.cos(airport.angle) - local.y * Math.sin(airport.angle),
    y: airport.y + local.x * Math.sin(airport.angle) + local.y * Math.cos(airport.angle),
  };
  assert.equal(pointInRotatedEllipse(point, airport), true);
  assert.equal(new CityMap().checkIslandBoundary(point.x, point.y, 10), null);
});

test('every rendered road centerline is physically supported, including bridge and remote districts', () => {
  const map = new CityMap();
  for (const segment of map.roadSegments) {
    for (let index = 0; index <= 20; index++) {
      const t = index / 20;
      const x = segment.x1 + (segment.x2 - segment.x1) * t;
      const y = segment.y1 + (segment.y2 - segment.y1) * t;
      assert.equal(map.checkIslandBoundary(x, y, 12), null, `${segment.id} is clipped at ${t}`);
    }
  }
});

test('roundabouts are asphalt rings with solid central islands', () => {
  const map = new CityMap();
  for (const roundabout of map.roundabouts) {
    assert.equal(map.isPointOnRoad(roundabout.x, roundabout.y), false);
    assert.equal(map.isPointOnRoad(roundabout.x + roundabout.radius, roundabout.y), true);
    assert.ok(map.checkVehicleCollision({
      x: roundabout.x,
      y: roundabout.y,
      angle: 0,
      length: 56,
      width: 30,
    }));
  }
  map.roundabouts.push({ x: 100, y: 100, radius: 110, width: 90 });
  assert.equal(map.isPointOnLand(210, 100), false);
  assert.equal(map.isPointInsideDrivableSurface(210, 100, 10), true);
  assert.equal(map.checkIslandBoundary(210, 100, 10), null, 'offshore asphalt ring must remain drivable');
});

test('navigation graph contains true mid-segment intersections and no proximity-only links', () => {
  const map = new CityMap();
  const crossing = map.roadNodes.find(node => Math.hypot(
    node.x - 2500 * CITY_GEOMETRY_SCALE,
    node.y - 2500 * CITY_GEOMETRY_SCALE,
  ) < 1);
  assert.ok(crossing);
  assert.ok(crossing.neighbors.length >= 4);
  const internal = map as unknown as { navigationEdges: Array<{ fromNodeId: number; toNodeId: number }> };
  for (const node of map.roadNodes) {
    for (const neighbor of node.neighbors) {
      assert.ok(internal.navigationEdges.some(edge =>
        (edge.fromNodeId === node.id && edge.toNodeId === neighbor) ||
        (edge.toNodeId === node.id && edge.fromNodeId === neighbor)));
    }
  }
});

test('unified road model has stable IDs, real junctions and no implicit U-turns', () => {
  const map = new CityMap();
  assert.equal(new Set(map.roadSegments.map(road => road.id)).size, map.roadSegments.length);
  assert.ok(map.roadSegments.every(road => typeof road.id === 'string' && !road.id.startsWith('seg_')));
  assert.ok(map.lanes.every(lane => lane.roadId && typeof lane.id === 'string' && lane.width > 0));

  const straightSplit = map.roadNodes.find(node =>
    Math.hypot(node.x - 2804 * CITY_GEOMETRY_SCALE, node.y - 2500 * CITY_GEOMETRY_SCALE) < 1);
  assert.ok(straightSplit, 'expected parking-derived straight split');
  assert.equal(straightSplit.junctionId, null, 'straight split became a traffic junction');
  for (const zone of map.parkingZones) {
    const road = map.roadSegments.find(candidate => candidate.id === zone.accessRoadSegmentId)!;
    const access = closestPointOnSegment(zone, { x: road.x1, y: road.y1 }, { x: road.x2, y: road.y2 });
    const node = map.roadNodes.find(candidate => Math.hypot(candidate.x - access.x, candidate.y - access.y) < 1)!;
    assert.equal(node.junctionId, null, `${zone.id} created a traffic junction`);
  }
  assert.ok(map.laneTransitions.filter(transition => transition.kind !== 'roundabout')
    .every(transition => transition.sweep <= Math.PI + 1e-9));
  assert.ok(map.laneTransitions.every(transition => {
    const from = map.lanes.find(lane => lane.id === transition.fromLaneId)!;
    const to = map.lanes.find(lane => lane.id === transition.toLaneId)!;
    return from.edgeId !== to.edgeId;
  }), 'implicit U-turn transition exists');
  const rightAngle = map.laneTransitions.find(transition =>
    transition.kind !== 'straight' && transition.kind !== 'roundabout' &&
    Math.abs(transition.sweep - Math.PI / 2) < 0.05)!;
  assert.ok(rightAngle, '90-degree transition missing');
  assert.ok(rightAngle.length < 180, '90-degree transition took the long way around');
});

test('GPS uses physical lane distance, matching heading and roundabout transitions', () => {
  const map = new CityMap();
  const target = map.parkingZones.find(zone => zone.id === 'pk_dt_2')!;
  const route = map.findGpsRoute(2700 * CITY_GEOMETRY_SCALE, 2474 * CITY_GEOMETRY_SCALE, target.x, target.y, 0);
  assert.ok(Math.cos(route.startLaneAngle) > 0.98, 'GPS selected an oncoming start lane');
  assert.ok(Math.abs(route.points[1].y - 2500 * CITY_GEOMETRY_SCALE) > 15, 'GPS remained on the road centerline');
  const geometricLength = route.points.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - route.points[index].x, point.y - route.points[index].y), 0);
  assert.ok(route.cost >= geometricLength - 2, 'route cost is not based on physical distance');
  const firstTravelPoint = route.points.find(point => point.x > route.points[1].x + 20)!;
  assert.ok(firstTravelPoint.x > route.points[1].x, 'route starts with an immediate U-turn');

  const roundaboutTarget = map.parkingZones.find(zone => zone.id === 'pk_dt_6')!;
  const around = map.findGpsRoute(3226 * CITY_GEOMETRY_SCALE, 2700 * CITY_GEOMETRY_SCALE, roundaboutTarget.x, roundaboutTarget.y, Math.PI / 2);
  const central = map.roundabouts[0];
  const innerRadius = central.radius - central.width / 2 + 10;
  const ringPoints = around.points.filter(point => Math.hypot(point.x - central.x, point.y - central.y) < central.radius + central.width / 2);
  assert.ok(ringPoints.length >= 6, 'GPS did not create a smooth roundabout arc');
  assert.ok(ringPoints.every(point => Math.hypot(point.x - central.x, point.y - central.y) >= innerRadius),
    'GPS cuts through the roundabout island');
  const routeTransitions = around.transitionIds.map(id => map.laneTransitions.find(transition => transition.id === id)!);
  assert.ok(routeTransitions.some(transition => transition.kind === 'roundabout'), 'route bypassed the roundabout lane path');
  assert.ok(routeTransitions.filter(transition => transition.kind === 'roundabout').every(transition =>
    map.circularLanes.some(lane => lane.id === transition.circularLaneId)), 'roundabout transition has no circular lane');
  assert.ok(routeTransitions.every(transition => transition.sweep <= Math.PI + 1e-9), 'GPS selected a 270-degree loop');
  const cached = map.getGpsRoute(3226 * CITY_GEOMETRY_SCALE, 2700 * CITY_GEOMETRY_SCALE, roundaboutTarget.x, roundaboutTarget.y, Math.PI / 2);
  const cachedAgain = map.getGpsRoute(3226 * CITY_GEOMETRY_SCALE, 2710 * CITY_GEOMETRY_SCALE, roundaboutTarget.x, roundaboutTarget.y, Math.PI / 2);
  assert.equal(cachedAgain, cached, 'GPS recalculated an unchanged valid route');
  const changedDestination = map.parkingZones.find(zone => zone.id === 'pk_dt_1')!;
  assert.notEqual(map.getGpsRoute(3226 * CITY_GEOMETRY_SCALE, 2710 * CITY_GEOMETRY_SCALE, changedDestination.x, changedDestination.y, Math.PI / 2), cached,
    'GPS cache survived a destination change');
});

test('GPS visible route removes travelled prefix, keeps waypoint progress, and reroutes off-route', () => {
  const map = new CityMap();
  const start = map.parkingZones.find(zone => zone.id === 'pk_dt_1')!;
  const target = map.parkingZones.find(zone => zone.id === 'pk_in_2')!;
  const cached = map.getGpsRoute(start.x, start.y, target.x, target.y, start.angle);
  const firstIndex = Math.max(2, Math.floor(cached.points.length * 0.2));
  const secondIndex = Math.max(firstIndex + 2, Math.floor(cached.points.length * 0.35));

  const sampleRoute = (index: number) => {
    const from = cached.points[index];
    const to = cached.points[index + 1];
    return {
      x: from.x + (to.x - from.x) * 0.4,
      y: from.y + (to.y - from.y) * 0.4,
      angle: Math.atan2(to.y - from.y, to.x - from.x),
    };
  };
  const first = sampleRoute(firstIndex);
  const visible = map.getRemainingGpsRoute(first.x, first.y, target.x, target.y, first.angle);
  assert.ok(visible.length < cached.points.length - firstIndex + 1, 'visible GPS retained its travelled prefix');
  assert.ok(Math.hypot(visible[0].x - first.x, visible[0].y - first.y) < 0.01,
    'visible GPS does not begin at the current projection');
  const firstRetainedIndex = cached.points.indexOf(visible[1]);
  assert.ok(firstRetainedIndex > firstIndex, 'visible GPS contains a point behind the car');

  const waypointA = map.getNextGpsWaypoint(first.x, first.y, target.x, target.y, first.angle);
  const progressA = (map as unknown as { gpsCache: { progress: number } }).gpsCache.progress;
  const second = sampleRoute(secondIndex);
  const waypointB = map.getNextGpsWaypoint(second.x, second.y, target.x, target.y, second.angle);
  const progressB = (map as unknown as { gpsCache: { progress: number } }).gpsCache.progress;
  const routeProgress = (point: { x: number; y: number }, minimum: number) => {
    let cumulative = 0;
    let best = { distance: Infinity, progress: Infinity };
    for (let index = 0; index < cached.points.length - 1; index++) {
      const from = cached.points[index];
      const to = cached.points[index + 1];
      const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
      const projection = closestPointOnSegment(point, from, to);
      const progress = cumulative + segmentLength * projection.t;
      if (progress >= minimum && projection.distance < best.distance) best = { distance: projection.distance, progress };
      cumulative += segmentLength;
    }
    return best.progress;
  };
  const waypointProgressA = routeProgress(waypointA, progressA);
  const waypointProgressB = routeProgress(waypointB, progressB);
  assert.ok(progressB >= progressA, 'GPS projection jumped backward');
  assert.ok(waypointProgressB >= waypointProgressA, 'GPS waypoint jumped backward');
  assert.ok(waypointProgressA - progressA >= 85 && waypointProgressA - progressA <= 120);
  assert.ok(waypointProgressB - progressB >= 85 && waypointProgressB - progressB <= 120);

  map.getRemainingGpsRoute(80, 80, target.x, target.y, 0);
  assert.notEqual(map.getGpsRoute(80, 80, target.x, target.y, 0), cached, 'off-route movement did not reroute');
});

test('diagonal roundabout transitions use contact angles and never create an accidental full lap', () => {
  const map = new CityMap();
  const diagonalTransitions = map.laneTransitions.filter(transition => {
    if (transition.kind !== 'roundabout') return false;
    const from = map.lanes.find(lane => lane.id === transition.fromLaneId)!;
    return Math.abs(Math.sin(from.angle)) > 0.2 && Math.abs(Math.cos(from.angle)) > 0.2;
  });
  assert.ok(diagonalTransitions.length > 0, 'no diagonal roundabout approach found');
  assert.ok(diagonalTransitions.every(transition => transition.sweep <= Math.PI * 1.75),
    'diagonal roundabout transition makes an accidental near-360-degree lap');

  for (const transition of diagonalTransitions) {
    const from = map.lanes.find(lane => lane.id === transition.fromLaneId)!;
    const to = map.lanes.find(lane => lane.id === transition.toLaneId)!;
    const node = map.roadNodes[from.toNodeId];
    const roundabout = map.roundabouts.find(candidate => Math.hypot(candidate.x - node.x, candidate.y - node.y) < 2)!;
    const entryAngle = Math.atan2(from.end.y - roundabout.y, from.end.x - roundabout.x);
    const exitAngle = Math.atan2(to.start.y - roundabout.y, to.start.x - roundabout.x);
    let expectedSweep = Math.atan2(Math.sin(exitAngle - entryAngle), Math.cos(exitAngle - entryAngle));
    if (expectedSweep > 0) expectedSweep -= Math.PI * 2;
    assert.ok(Math.abs(transition.sweep - Math.abs(expectedSweep)) < 1e-9,
      `${transition.id} does not use its actual lane contact angles`);

    const path = [from.end, ...transition.points];
    const entryIndex = path.findIndex(point => Math.abs(Math.hypot(
      point.x - roundabout.x, point.y - roundabout.y,
    ) - roundabout.radius) < 1e-6);
    let exitIndex = -1;
    for (let index = path.length - 1; index >= 0; index--) {
      if (Math.abs(Math.hypot(path[index].x - roundabout.x, path[index].y - roundabout.y) - roundabout.radius) < 1e-6) {
        exitIndex = index;
        break;
      }
    }
    assert.ok(entryIndex > 1 && exitIndex > entryIndex, `${transition.id} has incomplete circle contacts`);
    const tangentAtEntry = entryAngle - Math.PI / 2;
    const tangentAtExit = exitAngle - Math.PI / 2;
    const intoEntry = Math.atan2(path[entryIndex].y - path[entryIndex - 1].y, path[entryIndex].x - path[entryIndex - 1].x);
    const outOfEntry = Math.atan2(path[entryIndex + 1].y - path[entryIndex].y, path[entryIndex + 1].x - path[entryIndex].x);
    const intoExit = Math.atan2(path[exitIndex].y - path[exitIndex - 1].y, path[exitIndex].x - path[exitIndex - 1].x);
    const outOfExit = Math.atan2(path[exitIndex + 1].y - path[exitIndex].y, path[exitIndex + 1].x - path[exitIndex].x);
    const startTangent = Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x);
    const endTangent = Math.atan2(path[path.length - 1].y - path[path.length - 2].y, path[path.length - 1].x - path[path.length - 2].x);
    assert.ok(Math.abs(Math.atan2(Math.sin(intoEntry - tangentAtEntry), Math.cos(intoEntry - tangentAtEntry))) < 0.08);
    assert.ok(Math.abs(Math.atan2(Math.sin(outOfEntry - tangentAtEntry), Math.cos(outOfEntry - tangentAtEntry))) < 0.08);
    assert.ok(Math.abs(Math.atan2(Math.sin(intoExit - tangentAtExit), Math.cos(intoExit - tangentAtExit))) < 0.08);
    assert.ok(Math.abs(Math.atan2(Math.sin(outOfExit - tangentAtExit), Math.cos(outOfExit - tangentAtExit))) < 0.08);
    assert.ok(Math.abs(Math.atan2(Math.sin(startTangent - from.angle), Math.cos(startTangent - from.angle))) < 0.08);
    assert.ok(Math.abs(Math.atan2(Math.sin(endTangent - to.angle), Math.cos(endTangent - to.angle))) < 0.08);
  }
});

test('GPS may use a materially shorter alley while NPC lanes exclude alleys', () => {
  const map = new CityMap();
  const start = map.parkingZones.find(zone => zone.id === 'pk_dt_1')!;
  const target = map.parkingZones.find(zone => zone.id === 'pk_in_2')!;
  const route = map.findGpsRoute(start.x, start.y, target.x, target.y, start.angle);
  assert.ok(route.laneIds.some(id => map.roadSegments.find(road => road.id === map.lanes.find(lane => lane.id === id)!.roadId)!.kind === 'alley'));
  assert.ok(map.trafficCars.every(car => map.roadSegments.find(road => road.id === car.currentRoadId)!.kind !== 'alley'));
});

test('GPS remains logical and stable across 20 gameplay routes', () => {
  const map = new CityMap();
  const pairs = [
    ['pk_dt_1', 'pk_dt_2'], ['pk_dt_2', 'pk_dt_1'],
    ['pk_dt_1', 'pk_dt_3'], ['pk_dt_3', 'pk_dt_1'],
    ['pk_dt_1', 'pk_dt_6'], ['pk_dt_1', 'pk_hl_1'],
    ['pk_dt_4', 'pk_hl_4'], ['pk_hl_2', 'pk_dt_2'],
    ['pk_dt_1', 'pk_in_1'], ['pk_dt_5', 'pk_in_4'],
    ['pk_in_2', 'pk_bc_1'], ['pk_dt_2', 'pk_bc_3'],
    ['pk_bc_1', 'pk_pt_1'], ['pk_pt_2', 'pk_ap_1'],
    ['pk_ap_2', 'pk_dt_4'], ['pk_pt_3', 'pk_hl_3'],
    ['pk_ws_1', 'pk_in_3'], ['pk_ws_2', 'pk_bc_2'],
    ['pk_dt_5', 'pk_pt_4'], ['pk_dt_6', 'pk_ap_4'],
    ['pk_dt_1', 'pk_in_2'],
  ] as const;
  for (const [startId, targetId] of pairs) {
    const start = map.parkingZones.find(zone => zone.id === startId)!;
    const target = map.parkingZones.find(zone => zone.id === targetId)!;
    const route = map.findGpsRoute(start.x, start.y, target.x, target.y, start.angle);
    assert.ok(route.laneIds.length > 0, `${startId}->${targetId} has no lane route`);
    assert.equal(new Set(route.laneIds).size, route.laneIds.length, `${startId}->${targetId} contains a lane loop`);
    assert.ok(route.transitionIds.every(id => {
      const transition = map.laneTransitions.find(candidate => candidate.id === id)!;
      return transition.kind === 'roundabout' || transition.sweep <= Math.PI + 1e-9;
    }),
      `${startId}->${targetId} contains a 270-degree transition`);
    for (let index = 1; index < route.laneIds.length; index++) {
      const from = map.lanes.find(lane => lane.id === route.laneIds[index - 1])!;
      const to = map.lanes.find(lane => lane.id === route.laneIds[index])!;
      assert.notEqual(from.edgeId, to.edgeId, `${startId}->${targetId} makes an immediate U-turn`);
    }
    const pathLength = route.points.slice(1).reduce((sum, point, index) =>
      sum + Math.hypot(point.x - route.points[index].x, point.y - route.points[index].y), 0);
    const direct = Math.hypot(target.x - start.x, target.y - start.y);
    assert.ok(pathLength <= direct * 4 + 1600, `${startId}->${targetId} is unreasonably indirect`);
  }

  const start = map.parkingZones.find(zone => zone.id === 'pk_dt_1')!;
  const target = map.parkingZones.find(zone => zone.id === 'pk_in_2')!;
  const stable = map.getGpsRoute(start.x, start.y, target.x, target.y, start.angle);
  for (const angleDelta of [-0.12, -0.04, 0.03, 0.11]) {
    assert.equal(map.getGpsRoute(start.x + 8, start.y + 3, target.x, target.y, start.angle + angleDelta), stable,
      'minor steering jitter changed the cached GPS route');
  }
});

test('building data leaves a safety gap from every asphalt corridor', () => {
  const map = new CityMap();
  for (const building of map.buildings) {
    for (const segment of map.roadSegments) {
      const steps = Math.ceil(Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) / 5);
      for (let index = 0; index <= steps; index++) {
        const t = index / steps;
        const x = segment.x1 + (segment.x2 - segment.x1) * t;
        const y = segment.y1 + (segment.y2 - segment.y1) * t;
        const closestX = Math.max(building.x, Math.min(x, building.x + building.width));
        const closestY = Math.max(building.y, Math.min(y, building.y + building.height));
        assert.ok(
          Math.hypot(x - closestX, y - closestY) >= segment.width / 2 + 7,
          `${building.id} overlaps ${segment.id}`,
        );
      }
    }
    for (const roundabout of map.roundabouts) {
      const closestX = Math.max(building.x, Math.min(roundabout.x, building.x + building.width));
      const closestY = Math.max(building.y, Math.min(roundabout.y, building.y + building.height));
      assert.ok(
        Math.hypot(roundabout.x - closestX, roundabout.y - closestY) >=
          roundabout.radius + roundabout.width / 2 + 12,
        `${building.id} overlaps a roundabout`,
      );
    }
  }
});

test('ordinary streets are lined by dense, road-derived facade rows', () => {
  const map = new CityMap();
  const rowFacades = map.buildings.filter(building => building.id.startsWith('b_row_'));
  const downtownFacades = map.buildings.filter(building => building.id.startsWith('b_dt_'));
  assert.ok(map.buildings.length >= 130, 'city still has large empty ordinary blocks');
  assert.ok(rowFacades.length >= 60, 'too few road-edge facade buildings');
  assert.ok(downtownFacades.length >= 35, 'downtown blocks were not split into varied facades');
  for (const building of rowFacades) {
    assert.ok(Math.min(building.width, building.height) >= 30 && Math.min(building.width, building.height) <= 90,
      `${building.id} facade is outside the 30-90px range`);
    assert.ok(Math.max(building.width, building.height) >= 80 && Math.max(building.width, building.height) <= 220,
      `${building.id} depth is outside the 80-220px range`);
    let edgeGap = Infinity;
    for (const segment of map.roadSegments.filter(road => road.kind === 'street')) {
      const steps = Math.ceil(Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) / 12);
      for (let index = 0; index <= steps; index++) {
        const t = index / steps;
        const x = segment.x1 + (segment.x2 - segment.x1) * t;
        const y = segment.y1 + (segment.y2 - segment.y1) * t;
        const closestX = Math.max(building.x, Math.min(x, building.x + building.width));
        const closestY = Math.max(building.y, Math.min(y, building.y + building.height));
        edgeGap = Math.min(edgeGap, Math.hypot(x - closestX, y - closestY) - segment.width / 2);
      }
    }
    assert.ok(edgeGap >= 7 && edgeGap <= 24, `${building.id} is not aligned to a street edge`);
  }
});

test('all parking bays are aligned roadside pockets with continuous physical access', () => {
  const map = new CityMap();
  const junctions = map.junctions;
  for (const zone of map.parkingZones) {
    const segment = map.roadSegments.find(candidate => candidate.id === zone.accessRoadSegmentId);
    assert.ok(segment, `${zone.id} has no access segment`);
    const roadAngle = Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1);
    assert.ok(orientationDifference(zone.angle, roadAngle) < 1e-8, `${zone.id} is not parallel to its road`);
    assert.ok(map.isPointOnLand(zone.x, zone.y, 5), `${zone.id} is in the ocean`);
    assert.ok(Math.min(...junctions.map(node => Math.hypot(node.x - zone.x, node.y - zone.y))) > 100,
      `${zone.id} overlaps a junction`);
    const roundaboutClearance = Math.min(...map.roundabouts.map(roundabout =>
      Math.hypot(roundabout.x - zone.x, roundabout.y - zone.y) -
      (roundabout.radius + roundabout.width / 2)));
    assert.ok(roundaboutClearance > 75, `${zone.id} is on a roundabout`);

    const accessPoint = closestPointOnSegment(
      zone,
      { x: segment.x1, y: segment.y1 },
      { x: segment.x2, y: segment.y2 },
    );
    assert.ok(map.roadNodes.some(node => Math.hypot(node.x - accessPoint.x, node.y - accessPoint.y) < 1),
      `${zone.id} access is missing from the navigation graph`);

    const cos = Math.cos(zone.angle);
    const sin = Math.sin(zone.angle);
    for (const localX of [-zone.width / 2, 0, zone.width / 2]) {
      for (const localY of [-zone.height / 2, 0, zone.height / 2]) {
        const bayPoint = {
          x: zone.x + localX * cos - localY * sin,
          y: zone.y + localX * sin + localY * cos,
        };
        for (const building of map.buildings) {
          const closestX = Math.max(building.x, Math.min(bayPoint.x, building.x + building.width));
          const closestY = Math.max(building.y, Math.min(bayPoint.y, building.y + building.height));
          assert.ok(Math.hypot(bayPoint.x - closestX, bayPoint.y - closestY) >= 10,
            `${zone.id} parking bay is blocked by ${building.id}`);
        }
      }
    }

    for (let index = 0; index <= 20; index++) {
      const t = index / 20;
      const x = accessPoint.x + (zone.x - accessPoint.x) * t;
      const y = accessPoint.y + (zone.y - accessPoint.y) * t;
      assert.equal(map.isPointInsideDrivableSurface(x, y, 8), true, `${zone.id} access is disconnected`);
      for (const building of map.buildings) {
        const closestX = Math.max(building.x, Math.min(x, building.x + building.width));
        const closestY = Math.max(building.y, Math.min(y, building.y + building.height));
        assert.ok(Math.hypot(x - closestX, y - closestY) >= zone.height / 2 + 10,
          `${zone.id} access is blocked by ${building.id}`);
      }
    }
  }
});

test('parking validator covers straight, junction, alley, roundabout, building and Industrial regressions', () => {
  const map = new CityMap();
  const results = new Map(map.validateParkingZones().map(result => [result.zoneId, result]));
  assert.equal(results.size, map.parkingZones.length);
  assert.deepEqual([...results.values()].filter(result => !result.valid), []);

  const cases = {
    straight: 'pk_dt_1',
    intersection: 'pk_in_1',
    alley: 'pk_ws_4',
    roundabout: 'pk_ap_1',
    building: 'pk_dt_5',
  } as const;
  for (const [scenario, id] of Object.entries(cases)) {
    assert.equal(results.get(id)?.valid, true, `${scenario} parking regression failed for ${id}`);
  }
  for (const zone of map.parkingZones.filter(zone => zone.district === 'Industrial')) {
    assert.equal(results.get(zone.id)?.valid, true, `known problematic Industrial parking ${zone.id} is invalid`);
  }

  const intersectionZone = map.parkingZones.find(zone => zone.id === cases.intersection)!;
  assert.ok(Math.min(...map.junctions.map(junction => Math.hypot(junction.x - intersectionZone.x, junction.y - intersectionZone.y))) <
    250 * CITY_GEOMETRY_SCALE);
  const alleyZone = map.parkingZones.find(zone => zone.id === cases.alley)!;
  assert.ok(Math.min(...map.roadSegments.filter(road => road.kind === 'alley').map(road =>
    closestPointOnSegment(alleyZone, { x: road.x1, y: road.y1 }, { x: road.x2, y: road.y2 }).distance - road.width / 2)) <
    110 * CITY_GEOMETRY_SCALE + 24);
  const roundaboutZone = map.parkingZones.find(zone => zone.id === cases.roundabout)!;
  assert.ok(Math.min(...map.roundabouts.map(roundabout =>
    Math.hypot(roundabout.x - roundaboutZone.x, roundabout.y - roundaboutZone.y) - roundabout.radius - roundabout.width / 2)) <
    130 * CITY_GEOMETRY_SCALE + 24);
  const buildingZone = map.parkingZones.find(zone => zone.id === cases.building)!;
  assert.ok(Math.min(...map.buildings.map(building =>
    Math.hypot(building.x + building.width / 2 - buildingZone.x, building.y + building.height / 2 - buildingZone.y))) <
    120 * CITY_GEOMETRY_SCALE);
});

test('full parking rectangles stay off every travel surface and use a road-edge apron', () => {
  const map = new CityMap();
  const sampleParkingRect = (zone: ParkingZone) => {
    const points: Array<{ x: number; y: number }> = [];
    const cos = Math.cos(zone.angle);
    const sin = Math.sin(zone.angle);
    for (let localX = -zone.width / 2; localX <= zone.width / 2 + 0.1; localX += 4) {
      for (let localY = -zone.height / 2; localY <= zone.height / 2 + 0.1; localY += 4) {
        points.push({
          x: zone.x + localX * cos - localY * sin,
          y: zone.y + localX * sin + localY * cos,
        });
      }
    }
    return points;
  };

  for (const zone of map.parkingZones) {
    const accessRoad = map.roadSegments.find(road => road.id === zone.accessRoadSegmentId)!;
    const centerline = closestPointOnSegment(
      zone,
      { x: accessRoad.x1, y: accessRoad.y1 },
      { x: accessRoad.x2, y: accessRoad.y2 },
    );
    const centerDistance = Math.hypot(zone.x - centerline.x, zone.y - centerline.y);
    const curbGap = centerDistance - accessRoad.width / 2 - zone.height / 2;
    assert.ok(curbGap >= 8 && curbGap <= 16, `${zone.id} curb gap is ${curbGap}`);
    assert.ok(zone.width >= 56 + 16 && zone.height >= 30 + 16, `${zone.id} cannot contain a standard car`);

    const outward = { x: (zone.x - centerline.x) / centerDistance, y: (zone.y - centerline.y) / centerDistance };
    const roadEdge = {
      x: centerline.x + outward.x * accessRoad.width / 2,
      y: centerline.y + outward.y * accessRoad.width / 2,
    };
    const bayEdge = {
      x: zone.x - outward.x * zone.height / 2,
      y: zone.y - outward.y * zone.height / 2,
    };
    assert.ok(pointInRoadCorridor(
      roadEdge,
      { x: accessRoad.x1, y: accessRoad.y1 },
      { x: accessRoad.x2, y: accessRoad.y2 },
      accessRoad.width,
      0.1,
    ));
    assert.equal(pointInRoadCorridor(
      { x: roadEdge.x + outward.x, y: roadEdge.y + outward.y },
      { x: accessRoad.x1, y: accessRoad.y1 },
      { x: accessRoad.x2, y: accessRoad.y2 },
      accessRoad.width,
    ), false, `${zone.id} apron does not begin at the road edge`);
    assert.ok(pointInRotatedRect(bayEdge, zone, 0.1), `${zone.id} apron does not reach the bay edge`);

    for (const point of sampleParkingRect(zone)) {
      for (const road of map.roadSegments) {
        assert.equal(pointInRoadCorridor(
          point,
          { x: road.x1, y: road.y1 },
          { x: road.x2, y: road.y2 },
          road.width,
        ), false, `${zone.id} rectangle intersects ${road.id}`);
      }
    }
  }
});

test('all ordinary districts, roads and buildings are on the connected mainland', () => {
  const map = new CityMap();
  for (const district of map.districts.filter(candidate => candidate.id !== 'airport')) {
    assert.equal(map.isPointOnLand(district.centerX, district.centerY, 20), true, `${district.id} is offshore`);
  }
  for (const segment of map.roadSegments.slice(0, 30)) {
    for (let index = 0; index <= 12; index++) {
      const t = index / 12;
      assert.equal(map.isPointOnLand(
        segment.x1 + (segment.x2 - segment.x1) * t,
        segment.y1 + (segment.y2 - segment.y1) * t,
      ), true, `${segment.id} leaves the mainland`);
    }
  }
  for (const building of map.buildings.filter(candidate => candidate.district !== 'Airport')) {
    for (const point of [
      { x: building.x, y: building.y },
      { x: building.x + building.width, y: building.y },
      { x: building.x, y: building.y + building.height },
      { x: building.x + building.width, y: building.y + building.height },
    ]) assert.equal(map.isPointOnLand(point.x, point.y), true, `${building.id} is offshore`);
  }
});

test('every alley is connected, drivable and clear of building colliders', () => {
  const map = new CityMap();
  const alleys = map.roadSegments.filter(segment => segment.kind === 'alley');
  assert.ok(alleys.length >= 6);
  for (const alley of alleys) {
    for (let index = 0; index <= 20; index++) {
      const t = index / 20;
      const point = { x: alley.x1 + (alley.x2 - alley.x1) * t, y: alley.y1 + (alley.y2 - alley.y1) * t };
      assert.equal(map.isPointInsideDrivableSurface(point.x, point.y, 12), true, `${alley.id} is not drivable`);
      assert.equal(map.checkCollision(point.x, point.y, 10), null, `${alley.id} is blocked`);
    }
    assert.ok(map.roadNodes.some(node => Math.hypot(node.x - alley.x1, node.y - alley.y1) < 1));
    assert.ok(map.roadNodes.some(node => Math.hypot(node.x - alley.x2, node.y - alley.y2) < 1));
  }
  assert.ok(map.buildings.filter(building => building.id.startsWith('b_fill_')).length >= 8);
});

test('shop purchase is atomic and save migration repairs legacy skin ids', () => {
  const initial = { ...DEFAULT_SAVE_DATA, coins: 1500, ordersCompleted: 8, stats: { ...DEFAULT_SAVE_DATA.stats }, settings: { ...DEFAULT_SAVE_DATA.settings }, unlockedSkinIds: ['cruiser'] };
  const result = createSkinPurchase(initial, 'sport');
  assert.equal(result.status, 'success');
  assert.equal(initial.coins, 1500, 'purchase mutated the React save object');
  if (!('saveData' in result)) throw new Error('purchase should contain save data');
  const bought = result.saveData;
  assert.equal(bought.coins, 500);
  assert.equal(bought.selectedSkinId, 'sport');
  assert.deepEqual(bought.unlockedSkinIds, ['cruiser', 'sport']);
  const selectedAgain = createSkinPurchase(bought, 'sport');
  assert.equal(selectedAgain.status, 'alreadyOwned');
  if (!('saveData' in selectedAgain)) throw new Error('owned selection should contain save data');
  assert.equal(selectedAgain.saveData.coins, 500, 'selecting an owned car charged twice');

  const progressionLocked = createSkinPurchase({ ...initial, ordersCompleted: 7 }, 'sport');
  assert.deepEqual(progressionLocked, { status: 'notEnoughOrders', required: 8, completed: 7 });
  assert.equal(createSkinPurchase({ ...initial, coins: 999 }, 'sport').status, 'notEnoughCoins');

  const upgraded = createUpgradePurchase(initial, 'speed')!;
  assert.equal(upgraded.coins, 1400);
  assert.equal(upgraded.stats.speedLevel, 2);
  assert.equal(initial.stats.speedLevel, 1, 'upgrade mutated the original stats');

  const migrated = migrateSaveData({ ...initial, selectedSkinId: 'cyan', unlockedSkinIds: ['cyan', 'suv', 'missing'] });
  assert.equal(migrated.selectedSkinId, 'cruiser');
  assert.deepEqual(migrated.unlockedSkinIds, ['cruiser', 'suv']);
});

test('loaded save data replaces the engine snapshot and applies the selected car', () => {
  const engine = Object.create(GameEngine.prototype) as any;
  engine.car = { applyUpgrades: (stats: unknown, skin: unknown) => { engine.applied = { stats, skin }; } };
  const loaded = { ...DEFAULT_SAVE_DATA, coins: 3210, ordersCompleted: 22, selectedSkinId: 'suv', unlockedSkinIds: ['cruiser', 'suv'], stats: { speedLevel: 3, handlingLevel: 2, dashLevel: 4 }, settings: { ...DEFAULT_SAVE_DATA.settings } };
  engine.syncSaveData(loaded);
  assert.equal(engine.saveData.coins, 3210);
  assert.equal(engine.currentSkin.id, 'suv');
  loaded.coins = 0;
  assert.equal(engine.saveData.coins, 3210, 'engine retained a mutable React object');
});

test('car model stats remain distinct and upgrades scale their bases', () => {
  const cruiser = new Car(0, 0);
  const aerocar = new Car(0, 0);
  const suv = CAR_SKINS.find(skin => skin.id === 'suv')!;
  const sport = CAR_SKINS.find(skin => skin.id === 'sport')!;
  cruiser.applyUpgrades(DEFAULT_SAVE_DATA.stats, CAR_SKINS[0]);
  aerocar.applyUpgrades(DEFAULT_SAVE_DATA.stats, CAR_SKINS.find(skin => skin.id === 'aerocar')!);
  assert.ok(aerocar.maxSpeed >= cruiser.maxSpeed * 1.45);
  assert.ok(aerocar.acceleration > cruiser.acceleration * 1.5);
  assert.ok(suv.durability > sport.durability);
});

test('impact damage scales with force and persistent contact is cooled down', () => {
  assert.ok(calculateImpactDamage(28) < calculateImpactDamage(180));
  const car = new Car(0, 0);
  car.durability = 1;
  const first = car.applyCollisionDamage(180);
  const hpAfterFirst = car.hp;
  const repeated = car.applyCollisionDamage(180);
  assert.ok(first > 0);
  assert.equal(repeated, 0);
  assert.equal(car.hp, hpAfterFirst);
});

test('street, highway and alley widths match the expanded city scale', () => {
  const map = new CityMap();
  assert.equal(map.width, 8640);
  assert.equal(map.height, 8640);
  assert.ok(map.roadSegments.filter(segment => segment.kind === 'street').every(segment => segment.width >= 190 && segment.width <= 220));
  assert.ok(map.roadSegments.filter(segment => segment.kind === 'highway').every(segment => segment.width >= 280 && segment.width <= 330));
  assert.ok(map.roadSegments.filter(segment => segment.kind === 'alley').every(segment => segment.width >= 60 && segment.width <= 75));
  const longestStraight = Math.max(...map.roadSegments.map(segment =>
    Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1)));
  assert.ok(longestStraight >= CAR_SKINS[CAR_SKINS.length - 1].maxSpeed * 4,
    'the expanded city has no four-second high-speed straight');
});

test('camera profile adds smooth high-speed look-ahead and zoom while parking stays close', () => {
  const maxSpeed = 510;
  const low = getCameraProfile(0, maxSpeed);
  const medium = getCameraProfile(maxSpeed * 0.5, maxSpeed);
  const high = getCameraProfile(maxSpeed, maxSpeed);
  const parking = getCameraProfile(maxSpeed * 0.8, maxSpeed, true);
  assert.deepEqual(low, { lookAhead: 45, zoom: 1 });
  assert.ok(medium.lookAhead >= 120 && medium.lookAhead <= 180);
  assert.ok(medium.zoom >= 0.92 && medium.zoom <= 0.94);
  assert.ok(high.lookAhead >= 220 && high.lookAhead <= 320);
  assert.ok(high.zoom >= 0.84 && high.zoom <= 0.88);
  assert.ok(parking.lookAhead <= 75 && parking.zoom >= 0.97);
  assert.equal(speedToKmh(CAR_SKINS[CAR_SKINS.length - 1].maxSpeed), 170);
});

test('Space maps to brake, X maps to dash, and braking never engages reverse', () => {
  const engine = Object.create(GameEngine.prototype) as any;
  engine.input = { forward: 0, reverse: 0, steer: 0, brake: false, dash: false };
  engine.keyState = { Space: true };
  engine.updateKeyboardInput();
  assert.equal(engine.input.brake, true);
  assert.equal(engine.input.dash, false);
  engine.keyState = { KeyX: true };
  engine.input.dash = false;
  engine.updateKeyboardInput();
  assert.equal(engine.input.brake, false);
  assert.equal(engine.input.dash, true);

  const map = new CityMap();
  map.trafficCars = [];
  const car = new Car(2800 * CITY_GEOMETRY_SCALE, 2474 * CITY_GEOMETRY_SCALE);
  car.vx = 180;
  for (let index = 0; index < 30; index++) {
    car.update(1 / 60, { forward: 0, reverse: 0, steer: 0, brake: true, dash: false }, map, CAR_SKINS[0]);
  }
  assert.ok(car.vx >= 0 && car.vx < 1, 'Space brake reversed the car');
});

test('traffic follows lanes continuously and remains on rendered asphalt', () => {
  const map = new CityMap();
  const previous = new Map(map.trafficCars.map(car => [car.id, { x: car.x, y: car.y, angle: car.angle }]));
  for (let tick = 0; tick < 1800; tick++) {
    map.update(1 / 60);
    for (const car of map.trafficCars) {
      const before = previous.get(car.id)!;
      const movedX = car.x - before.x;
      const movedY = car.y - before.y;
      const moved = Math.hypot(movedX, movedY);
      assert.ok(moved < 8, `${car.id} teleported`);
      const angleDelta = Math.abs(Math.atan2(Math.sin(car.angle - before.angle), Math.cos(car.angle - before.angle)));
      assert.ok(angleDelta <= 0.15, `${car.id} snapped its heading`);
      if (moved > 0.001) {
        const tangent = Math.atan2(movedY, movedX);
        assert.ok(orientationDifference(car.angle, tangent) < 1e-7, `${car.id} body is not aligned with trajectory`);
      }
      if (car.activeTransitionId) {
        const transition = map.laneTransitions.find(candidate => candidate.id === car.activeTransitionId)!;
        assert.equal(car.transitionPoints, transition.points, `${car.id} did not use unified transition geometry`);
      }
      assert.equal(map.isPointOnRoad(car.x, car.y, 3), true, `${car.id} left the asphalt`);
      previous.set(car.id, { x: car.x, y: car.y, angle: car.angle });
    }
    for (let a = 0; a < map.trafficCars.length; a++) {
      for (let b = a + 1; b < map.trafficCars.length; b++) {
        assert.ok(Math.hypot(
          map.trafficCars[a].x - map.trafficCars[b].x,
          map.trafficCars[a].y - map.trafficCars[b].y,
        ) > 28, `${map.trafficCars[a].id} overlaps ${map.trafficCars[b].id}`);
      }
    }
  }
});

test('same-length NPC ids choose deterministic but diverse valid routes', () => {
  const map = new CityMap();
  const internals = map as unknown as {
    outgoingTransitions: Map<string, LaneTransition[]>;
    chooseNextLane: (car: TrafficCar, lane: CityMap['lanes'][number]) => CityMap['lanes'][number] | null;
  };
  const lane = map.lanes.find(candidate => candidate.id === 'road_2100_2100_3200_1900:0:forward')!;
  assert.ok((internals.outgoingTransitions.get(lane.id)?.length ?? 0) >= 2);
  const cars = map.trafficCars.filter(car => car.id.length === 'npc_14'.length);
  const choices = cars.map(car => internals.chooseNextLane(car, lane)?.id ?? null);
  assert.ok(choices.every(choice => choice !== null), 'deterministic chooser returned an invalid route');
  assert.ok(new Set(choices).size >= 2, 'same-length NPC ids still collapse to one route');
  for (let index = 0; index < cars.length; index++) {
    assert.equal(internals.chooseNextLane(cars[index], lane)?.id ?? null, choices[index],
      `${cars[index].id} route choice is not deterministic`);
  }
});

test('cross-lane collision prediction chooses one deterministic yielding NPC', () => {
  const map = new CityMap();
  const [first, second] = map.trafficCars;
  Object.assign(first, {
    x: 1_000, y: 1_000, angle: 0, speed: 100,
    currentLaneId: 'crossing-east', transitionPoints: [],
  });
  Object.assign(second, {
    x: 1_040, y: 1_040, angle: -Math.PI / 2, speed: 100,
    currentLaneId: 'crossing-north', transitionPoints: [],
  });
  const internals = map as unknown as {
    predictsCrossLaneCollision: (car: TrafficCar, other: TrafficCar) => boolean;
    yieldsForCrossLaneConflict: (car: TrafficCar, other: TrafficCar) => boolean;
  };
  assert.equal(internals.predictsCrossLaneCollision(first, second), true);
  const firstYields = internals.yieldsForCrossLaneConflict(first, second);
  const secondYields = internals.yieldsForCrossLaneConflict(second, first);
  assert.notEqual(firstYields, secondYields, 'crossing NPCs did not select one stable priority winner');
  assert.equal(internals.yieldsForCrossLaneConflict(first, second), firstYields,
    'cross-lane yield priority changed between identical evaluations');
});

test('transition-path reservations allow compatible flows and serialize physical conflicts', () => {
  const findPair = (map: CityMap, shouldConflict: boolean) => {
    for (const first of map.laneTransitions.filter(transition => transition.junctionId && transition.kind !== 'roundabout')) {
      for (const second of map.laneTransitions) {
        if (second.junctionId !== first.junctionId || second.fromLaneId === first.fromLaneId) continue;
        const conflicts = first.conflictingTransitionIds.includes(second.id);
        if (conflicts === shouldConflict) return [first, second] as const;
      }
    }
    throw new Error(`No ${shouldConflict ? 'conflicting' : 'compatible'} transition pair found`);
  };

  const compatibleMap = new CityMap();
  const oppositeStraights = compatibleMap.laneTransitions.flatMap((first, index) =>
    compatibleMap.laneTransitions.slice(index + 1).map(second => [first, second] as const))
    .find(([first, second]) => {
      if (first.kind !== 'straight' || second.kind !== 'straight' || first.junctionId !== second.junctionId) return false;
      const firstLane = compatibleMap.lanes.find(lane => lane.id === first.fromLaneId)!;
      const secondLane = compatibleMap.lanes.find(lane => lane.id === second.fromLaneId)!;
      return firstLane.roadId === secondLane.roadId && firstLane.direction !== secondLane.direction;
    });
  assert.ok(oppositeStraights);
  assert.equal(oppositeStraights![0].conflictingTransitionIds.includes(oppositeStraights![1].id), false,
    'opposite straight lanes incorrectly conflict');
  const compatible = findPair(compatibleMap, false);
  const compatibleCars = compatibleMap.trafficCars.slice(0, 2);
  stageCarForTransition(compatibleMap, compatibleCars[0], compatible[0]);
  stageCarForTransition(compatibleMap, compatibleCars[1], compatible[1]);
  compatibleMap.trafficCars = compatibleCars;
  let simultaneous = false;
  for (let tick = 0; tick < 180; tick++) {
    compatibleMap.update(1 / 60);
    simultaneous ||= compatibleCars[0].activeTransitionId === compatible[0].id &&
      compatibleCars[1].activeTransitionId === compatible[1].id;
  }
  assert.equal(simultaneous, true, 'compatible trajectories could not enter together');

  const conflictMap = new CityMap();
  const conflicting = findPair(conflictMap, true);
  const conflictCars = conflictMap.trafficCars.slice(0, 2);
  stageCarForTransition(conflictMap, conflictCars[0], conflicting[0]);
  stageCarForTransition(conflictMap, conflictCars[1], conflicting[1]);
  conflictMap.trafficCars = conflictCars;
  let conflictingActiveTogether = false;
  for (let tick = 0; tick < 180; tick++) {
    conflictMap.update(1 / 60);
    conflictingActiveTogether ||= conflictCars[0].activeTransitionId === conflicting[0].id &&
      conflictCars[1].activeTransitionId === conflicting[1].id;
  }
  assert.equal(conflictingActiveTogether, false, 'physically crossing trajectories entered together');
});

test('ordinary 90-degree turn completes at gameplay speed', () => {
  const map = new CityMap();
  const turn = map.laneTransitions.find(transition =>
    transition.kind !== 'straight' && transition.kind !== 'roundabout' &&
    Math.abs(transition.sweep - Math.PI / 2) < 0.05)!;
  const car = map.trafficCars[0];
  stageCarForTransition(map, car, turn);
  map.trafficCars = [car];
  let completedAt = Infinity;
  for (let tick = 0; tick < 300; tick++) {
    map.update(1 / 60);
    if (car.currentLaneId === turn.toLaneId) { completedAt = (tick + 1) / 60; break; }
  }
  assert.ok(completedAt < 3.5, `ordinary turn took ${completedAt.toFixed(2)} seconds`);
});

test('roundabouts use one legal direction and allow cars on separate sections', () => {
  const map = new CityMap();
  assert.equal(map.circularLanes.length, map.roundabouts.length);
  assert.ok(map.circularLanes.every(lane => lane.direction === 'counterclockwise'));
  const turns = map.laneTransitions.filter(transition => transition.kind === 'roundabout');
  assert.ok(turns.every(turn => map.circularLanes.find(lane => lane.id === turn.circularLaneId)?.direction === 'counterclockwise'));
  const pair = turns.flatMap((first, index) => turns.slice(index + 1).map(second => [first, second] as const))
    .find(([first, second]) => first.circularLaneId === second.circularLaneId &&
      !first.conflictingTransitionIds.includes(second.id));
  assert.ok(pair, 'no independent roundabout sections found');
  const cars = map.trafficCars.slice(0, 2);
  stageCarForTransition(map, cars[0], pair![0]);
  stageCarForTransition(map, cars[1], pair![1]);
  map.trafficCars = cars;
  let simultaneous = false;
  for (let tick = 0; tick < 240; tick++) {
    map.update(1 / 60);
    simultaneous ||= cars[0].activeTransitionId === pair![0].id && cars[1].activeTransitionId === pair![1].id;
  }
  assert.equal(simultaneous, true, 'one car locked the whole roundabout');
});

test('transition reservations serialize conflicts, expire, and release after exit', () => {
  const map = new CityMap();
  let observedReservations = 0;
  let observedWaiting = 0;
  const ownersSeen = new Set<string>();
  for (let tick = 0; tick < 1800; tick++) {
    map.update(1 / 60);
    const reservations = map.getTransitionReservations();
    observedReservations += reservations.size;
    observedWaiting += map.trafficCars.filter(car => car.waitingForJunction).length;
    const reservedByCars = map.trafficCars
      .filter(car => car.reservationZoneId !== null)
      .map(car => car.reservationZoneId as string);
    assert.equal(new Set(reservedByCars).size, reservedByCars.length, 'two NPCs own the same conflict zone');
    for (const reservation of reservations.values()) {
      ownersSeen.add(reservation.ownerId);
      assert.ok(reservation.expiresAt > 0, 'reservation has no lease');
    }
    for (const car of map.trafficCars.filter(candidate => candidate.transitionPoints.length > 0 && candidate.reservationZoneId)) {
      assert.ok(reservations.has(car.reservationZoneId!), `${car.id} entered an occupied zone without a reservation`);
    }
  }
  assert.ok(observedReservations > 0, 'traffic never reserved a transition');
  assert.ok(ownersSeen.size > 1, 'reservation was never released for another NPC');
  assert.ok(observedWaiting > 0, 'conflicting transitions never yielded');

  const internals = map as unknown as {
    transitionReservations: Map<string, { ownerId: string; transitionId: string; expiresAt: number }>;
  };
  internals.transitionReservations.set('conflict:expired', {
    ownerId: 'missing-car', transitionId: 'missing-transition', expiresAt: -1,
  });
  map.update(1 / 60);
  assert.equal(internals.transitionReservations.has('conflict:expired'), false, 'expired lease survived cleanup');

  const staleOwner = map.trafficCars[0];
  const abandoned = map.laneTransitions.find(transition => transition.conflictZoneId)!;
  staleOwner.reservationZoneId = abandoned.conflictZoneId;
  staleOwner.activeTransitionId = null;
  staleOwner.nextLaneId = null;
  staleOwner.laneProgress = 0.8;
  internals.transitionReservations.set(abandoned.conflictZoneId!, {
    ownerId: staleOwner.id, transitionId: abandoned.id, expiresAt: 1e9,
  });
  map.update(1 / 60);
  assert.equal(internals.transitionReservations.has(abandoned.conflictZoneId!), false,
    'route-changed owner kept a stale reservation');
});

test('120-second rolling progress monitor rejects stale blocking reasons', () => {
  const map = new CityMap();
  const previous = new Map(map.trafficCars.map(car => [car.id, { x: car.x, y: car.y }]));
  const travelled = new Map(map.trafficCars.map(car => [car.id, 0]));
  const maxWait = new Map(map.trafficCars.map(car => [car.id, 0]));
  const unexplainedStop = new Map(map.trafficCars.map(car => [car.id, 0]));
  const maxUnexplainedStop = new Map(map.trafficCars.map(car => [car.id, 0]));
  for (let tick = 0; tick < 7200; tick++) {
    map.update(1 / 60);
    for (const car of map.trafficCars) {
      const before = previous.get(car.id)!;
      const moved = Math.hypot(car.x - before.x, car.y - before.y);
      travelled.set(car.id, travelled.get(car.id)! + moved);
      previous.set(car.id, { x: car.x, y: car.y });
      maxWait.set(car.id, Math.max(maxWait.get(car.id)!, car.waitingDuration));
      const blocker = car.blockingCarId ? map.trafficCars.find(candidate => candidate.id === car.blockingCarId) : null;
      const vehicleAhead = car.blockingReason === 'vehicleAhead' && blocker &&
        Math.hypot(blocker.x - car.x, blocker.y - car.y) < 150;
      const reservedConflict = car.blockingReason === 'conflictZone' && blocker &&
        [...map.getTransitionReservations().values()].some(reservation => reservation.ownerId === blocker.id);
      const verified = Boolean(vehicleAhead || reservedConflict);
      const stoppedWithoutCause = moved < 0.08 && !verified;
      unexplainedStop.set(car.id, stoppedWithoutCause ? unexplainedStop.get(car.id)! + 1 / 60 : 0);
      maxUnexplainedStop.set(car.id, Math.max(maxUnexplainedStop.get(car.id)!, unexplainedStop.get(car.id)!));
    }
  }
  for (const car of map.trafficCars) {
    assert.ok(travelled.get(car.id)! > 800, `${car.id} made insufficient rolling progress`);
    assert.ok(maxWait.get(car.id)! <= 5.1, `${car.id} deadlocked on a conflict reservation`);
    assert.ok(maxUnexplainedStop.get(car.id)! <= 5.1, `${car.id} stopped without a verified blocker`);
  }
});

test('180-second traffic soak stays continuous, separated, on asphalt and making progress', () => {
  const map = new CityMap();
  const previous = new Map(map.trafficCars.map(car => [car.id, { x: car.x, y: car.y, angle: car.angle }]));
  const travelled = new Map(map.trafficCars.map(car => [car.id, 0]));
  const unexplainedStop = new Map(map.trafficCars.map(car => [car.id, 0]));
  const maxUnexplainedStop = new Map(map.trafficCars.map(car => [car.id, 0]));

  for (let tick = 0; tick < 10_800; tick++) {
    map.update(1 / 60);
    for (const car of map.trafficCars) {
      const before = previous.get(car.id)!;
      const movedX = car.x - before.x;
      const movedY = car.y - before.y;
      const moved = Math.hypot(movedX, movedY);
      assert.ok(moved < 8, `${car.id} teleported during the 180-second soak`);
      const angleDelta = Math.abs(Math.atan2(Math.sin(car.angle - before.angle), Math.cos(car.angle - before.angle)));
      assert.ok(angleDelta <= 0.15, `${car.id} snapped its heading during the 180-second soak`);
      if (moved > 0.001) {
        const tangent = Math.atan2(movedY, movedX);
        assert.ok(orientationDifference(car.angle, tangent) < 1e-7,
          `${car.id} body diverged from its trajectory during the 180-second soak`);
      }
      assert.equal(map.isPointOnRoad(car.x, car.y, 3), true,
        `${car.id} left the asphalt during the 180-second soak`);
      travelled.set(car.id, travelled.get(car.id)! + moved);
      previous.set(car.id, { x: car.x, y: car.y, angle: car.angle });

      const blocker = car.blockingCarId ? map.trafficCars.find(candidate => candidate.id === car.blockingCarId) : null;
      const vehicleAhead = car.blockingReason === 'vehicleAhead' && blocker &&
        Math.hypot(blocker.x - car.x, blocker.y - car.y) < 170;
      const reservedConflict = car.blockingReason === 'conflictZone' && blocker &&
        [...map.getTransitionReservations().values()].some(reservation => reservation.ownerId === blocker.id);
      const stoppedWithoutCause = moved < 0.08 && !vehicleAhead && !reservedConflict;
      unexplainedStop.set(car.id, stoppedWithoutCause ? unexplainedStop.get(car.id)! + 1 / 60 : 0);
      maxUnexplainedStop.set(car.id, Math.max(maxUnexplainedStop.get(car.id)!, unexplainedStop.get(car.id)!));
    }

    for (let a = 0; a < map.trafficCars.length; a++) {
      const first = map.trafficCars[a];
      const firstCircles = vehicleCollisionCircles(first);
      for (let b = a + 1; b < map.trafficCars.length; b++) {
        const second = map.trafficCars[b];
        const secondCircles = vehicleCollisionCircles(second);
        for (const firstCircle of firstCircles) {
          for (const secondCircle of secondCircles) {
            assert.ok(Math.hypot(firstCircle.x - secondCircle.x, firstCircle.y - secondCircle.y) >=
              firstCircle.radius + secondCircle.radius,
            `${first.id} / ${second.id} collision circles overlap at tick ${tick}: ` +
              `${first.currentLaneId} (${first.x.toFixed(1)},${first.y.toFixed(1)}) ${first.blockingReason ?? '-'} / ` +
              `${second.currentLaneId} (${second.x.toFixed(1)},${second.y.toFixed(1)}) ${second.blockingReason ?? '-'}`);
          }
        }
      }
    }
  }

  for (const car of map.trafficCars) {
    assert.ok(travelled.get(car.id)! > 1_200, `${car.id} stalled permanently during the 180-second soak`);
    assert.ok(maxUnexplainedStop.get(car.id)! <= 5.1,
      `${car.id} stopped without a verified blocker during the 180-second soak`);
  }
});

test('stuck traffic softly backs up and replans without a visible teleport', () => {
  const map = new CityMap();
  const bot = map.trafficCars[0];
  const internals = map as unknown as {
    laneById: Map<string, { start: { x: number; y: number }; end: { x: number; y: number }; length: number }>;
    chooseNextLane: () => null;
  };
  const lane = internals.laneById.get(bot.currentLaneId)!;
  map.trafficCars = [bot];
  bot.laneProgress = 1;
  bot.x = lane.end.x;
  bot.y = lane.end.y;
  bot.speed = 0;
  bot.targetSpeed = 120;
  internals.chooseNextLane = () => null;
  let maxMovement = 0;
  for (let tick = 0; tick < 165; tick++) {
    const previous = { x: bot.x, y: bot.y };
    map.update(1 / 60);
    maxMovement = Math.max(maxMovement, Math.hypot(bot.x - previous.x, bot.y - previous.y));
  }
  assert.ok(bot.recoveryCount >= 1, 'stuck detector did not recover the NPC');
  assert.ok(maxMovement < 8, 'stuck recovery teleported the NPC');
  assert.equal(bot.nextLaneId, null);
});

test('pickup requires 7/9 footprint points, alignment, low speed and a 0.7 second dwell', () => {
  const map = new CityMap();
  const orders = new OrdersManager(map);
  const order = orders.spawnOrder();
  const zone = map.parkingZones.find(candidate => candidate.id === order.pickupZoneId)!;
  const base = { x: zone.x, y: zone.y, vx: 0, vy: 0, angle: zone.angle, length: 56, width: 30 };

  for (let index = 0; index < 60; index++) {
    orders.update(1 / 60, {
      ...base,
      x: zone.x + Math.cos(zone.angle) * 38,
      y: zone.y + Math.sin(zone.angle) * 38,
    });
  }
  assert.equal(order.status, 'pickup', 'partial nose entry must not count');
  for (let index = 0; index < 60; index++) orders.update(1 / 60, { ...base, vx: 11 });
  assert.equal(order.status, 'pickup', 'a moving car must not count');
  for (let index = 0; index < 60; index++) orders.update(1 / 60, { ...base, angle: zone.angle + Math.PI / 2 });
  assert.equal(order.status, 'pickup', 'a perpendicular car must not count');
  for (let index = 0; index < 41; index++) orders.update(1 / 60, base);
  assert.equal(order.status, 'pickup', 'dwell must not complete early');
  for (let index = 0; index < 2; index++) orders.update(1 / 60, base);
  assert.equal(order.status, 'in_transit');
});

test('high speed vehicle footprint cannot tunnel through a building', () => {
  const map = new CityMap();
  map.trafficCars = [];
  const wall = map.buildings.find(building => building.id === 'b_dt_0_0')!;
  const car = new Car(2600 * CITY_GEOMETRY_SCALE, 2700 * CITY_GEOMETRY_SCALE);
  car.vx = 800;
  car.vy = 0;
  for (let index = 0; index < 20; index++) {
    car.update(1 / 60, { forward: 0, reverse: 0, steer: 0, brake: false, dash: false }, map, CAR_SKINS[0]);
  }
  assert.ok(car.x < wall.x - car.length / 2 + 1);
  assert.ok(Math.abs(car.vx) < 1);
});

test('wall response removes inward velocity while preserving tangential slide', () => {
  const map = new CityMap();
  map.trafficCars = [];
  const wall = map.buildings.find(building => building.id === 'b_dt_0_0')!;
  const car = new Car(wall.x - 12, wall.y + wall.height / 2);
  car.angle = Math.PI / 2;
  car.vx = 35;
  car.vy = 140;
  const startX = car.x;
  const startY = car.y;
  car.update(1 / 60, { forward: 0, reverse: 0, steer: 0, brake: false, dash: false }, map, CAR_SKINS[0]);
  assert.ok(car.x < startX);
  assert.ok(car.y > startY);
  assert.ok(car.vy > 80);
  assert.ok(car.vx <= 0.1);
});
