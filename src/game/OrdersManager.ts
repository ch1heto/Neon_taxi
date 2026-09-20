import { Order, FloatingText, ParkingZone, PassengerType } from '../types/game';
import { CityMap } from './CityMap';
import { AudioEngine } from './AudioEngine';
import { orientationDifference, pointInRotatedRect, vehicleFootprintSamples } from './geometry';
import { getExpressTargetTime, getNormalReward, getOrderReward, getRouteDistance } from './OrderEconomy';
import {
  getCollisionQualityPenalty,
  getPassengerDefinition,
  LONG_DISTANCE_MIN_ROUTE_DISTANCE,
  PASSENGER_NAMES,
  selectPassengerType,
} from './PassengerSystem';

export interface ParkingCarState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  length: number;
  width: number;
}

export class OrdersManager {
  private currentOrder: Order | null = null;
  private shiftActive = false;
  private nextOrderId = 0;
  private map: CityMap;
  public floatingTexts: FloatingText[] = [];
  private parkingHold = 0;
  private parkingFeedback = '';
  private readonly parkingHoldRequired = 0.7;
  private onOrderCompleteCallback: ((order: Order, reward: number) => void) | null = null;

  constructor(map: CityMap) { this.map = map; }

  public setOnOrderComplete(cb: (order: Order, reward: number) => void) {
    this.onOrderCompleteCallback = cb;
  }

  public getCurrentOrder(): Order | null { return this.currentOrder; }
  public isShiftActive(): boolean { return this.shiftActive; }

  public startShift(): Order {
    this.shiftActive = true;
    return this.currentOrder ?? this.spawnOrder();
  }

  public requestNextOrder(): Order | null {
    return this.shiftActive && !this.currentOrder ? this.spawnOrder() : this.currentOrder;
  }

  public refuseOrder() {
    this.shiftActive = false;
    this.cancelCurrentOrder();
  }

  /** Reject one offer while keeping the current shift alive. */
  public rejectCurrentOrder(): boolean {
    if (!this.shiftActive || !this.currentOrder) return false;
    this.cancelCurrentOrder();
    return true;
  }

  public endShift(): boolean {
    if (!this.shiftActive || this.currentOrder) return false;
    this.shiftActive = false;
    this.map.invalidateGpsRoute();
    return true;
  }

  public cancelCurrentOrder() {
    this.currentOrder = null;
    this.map.invalidateGpsRoute();
    this.parkingHold = 0;
    this.parkingFeedback = '';
  }

  public spawnOrder(): Order {
    const zones = this.map.parkingZones;
    if (zones.length < 2) throw new Error('CityMap requires at least two parking zones');
    const pickupZone = zones[Math.floor(Math.random() * zones.length)];
    const passengerType = selectPassengerType();
    const passenger = getPassengerDefinition(passengerType);
    const { zone: destZone, routeDistance } = this.selectDestination(pickupZone, passengerType);
    const orderType = passenger.timed ? 'express' : 'normal';
    const order: Order = {
      id: `ord_${Date.now()}_${++this.nextOrderId}`,
      passengerName: PASSENGER_NAMES[Math.floor(Math.random() * PASSENGER_NAMES.length)],
      passengerType,
      passengerDialogue: passenger.dialogue[Math.floor(Math.random() * passenger.dialogue.length)],
      pickupDistrict: pickupZone.district.toUpperCase(),
      destinationDistrict: destZone.district.toUpperCase(),
      pickupSpotName: pickupZone.name,
      destinationSpotName: destZone.name,
      pickupX: pickupZone.x,
      pickupY: pickupZone.y,
      pickupAngle: pickupZone.angle,
      destinationX: destZone.x,
      destinationY: destZone.y,
      destinationAngle: destZone.angle,
      pickupZoneId: pickupZone.id,
      destinationZoneId: destZone.id,
      routeDistance,
      orderType,
      baseReward: getNormalReward(routeDistance),
      targetTime: getExpressTargetTime(routeDistance) * passenger.targetTimeModifier,
      pickupElapsed: 0,
      rideElapsed: 0,
      rideQuality: 100,
      strongCollisions: 0,
      rushSuccess: false,
      perfectRide: false,
      earnedXp: 0,
      driverXpBefore: 0,
      driverXpAfter: 0,
      levelBefore: 1,
      levelAfter: 1,
      status: 'pickup',
    };
    this.currentOrder = order;
    this.shiftActive = true;
    this.map.invalidateGpsRoute();
    this.parkingHold = 0;
    this.parkingFeedback = '';
    return order;
  }

  private selectDestination(pickupZone: ParkingZone, passengerType: PassengerType): {
    zone: ParkingZone;
    routeDistance: number;
  } {
    const candidates = this.map.parkingZones.filter(zone => zone.id !== pickupZone.id);
    if (passengerType === 'LONG_DISTANCE') {
      const routed = candidates.map(zone => ({
        zone,
        routeDistance: getRouteDistance(this.map,
          { x: pickupZone.x, y: pickupZone.y, angle: pickupZone.angle }, zone),
      }));
      const longRoutes = routed.filter(candidate => candidate.routeDistance >= LONG_DISTANCE_MIN_ROUTE_DISTANCE);
      const pool = longRoutes.length > 0
        ? longRoutes
        : routed.sort((a, b) => b.routeDistance - a.routeDistance).slice(0, 1);
      return pool[Math.floor(Math.random() * pool.length)];
    }

    let destination = candidates[Math.floor(Math.random() * candidates.length)];
    for (let tries = 0; tries < 25 && Math.hypot(
      destination.x - pickupZone.x,
      destination.y - pickupZone.y,
    ) < 900; tries++) {
      destination = candidates[Math.floor(Math.random() * candidates.length)];
    }
    return {
      zone: destination,
      routeDistance: getRouteDistance(this.map,
        { x: pickupZone.x, y: pickupZone.y, angle: pickupZone.angle }, destination),
    };
  }

  public recordStrongCollision(intensity: number): number {
    const order = this.currentOrder;
    if (!order || order.status !== 'in_transit') return 0;
    const penalty = getCollisionQualityPenalty(order.passengerType, intensity);
    if (penalty <= 0) return 0;
    order.strongCollisions += 1;
    order.rideQuality = Math.max(0, order.rideQuality - penalty);
    return penalty;
  }

  public recordAggressiveDriving(dt: number, severity = 1): void {
    const order = this.currentOrder;
    if (!order || order.status !== 'in_transit' || order.passengerType !== 'CAUTIOUS') return;
    const safeSeverity = Number.isFinite(severity) ? Math.max(0, Math.min(1, severity)) : 0;
    order.rideQuality = Math.max(0, order.rideQuality - Math.max(0, dt) * 1.2 * safeSeverity);
  }

  public update(dt: number, car: ParkingCarState): { completed: boolean; reward?: number; justPickedUp?: boolean } {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const text = this.floatingTexts[i];
      text.y -= dt * 40;
      text.life -= dt;
      if (text.life <= 0) this.floatingTexts.splice(i, 1);
    }
    if (!this.currentOrder) {
      return { completed: false };
    }

    const order = this.currentOrder;
    if (order.status === 'pickup') order.pickupElapsed += dt;
    else if (order.status === 'in_transit') order.rideElapsed += dt;
    const zoneId = order.status === 'pickup' ? order.pickupZoneId : order.destinationZoneId;
    const zone = this.map.parkingZones.find(candidate => candidate.id === zoneId);
    if (!zone) {
      this.parkingHold = 0;
      this.parkingFeedback = 'ЗАЕДЬТЕ В ЗОНУ';
      return { completed: false };
    }

    const samplesInside = vehicleFootprintSamples(car).filter(point => pointInRotatedRect(point, zone)).length;
    const positionValid = samplesInside >= 7;
    const speedValid = Math.hypot(car.vx, car.vy) <= 10;
    const alignmentValid = orientationDifference(car.angle, zone.angle) <= Math.PI / 6;
    if (positionValid && speedValid && alignmentValid) {
      this.parkingHold = Math.min(this.parkingHoldRequired, this.parkingHold + dt);
      const verb = order.status === 'pickup' ? 'ПОСАДКА' : 'ВЫСАДКА';
      this.parkingFeedback = `${verb}... ${Math.round((this.parkingHold / this.parkingHoldRequired) * 100)}%`;
    } else {
      this.parkingHold = 0;
      this.parkingFeedback = !positionValid ? 'ЗАЕДЬТЕ В ЗОНУ' : !speedValid ? 'ОСТАНОВИТЕСЬ' : 'ВЫРОВНЯЙТЕ МАШИНУ';
    }

    if (this.parkingHold < this.parkingHoldRequired) return { completed: false };
    this.parkingHold = 0;
    this.parkingFeedback = '';
    if (order.status === 'pickup') {
      order.status = 'in_transit';
      this.map.invalidateGpsRoute();
      AudioEngine.getInstance().playPickupSound();
      this.addFloatingText(order.pickupX, order.pickupY - 30, 'ПАССАЖИР СЕЛ! В ПУТЬ 🚗', '#38bdf8');
      this.addFloatingText(order.pickupX, order.pickupY - 55, `«${order.passengerDialogue}»`, '#e2e8f0');
      return { completed: false, justPickedUp: true };
    }

    order.status = 'completed';
    order.rideQuality = Math.round(Math.max(0, Math.min(100, order.rideQuality)));
    order.rushSuccess = order.passengerType === 'RUSH' && order.rideElapsed <= order.targetTime;
    const totalReward = getOrderReward(order);
    AudioEngine.getInstance().playDeliverySuccessSound();
    AudioEngine.getInstance().playCoinSound();
    this.addFloatingText(order.destinationX, order.destinationY - 40, `+${totalReward} МОНЕТ! 🎉`, '#facc15');
    this.onOrderCompleteCallback?.(order, totalReward);
    this.currentOrder = null;
    this.map.invalidateGpsRoute();
    return { completed: true, reward: totalReward };
  }

  public addFloatingText(x: number, y: number, text: string, color: string) {
    this.floatingTexts.push({ id: 'ft_' + Math.random(), x, y, text, color, life: 1.5, maxLife: 1.5 });
  }

  public render(ctx: CanvasRenderingContext2D, carX: number, carY: number, carAngle: number) {
    if (!this.currentOrder) return;
    const order = this.currentOrder;
    const targetX = order.status === 'pickup' ? order.pickupX : order.destinationX;
    const targetY = order.status === 'pickup' ? order.pickupY : order.destinationY;
    this.map.renderGpsPath(ctx, carX, carY, carAngle, targetX, targetY, order.status === 'pickup' ? '#facc15' : '#10b981');

    const activeZoneId = order.status === 'pickup' ? order.pickupZoneId : order.destinationZoneId;
    const activeZone = this.map.parkingZones.find(candidate => candidate.id === activeZoneId);
    if (activeZone) {
      const spotName = order.status === 'pickup' ? order.pickupSpotName : order.destinationSpotName;
      this.map.renderParkingBay(ctx, activeZone, order.status === 'in_transit', spotName);
      if (this.parkingFeedback && Math.hypot(carX - activeZone.x, carY - activeZone.y) < 230) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)';
        ctx.lineWidth = 4;
        ctx.font = '900 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const feedbackY = activeZone.y + activeZone.height / 2 + 28;
        ctx.strokeText(this.parkingFeedback, activeZone.x, feedbackY);
        ctx.fillText(this.parkingFeedback, activeZone.x, feedbackY);
        ctx.restore();
      }
    }

    for (const text of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, text.life / text.maxLife);
      ctx.fillStyle = text.color;
      ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text.text, text.x, text.y);
      ctx.restore();
    }
  }
}
