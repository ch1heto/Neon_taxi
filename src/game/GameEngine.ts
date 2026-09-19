import { Car } from './Car';
import { CITY_GEOMETRY_SCALE, CityMap, DEBUG_PHYSICS } from './CityMap';
import { OrdersManager } from './OrdersManager';
import { AudioEngine } from './AudioEngine';
import { ParticleSystem } from './Particles';
import { YandexAPI } from '../services/YandexAPI';
import { CAR_SKINS, getUpgradeCost } from './Skins';
import { PlayerSaveData, CarSkin, Order } from '../types/game';
export { speedToKmh } from './VehicleMetrics';
import {
  clampFuel,
  consumeFuelForMovement,
  createRefuelPurchase,
  fuelSpeedMultiplier,
  REFUEL_MAX_SPEED,
  refuelPrice,
  stationContainsPoint,
} from './FuelSystem';
import { PassengerAutoDock } from './PassengerAutoDock';

export interface GameInputState {
  forward: number;
  reverse: number;
  steer: number;
  brake: boolean;
  dash: boolean;
}

export interface FuelStationStatus {
  stationId: string;
  stationName: string;
  cost: number;
  full: boolean;
}

export const GAMEPLAY_AUTOSAVE_INTERVAL_SECONDS = 25;

export function getCameraProfile(speed: number, maxSpeed: number, nearParking = false) {
  const ratio = Math.max(0, Math.min(1, speed / Math.max(1, maxSpeed)));
  const smoothRatio = ratio * ratio * (3 - 2 * ratio);
  return {
    lookAhead: nearParking ? Math.min(75, 45 + 255 * smoothRatio) : 45 + 255 * smoothRatio,
    zoom: nearParking ? 0.98 : 1 - 0.14 * smoothRatio,
  };
}

export type PurchaseResult =
  | { status: 'success'; saveData: PlayerSaveData }
  | { status: 'alreadyOwned'; saveData: PlayerSaveData }
  | { status: 'notEnoughCoins'; missingCoins: number }
  | { status: 'notEnoughOrders'; required: number; completed: number }
  | { status: 'invalidSkin' }
  | { status: 'saveError' };

export function createSkinPurchase(
  saveData: PlayerSaveData,
  skinId: string,
  availableSkins: readonly CarSkin[] = CAR_SKINS,
): PurchaseResult {
  const skin = availableSkins.find(candidate => candidate.id === skinId);
  if (!skin) return { status: 'invalidSkin' };
  const unlocked = saveData.unlockedSkinIds.includes(skinId);
  if (!unlocked && saveData.ordersCompleted < skin.requiredOrders) {
    return { status: 'notEnoughOrders', required: skin.requiredOrders, completed: saveData.ordersCompleted };
  }
  if (!unlocked && saveData.coins < skin.price) {
    return { status: 'notEnoughCoins', missingCoins: skin.price - saveData.coins };
  }
  const nextSave = {
    ...saveData,
    coins: unlocked ? saveData.coins : saveData.coins - skin.price,
    selectedSkinId: skinId,
    unlockedSkinIds: unlocked ? [...saveData.unlockedSkinIds] : [...saveData.unlockedSkinIds, skinId],
    stats: { ...saveData.stats },
    settings: { ...saveData.settings },
  };
  return { status: unlocked ? 'alreadyOwned' : 'success', saveData: nextSave };
}

export function createUpgradePurchase(
  saveData: PlayerSaveData,
  type: 'speed' | 'handling' | 'dash',
): PlayerSaveData | null {
  const currentLevel = type === 'speed'
    ? saveData.stats.speedLevel
    : type === 'handling'
      ? saveData.stats.handlingLevel
      : saveData.stats.dashLevel;
  const cost = getUpgradeCost(type, currentLevel);
  if (cost === null || saveData.coins < cost) return null;
  const stats = { ...saveData.stats, [`${type}Level`]: currentLevel + 1 } as PlayerSaveData['stats'];
  return {
    ...saveData,
    coins: saveData.coins - cost,
    stats,
    unlockedSkinIds: [...saveData.unlockedSkinIds],
    settings: { ...saveData.settings },
  };
}

export class GameEngine {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;

  public map: CityMap;
  public car: Car;
  public orders: OrdersManager;
  public passengerAutoDock: PassengerAutoDock;
  public particles: ParticleSystem;
  public yandexApi: YandexAPI;
  public audio: AudioEngine;

  public saveData: PlayerSaveData;
  public currentSkin: CarSkin;

  // Камера
  public camX = 0;
  public camY = 0;
  public cameraZoom = 1;

  // Тряска экрана и визуальная вспышка при столкновениях
  private shakeTimer = 0;
  private shakeIntensity = 0;
  private redFlashAlpha = 0;
  private recoveryTimer = 0;
  private damageMessageTimer = 0;
  private radarCache: HTMLCanvasElement | null = null;
  private purchaseInFlight = false;
  private rewardedOrders = new Set<string>();
  private completedRewards = new Map<string, number>();
  private fuelDirty = false;
  private fuelSaveElapsed = 0;
  private refuelFeedback = '';
  private refuelFeedbackTimer = 0;

  // Игровой цикл
  private isRunning = false;
  private isPaused = false;
  private uiPaused = false;
  private visibilityPaused = false;
  private removeInputListeners: (() => void) | null = null;
  private removeVisibilityListener: (() => void) | null = null;
  private lastTime = 0;
  private animFrameId: number | null = null;
  private accumulator = 0;
  private readonly fixedTimestep = 1 / 60;
  private readonly maxPhysicsSubsteps = 6;

  // Управление
  public input: GameInputState = {
    forward: 0,
    reverse: 0,
    steer: 0,
    brake: false,
    dash: false,
  };

  private keyState: Record<string, boolean> = {};

  // Слушатели событий
  private onDataChangeCallback: ((data: PlayerSaveData) => void) | null = null;
  private onOrderCompletePromptCallback: ((order: Order, reward: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, initialSaveData: PlayerSaveData) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Canvas 2D context not supported');
    }
    this.ctx = context;

    this.saveData = { ...this.cloneSaveData(initialSaveData), fuel: clampFuel(initialSaveData.fuel) };
    this.currentSkin = CAR_SKINS.find(s => s.id === initialSaveData.selectedSkinId) || CAR_SKINS[0];

    this.map = new CityMap();
    this.particles = new ParticleSystem();

    // Старт на северном проспекте Downtown, вне центрального острова roundabout.
    this.car = new Car(3200 * CITY_GEOMETRY_SCALE, 2700 * CITY_GEOMETRY_SCALE);
    this.car.angle = -Math.PI / 2;
    this.car.applyUpgrades(this.saveData.stats, this.currentSkin);
    this.car.setRuntimePerformanceMultiplier(fuelSpeedMultiplier(this.saveData.fuel));

    // 4.2 Тряска экрана и визуальная отдача при ударе
    this.car.onCrashCallback = (intensity) => {
      this.triggerScreenShake(intensity);
      this.particles.spawnSparks(this.car.x, this.car.y, 14, '#f59e0b');
    };

    this.orders = new OrdersManager(this.map);
    this.passengerAutoDock = new PassengerAutoDock(this.map);
    this.yandexApi = YandexAPI.getInstance();
    this.audio = AudioEngine.getInstance();

    this.camX = this.car.x;
    this.camY = this.car.y;

    // Регистрация коллбэков заказов
    this.orders.setOnOrderComplete((order, reward) => {
      this.handleOrderComplete(order, reward);
      this.particles.spawnCoinSparks(this.car.x, this.car.y, 25);
    });

    this.setupInputs();
    this.setupVisibilityListener();
  }

  public triggerScreenShake(intensity: number) {
    this.shakeIntensity = Math.min(18, intensity * 16);
    this.shakeTimer = 0.28;
    this.redFlashAlpha = Math.min(0.35, intensity * 0.4);
  }

  public setOnDataChange(cb: (data: PlayerSaveData) => void) {
    this.onDataChangeCallback = cb;
  }

  public setOnOrderCompletePrompt(cb: (order: Order, reward: number) => void) {
    this.onOrderCompletePromptCallback = cb;
  }

  public startShift() { return this.orders.startShift(); }
  public refuseOrder() {
    this.passengerAutoDock.cancel();
    this.orders.refuseOrder();
  }
  public requestNextOrder() { return this.orders.requestNextOrder(); }

  public claimRewardedBonus(orderId: string): boolean {
    const reward = this.completedRewards.get(orderId);
    if (reward === undefined || this.rewardedOrders.has(orderId)) return false;
    this.rewardedOrders.add(orderId);
    this.saveData = { ...this.saveData, coins: this.saveData.coins + reward,
      highScore: Math.max(this.saveData.highScore, this.saveData.coins + reward) };
    this.saveAndNotify();
    return true;
  }

  public syncSaveData(saveData: PlayerSaveData) {
    this.saveData = { ...this.cloneSaveData(saveData), fuel: clampFuel(saveData.fuel) };
    this.currentSkin = CAR_SKINS.find(s => s.id === this.saveData.selectedSkinId) || CAR_SKINS[0];
    this.car.applyUpgrades(this.saveData.stats, this.currentSkin);
    this.car.setRuntimePerformanceMultiplier(fuelSpeedMultiplier(this.saveData.fuel));
  }

  public updateSkin(skinId: string) {
    const skin = CAR_SKINS.find(s => s.id === skinId);
    if (skin) {
      this.currentSkin = skin;
      this.saveData = { ...this.saveData, selectedSkinId: skinId };
      this.car.applyUpgrades(this.saveData.stats, skin);
      this.saveAndNotify();
    }
  }

  public updateStats(stats: PlayerSaveData['stats']) {
    this.saveData.stats = { ...stats };
    this.car.applyUpgrades(this.saveData.stats, this.currentSkin);
    this.saveAndNotify();
  }

  public async purchaseSkin(skinId: string): Promise<PurchaseResult> {
    if (this.purchaseInFlight) return { status: 'saveError' };
    const result = createSkinPurchase(this.saveData, skinId);
    if (!('saveData' in result)) return result;
    const skin = CAR_SKINS.find(candidate => candidate.id === skinId);
    if (!skin) return { status: 'invalidSkin' };
    this.purchaseInFlight = true;
    const previousSave = this.cloneSaveData(this.saveData);
    const previousSkin = this.currentSkin;
    try {
      this.saveData = this.yandexApi.prepareSaveData(result.saveData);
      this.currentSkin = skin;
      this.car.applyUpgrades(this.saveData.stats, skin);
      await this.yandexApi.savePlayerData(this.saveData);
      this.onDataChangeCallback?.(this.cloneSaveData(this.saveData));
      return { ...result, saveData: this.cloneSaveData(this.saveData) };
    } catch (error) {
      console.warn('[GameEngine] Atomic car purchase save failed:', error);
      this.saveData = previousSave;
      this.currentSkin = previousSkin;
      this.car.applyUpgrades(previousSave.stats, previousSkin);
      return { status: 'saveError' };
    } finally {
      this.purchaseInFlight = false;
    }
  }

  public purchaseUpgrade(type: 'speed' | 'handling' | 'dash'): boolean {
    const nextSave = createUpgradePurchase(this.saveData, type);
    if (!nextSave) return false;
    this.saveData = nextSave;
    this.car.applyUpgrades(nextSave.stats, this.currentSkin);
    this.saveAndNotify();
    return true;
  }

  public addCoins(amount: number) {
    this.saveData = { ...this.saveData, coins: this.saveData.coins + amount };
    this.saveAndNotify();
  }

  public spendCoins(amount: number): boolean {
    if (this.saveData.coins >= amount) {
      this.saveData = { ...this.saveData, coins: this.saveData.coins - amount };
      this.saveAndNotify();
      return true;
    }
    return false;
  }

  public updateSettings(settings: Partial<PlayerSaveData['settings']>) {
    this.saveData = { ...this.saveData, settings: { ...this.saveData.settings, ...settings } };
    this.saveAndNotify();
  }

  private cloneSaveData(data: PlayerSaveData): PlayerSaveData {
    return {
      ...data,
      stats: { ...data.stats },
      unlockedSkinIds: [...data.unlockedSkinIds],
      settings: { ...data.settings },
    };
  }

  private saveAndNotify() {
    const snapshot = this.yandexApi.prepareSaveData(this.cloneSaveData(this.saveData));
    this.saveData = snapshot;
    this.fuelDirty = false;
    this.fuelSaveElapsed = 0;
    void this.yandexApi.savePlayerData(snapshot).catch(error => console.warn('[GameEngine] Save failed:', error));
    this.onDataChangeCallback?.(snapshot);
  }

  private handleOrderComplete(order: Order, reward: number) {
    this.saveData = {
      ...this.saveData,
      coins: this.saveData.coins + reward,
      ordersCompleted: this.saveData.ordersCompleted + 1,
      highScore: Math.max(this.saveData.highScore, this.saveData.coins + reward),
    };
    this.saveAndNotify();
    this.completedRewards.set(order.id, reward);
    this.onOrderCompletePromptCallback?.(order, reward);

  }

  public setPaused(paused: boolean) {
    this.uiPaused = paused;
    this.refreshPauseState();
    if (paused) this.passengerAutoDock.cancel();
    if (paused && this.fuelDirty) this.saveAndNotify();
  }

  private refreshPauseState() {
    this.isPaused = this.uiPaused || this.visibilityPaused;
    this.audio.setMuted(this.isPaused);
  }

  private setupInputs() {
    const onKeyDown = (e: KeyboardEvent) => {
      this.audio.unlock();
      if (e.code === 'KeyF' && !e.repeat) this.tryRefuel();
      this.keyState[e.code] = true;
      this.updateKeyboardInput();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keyState[e.code] = false;
      this.updateKeyboardInput();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    this.removeInputListeners = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }

  private updateKeyboardInput() {
    let fwd = 0;
    let rev = 0;
    let str = 0;

    if (this.keyState['KeyW'] || this.keyState['ArrowUp']) fwd = 1;
    if (this.keyState['KeyS'] || this.keyState['ArrowDown']) rev = 1;
    if (this.keyState['KeyA'] || this.keyState['ArrowLeft']) str -= 1;
    if (this.keyState['KeyD'] || this.keyState['ArrowRight']) str += 1;

    const brake = !!this.keyState['Space'];
    const dash = !!this.keyState['KeyX'];

    this.input.forward = fwd;
    this.input.reverse = rev;
    this.input.steer = str;
    this.input.brake = brake;
    if (dash) {
      this.input.dash = true;
    }
  }

  private setupVisibilityListener() {
    const onVisibilityChange = () => {
      if (document.hidden) {
        this.visibilityPaused = true;
        if (this.fuelDirty) this.saveAndNotify();
      } else {
        this.lastTime = performance.now();
        this.accumulator = 0;
        this.visibilityPaused = false;
      }
      this.refreshPauseState();
    };
    const onPageHide = () => {
      if (this.fuelDirty) this.saveAndNotify();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    this.removeVisibilityListener = () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.loop();
  }

  public stop() {
    if (this.fuelDirty) this.saveAndNotify();
    this.passengerAutoDock.cancel();
    this.isRunning = false;
    this.removeInputListeners?.();
    this.removeVisibilityListener?.();
    this.removeInputListeners = null;
    this.removeVisibilityListener = null;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private loop = () => {
    if (!this.isRunning) return;

    const now = performance.now();
    const frameDt = Math.min(0.25, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    let simulated = false;
    if (!this.isPaused) {
      this.accumulator = Math.min(
        this.accumulator + frameDt,
        this.fixedTimestep * this.maxPhysicsSubsteps,
      );
      let firstStep = true;
      while (this.accumulator >= this.fixedTimestep) {
        const stepInput = firstStep ? this.input : { ...this.input, dash: false };
        this.update(this.fixedTimestep, stepInput);
        this.accumulator -= this.fixedTimestep;
        firstStep = false;
        simulated = true;
      }
    } else {
      this.accumulator = 0;
    }
    this.render();

    if (simulated) this.input.dash = false;
    this.animFrameId = requestAnimationFrame(this.loop);
  };

  private update(dt: number, input: GameInputState) {
    if (this.refuelFeedbackTimer > 0) {
      this.refuelFeedbackTimer = Math.max(0, this.refuelFeedbackTimer - dt);
      if (this.refuelFeedbackTimer === 0) this.refuelFeedback = '';
    }
    if (this.recoveryTimer > 0) {
      this.recoveryTimer -= dt;
      this.damageMessageTimer = Math.max(0, this.damageMessageTimer - dt);
      this.car.vx = 0;
      this.car.vy = 0;
      this.car.speed = 0;
      if (this.recoveryTimer <= 0) this.finishRecovery();
      return;
    }
    const previousPosition = { x: this.car.x, y: this.car.y };
    this.car.setRuntimePerformanceMultiplier(fuelSpeedMultiplier(this.saveData.fuel));
    const autoDock = this.passengerAutoDock.update(dt, this.car, this.orders.getCurrentOrder());
    if (!autoDock.controlsSuppressed) this.car.update(dt, input, this.map, this.currentSkin);
    const nextFuel = consumeFuelForMovement(
      this.saveData.fuel,
      previousPosition,
      this.car,
      true,
    );
    if (nextFuel !== this.saveData.fuel) {
      this.saveData = { ...this.saveData, fuel: nextFuel };
      this.fuelDirty = true;
      this.fuelSaveElapsed += dt;
      if (this.fuelSaveElapsed >= GAMEPLAY_AUTOSAVE_INTERVAL_SECONDS) this.saveAndNotify();
    }
    if (this.car.hp <= 0) {
      this.recoveryTimer = 1.35;
      this.damageMessageTimer = 1.35;
      this.car.vx = 0;
      this.car.vy = 0;
      this.car.speed = 0;
      return;
    }
    this.map.update(dt, {
      x: this.car.x,
      y: this.car.y,
      speed: this.car.speed,
      angle: this.car.angle,
      length: this.car.length,
      width: this.car.width,
    });
    this.orders.update(dt, {
      x: this.car.x,
      y: this.car.y,
      vx: this.car.vx,
      vy: this.car.vy,
      angle: this.car.angle,
      length: this.car.length,
      width: this.car.width,
    });
    this.particles.update(dt);

    // Частицы при рывке
    if (this.car.isDashing) {
      this.particles.spawnDashTrail(this.car.x, this.car.y, this.currentSkin.glowColor);
    }

    // Затухание тряски экрана
    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      if (this.shakeTimer <= 0) {
        this.shakeIntensity = 0;
      }
    }

    // Затухание вспышки
    if (this.redFlashAlpha > 0) {
      this.redFlashAlpha = Math.max(0, this.redFlashAlpha - dt * 1.5);
    }

    const order = this.orders.getCurrentOrder();
    const parkingTarget = order ? {
      x: order.status === 'pickup' ? order.pickupX : order.destinationX,
      y: order.status === 'pickup' ? order.pickupY : order.destinationY,
    } : null;
    const nearParking = Boolean(parkingTarget && this.car.speed < 100 &&
      Math.hypot(parkingTarget.x - this.car.x, parkingTarget.y - this.car.y) < 240);
    const camera = getCameraProfile(this.car.speed, this.car.maxSpeed, nearParking);
    const targetCamX = this.car.x + Math.cos(this.car.angle) * camera.lookAhead;
    const targetCamY = this.car.y + Math.sin(this.car.angle) * camera.lookAhead;

    this.camX += (targetCamX - this.camX) * (1 - Math.exp(-dt * 6));
    this.camY += (targetCamY - this.camY) * (1 - Math.exp(-dt * 6));
    this.cameraZoom += (camera.zoom - this.cameraZoom) * (1 - Math.exp(-dt * 3.2));
  }

  private finishRecovery() {
    this.passengerAutoDock.cancel();
    this.orders.refuseOrder();
    this.car.recoverAt(3200 * CITY_GEOMETRY_SCALE, 2700 * CITY_GEOMETRY_SCALE, -Math.PI / 2);
    const penalty = Math.min(180, this.saveData.coins);
    this.saveData = { ...this.saveData, coins: this.saveData.coins - penalty };
    this.camX = this.car.x;
    this.camY = this.car.y;
    this.cameraZoom = 1;
    this.saveAndNotify();
  }

  public getFuelStationStatus(): FuelStationStatus | null {
    if (this.car.speed > REFUEL_MAX_SPEED) return null;
    const station = this.map.fuelStations.find(candidate =>
      stationContainsPoint(candidate, this.car.x, this.car.y));
    if (!station) return null;
    const cost = refuelPrice(this.saveData.fuel);
    return {
      stationId: station.id,
      stationName: station.name,
      cost,
      full: cost === 0,
    };
  }

  public getRefuelFeedback(): string {
    return this.refuelFeedbackTimer > 0 ? this.refuelFeedback : '';
  }

  public isPassengerAutoDockIndicatorVisible(): boolean {
    return this.passengerAutoDock.isIndicatorVisible();
  }

  public tryRefuel(): boolean {
    if (this.isPaused || !this.getFuelStationStatus()) return false;
    const result = createRefuelPurchase(this.saveData);
    if (result.status === 'insufficientFunds') {
      this.refuelFeedback = 'НЕДОСТАТОЧНО СРЕДСТВ';
      this.refuelFeedbackTimer = 2.2;
      return false;
    }
    if (result.status === 'full') {
      this.refuelFeedback = 'БАК УЖЕ ПОЛОН';
      this.refuelFeedbackTimer = 1.6;
      return false;
    }
    this.saveData = result.saveData;
    this.car.setRuntimePerformanceMultiplier(1);
    this.refuelFeedback = `ЗАПРАВКА ЗАВЕРШЕНА · −${result.cost} $`;
    this.refuelFeedbackTimer = 2.2;
    this.saveAndNotify();
    return true;
  }

  private render() {
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    const ctx = this.ctx;

    ctx.save();

    // 4.2 Применение тряски экрана
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeTimer > 0 && this.shakeIntensity > 0) {
      shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      shakeY = (Math.random() - 0.5) * this.shakeIntensity;
    }

    ctx.translate(width / 2 + shakeX, height / 2 + shakeY);
    ctx.scale(this.cameraZoom, this.cameraZoom);
    ctx.translate(-this.camX, -this.camY);

    // 1. Карта города (остров, замкнутые широкие дороги, парковки, неоновые вывески)
    this.map.render(ctx, this.camX, this.camY, width / this.cameraZoom, height / this.cameraZoom);

    // 2. Аккуратный GPS-пунктир и парковочные зоны [ P ] у обочин
    this.orders.render(ctx, this.car.x, this.car.y, this.car.angle);

    // 3. Автомобиль игрока
    this.car.render(ctx, this.currentSkin);
    if (DEBUG_PHYSICS) this.map.renderPhysicsDebug(ctx, this.car);

    // 4. Система частиц (дым, искры, следы)
    this.particles.render(ctx, this.camX, this.camY, width / this.cameraZoom, height / this.cameraZoom);

    ctx.restore();

    this.renderSpeedStreaks(ctx, width, height);

    // 5. Визуальная вспышка при сильном столкновении (Screen Flash)
    if (this.redFlashAlpha > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(239, 68, 68, ${this.redFlashAlpha})`;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    this.renderRadar(ctx, width, height);
    if (this.damageMessageTimer > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
      ctx.fillRect(width / 2 - 190, height / 2 - 32, 380, 64);
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 2;
      ctx.strokeRect(width / 2 - 190, height / 2 - 32, 380, 64);
      ctx.fillStyle = '#fecdd3';
      ctx.font = '900 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('АВТОМОБИЛЬ ПОВРЕЖДЁН', width / 2, height / 2);
      ctx.restore();
    }
  }

  private renderSpeedStreaks(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const intensity = Math.max(0, Math.min(1, (this.car.speed / Math.max(1, this.car.maxSpeed) - 0.68) / 0.32));
    if (intensity <= 0.01) return;
    const directionX = Math.cos(this.car.angle);
    const directionY = Math.sin(this.car.angle);
    const phase = this.lastTime * 0.001 * (0.6 + intensity * 1.4);
    ctx.save();
    ctx.strokeStyle = `rgba(125, 211, 252, ${0.04 + intensity * 0.08})`;
    ctx.lineWidth = 1 + intensity;
    ctx.lineCap = 'round';
    for (let index = 0; index < 18; index++) {
      const lane = (index + 0.5) / 18;
      const along = (lane * 1.73 + phase) % 1;
      const x = ((Math.sin(index * 91.7) + 1) * 0.5) * width;
      const y = ((along + Math.sin(index * 17.3) * 0.08 + 1) % 1) * height;
      const length = 16 + intensity * (24 + (index % 5) * 5);
      ctx.beginPath();
      ctx.moveTo(x + directionX * length * 0.2, y + directionY * length * 0.2);
      ctx.lineTo(x - directionX * length, y - directionY * length);
      ctx.stroke();
    }
    ctx.restore();
  }

  private ensureRadarCache() {
    if (this.radarCache || typeof document === 'undefined') return;
    const scale = 0.12;
    const cache = document.createElement('canvas');
    cache.width = Math.ceil(this.map.width * scale);
    cache.height = Math.ceil(this.map.height * scale);
    const ctx = cache.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#07101d';
    ctx.fillRect(0, 0, cache.width, cache.height);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#111827';
    for (const building of this.map.buildings) ctx.fillRect(building.x, building.y, building.width, building.height);
    ctx.lineCap = 'round';
    for (const segment of this.map.roadSegments) {
      ctx.strokeStyle = segment.kind === 'alley' ? '#334155' : '#53627a';
      ctx.lineWidth = segment.width;
      ctx.beginPath();
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
      ctx.stroke();
    }
    this.radarCache = cache;
  }

  private renderRadar(ctx: CanvasRenderingContext2D, width: number, _height: number) {
    this.ensureRadarCache();
    if (!this.radarCache) return;
    const radius = 86;
    const centerX = 106;
    const centerY = 132;
    const worldRadius = 850;
    const scale = radius / worldRadius;
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#07101d';
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    const cacheScale = this.radarCache.width / this.map.width;
    const sourceRadius = worldRadius * cacheScale;
    ctx.drawImage(
      this.radarCache,
      this.car.x * cacheScale - sourceRadius,
      this.car.y * cacheScale - sourceRadius,
      sourceRadius * 2,
      sourceRadius * 2,
      centerX - radius,
      centerY - radius,
      radius * 2,
      radius * 2,
    );
    const toRadar = (x: number, y: number) => ({ x: centerX + (x - this.car.x) * scale, y: centerY + (y - this.car.y) * scale });
    const order = this.orders.getCurrentOrder();
    if (order) {
      const tx = order.status === 'pickup' ? order.pickupX : order.destinationX;
      const ty = order.status === 'pickup' ? order.pickupY : order.destinationY;
      const route = this.map.getRemainingGpsRoute(this.car.x, this.car.y, tx, ty, this.car.angle);
      ctx.strokeStyle = order.status === 'pickup' ? '#facc15' : '#34d399';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      route.slice(0, 30).forEach((point, index) => {
        const p = toRadar(point.x, point.y);
        if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      const target = toRadar(tx, ty);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(target.x - 5, target.y - 6, 10, 12);
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('P', target.x, target.y + 3);
    }
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#422006';
    ctx.lineWidth = 1.5;
    for (const station of this.map.fuelStations) {
      if (Math.hypot(station.x - this.car.x, station.y - this.car.y) > worldRadius) continue;
      const p = toRadar(station.x, station.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 7px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('F', p.x, p.y + 2.5);
      ctx.fillStyle = '#facc15';
    }
    ctx.fillStyle = '#fb7185';
    for (const npc of this.map.trafficCars) {
      if (Math.hypot(npc.x - this.car.x, npc.y - this.car.y) > worldRadius) continue;
      const p = toRadar(npc.x, npc.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.translate(centerX, centerY);
    ctx.rotate(this.car.angle);
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-7, -6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-7, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#0891b2';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '800 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('N', centerX, centerY - radius + 13);
    ctx.restore();
    void width;
  }

  public resize(width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.resetTransform?.();
    this.ctx.scale(dpr, dpr);
  }
}
