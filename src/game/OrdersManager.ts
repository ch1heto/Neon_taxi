import { Order, FloatingText } from '../types/game';
import { CityMap } from './CityMap';
import { AudioEngine } from './AudioEngine';
import { orientationDifference, pointInRotatedRect, vehicleFootprintSamples } from './geometry';
import { EXPRESS_PROBABILITY, getExpressTargetTime, getNormalReward, getOrderReward, getRouteDistance } from './OrderEconomy';

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

  public cancelCurrentOrder() {
    this.currentOrder = null;
    this.map.invalidateGpsRoute();
    this.parkingHold = 0;
    this.parkingFeedback = '';
  }

  public spawnOrder(): Order {
    const passengerNames = [
      'Алекс Нео', 'Крис Кибер', 'Ева Скай', 'Рекс Дроид',
      'Нова Тек', 'Майя Волна', 'Сэм Портер', 'Винсент Глитч',
      'Хлоя Вейв', 'Лео Драйв', 'Анна Кодер', 'Макс Турбо',
    ];
    const zones = this.map.parkingZones;
    if (zones.length < 2) throw new Error('CityMap requires at least two parking zones');
    const pickupZone = zones[Math.floor(Math.random() * zones.length)];
    let destZone = zones[Math.floor(Math.random() * zones.length)];
    let tries = 0;
    while (tries < 25 && (destZone.id === pickupZone.id || Math.hypot(destZone.x - pickupZone.x, destZone.y - pickupZone.y) < 900)) {
      destZone = zones[Math.floor(Math.random() * zones.length)];
      tries++;
    }
    const routeDistance = getRouteDistance(this.map,
      { x: pickupZone.x, y: pickupZone.y, angle: pickupZone.angle },
      { x: destZone.x, y: destZone.y });
    const orderType = Math.random() < EXPRESS_PROBABILITY ? 'express' : 'normal';
    const order: Order = {
      id: `ord_${Date.now()}_${++this.nextOrderId}`,
      passengerName: passengerNames[Math.floor(Math.random() * passengerNames.length)],
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
      targetTime: getExpressTargetTime(routeDistance),
      pickupElapsed: 0,
      rideElapsed: 0,
      status: 'pickup',
    };
    this.currentOrder = order;
    this.shiftActive = true;
    this.map.invalidateGpsRoute();
    this.parkingHold = 0;
    this.parkingFeedback = '';
    return order;
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
      return { completed: false, justPickedUp: true };
    }

    order.status = 'completed';
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
