import { CarSkin, Particle, SkidMark } from '../types/game';
import { CityMap } from './CityMap';
import { AudioEngine } from './AudioEngine';
import { vehicleCollisionCircles, type Contact } from './geometry';

export interface CarStatsInput {
  speedLevel: number;
  handlingLevel: number;
  dashLevel: number;
}

export function clampUpgradeLevel(value: unknown, fallback = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(5, Math.round(value)));
}

export function calculateMaxSpeedForLevel(baseMaxSpeed: number, requestedLevel: number): number {
  return baseMaxSpeed * (1 + (clampUpgradeLevel(requestedLevel) - 1) * 0.06);
}

export type DrivingSurface = Pick<CityMap,
  'width' | 'height' | 'checkVehicleCollision' | 'checkIslandBoundary' | 'checkTrafficCollision'>;

export function calculateImpactDamage(impactSpeed: number, durability = 1): number {
  const impact = Math.max(0, impactSpeed);
  let damage = 0;
  if (impact < 12) damage = 0;
  else if (impact < 35) damage = 0.5 + ((impact - 12) / 23) * 1.5;
  else if (impact < 105) damage = 3 + ((impact - 35) / 70) * 5;
  else if (impact < 210) damage = 10 + ((impact - 105) / 105) * 8;
  else damage = Math.min(30, 20 + ((impact - 210) / 210) * 10);
  return Math.min(30, damage / Math.max(0.5, durability));
}

export class Car {
  public x: number;
  public y: number;
  public angle: number = 0; // в радианах
  public vx: number = 0;
  public vy: number = 0;
  public speed: number = 0;
  public angularVelocity: number = 0;

  public length = 56;
  public width = 30;
  public get collisionRadius() { return this.width * 0.42; }

  // Базовые параметры управления
  public maxSpeed = 380;
  public acceleration = 420;
  public braking = 600;
  public reverseSpeed = 160;
  public turnSpeed = 3.6;
  public lateralGrip = 0.88;
  public durability = 1;
  public hp = 100;

  // Навык Neon Dash
  public dashCooldownMax = 4.0;
  public dashCooldownTimer = 0;
  public isDashing = false;
  public dashDuration = 0.45;
  public dashTimer = 0;
  public dashSpeedBoost = 350;
  public runtimePerformanceMultiplier = 1;

  // Визуальные эффекты
  public particles: Particle[] = [];
  public skidMarks: SkidMark[] = [];
  private lastLeftTire: { x: number; y: number } | null = null;
  private lastRightTire: { x: number; y: number } | null = null;

  // Afterimages во время рывка
  private ghostTrails: { x: number; y: number; angle: number; alpha: number; color: string }[] = [];

  // Callback для тряски экрана при столкновении
  public onCrashCallback?: (intensity: number) => void;
  private crashCooldown = 0;
  private damageCooldown = 0;

  constructor(startX: number, startY: number) {
    this.x = startX;
    this.y = startY;
  }

  public applyUpgrades(stats: CarStatsInput, skin?: CarSkin) {
    if (skin) {
      this.length = skin.length;
      this.width = skin.width;
    }
    const model = skin ?? {
      maxSpeed: 340, acceleration: 380, braking: 620, steering: 3.2,
      grip: 0.86, durability: 1, dashPower: 340, dashCooldown: 4.2,
    };
    const speedLevel = clampUpgradeLevel(stats.speedLevel);
    const handlingLevel = clampUpgradeLevel(stats.handlingLevel);
    const dashLevel = clampUpgradeLevel(stats.dashLevel);
    const speedMultiplier = calculateMaxSpeedForLevel(1, speedLevel);
    const handlingMultiplier = 1 + (handlingLevel - 1) * 0.045;
    const dashMultiplier = 1 + (dashLevel - 1) * 0.055;
    this.maxSpeed = model.maxSpeed * speedMultiplier;
    this.acceleration = model.acceleration * (1 + (speedLevel - 1) * 0.05);
    this.braking = model.braking * handlingMultiplier;
    this.turnSpeed = model.steering * handlingMultiplier;
    this.lateralGrip = Math.min(0.985, 1 - (1 - model.grip) / handlingMultiplier);
    this.durability = model.durability;
    this.dashSpeedBoost = model.dashPower * dashMultiplier;
    this.dashCooldownMax = Math.max(1.6, model.dashCooldown * (1 - (dashLevel - 1) * 0.08));
  }

  public setRuntimePerformanceMultiplier(multiplier: number) {
    this.runtimePerformanceMultiplier = Number.isFinite(multiplier)
      ? Math.max(0.05, Math.min(1, multiplier))
      : 1;
  }

  public recoverAt(x: number, y: number, angle: number) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.hp = 100;
    this.damageCooldown = 0.8;
  }

  public resetForTestDrive(x: number, y: number, angle: number) {
    this.recoverAt(x, y, angle);
    this.angularVelocity = 0;
    this.isDashing = false;
    this.dashTimer = 0;
    this.dashCooldownTimer = 0;
    this.particles = [];
    this.skidMarks = [];
    this.ghostTrails = [];
    this.lastLeftTire = null;
    this.lastRightTire = null;
  }

  public applyCollisionDamage(impactSpeed: number): number {
    if (this.damageCooldown > 0) return 0;
    const damage = calculateImpactDamage(impactSpeed, this.durability);
    if (damage <= 0) return 0;
    this.hp = Math.max(0, this.hp - damage);
    this.damageCooldown = 0.65;
    return damage;
  }

  public triggerDash(): boolean {
    if (this.dashCooldownTimer > 0 || this.isDashing) {
      return false;
    }

    this.isDashing = true;
    this.dashTimer = this.dashDuration;
    this.dashCooldownTimer = this.dashCooldownMax;

    // Импульс в сторону текущего направления
    const dirX = Math.cos(this.angle);
    const dirY = Math.sin(this.angle);
    this.vx += dirX * this.dashSpeedBoost * this.runtimePerformanceMultiplier;
    this.vy += dirY * this.dashSpeedBoost * this.runtimePerformanceMultiplier;

    AudioEngine.getInstance().playDashSound();
    return true;
  }

  public update(
    dt: number,
    input: { forward: number; reverse: number; steer: number; brake: boolean; dash: boolean },
    map: DrivingSurface,
    skin: CarSkin
  ) {
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);
    this.damageCooldown = Math.max(0, this.damageCooldown - dt);
    // 1. Обработка рывка
    if (this.dashCooldownTimer > 0) {
      this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dt);
    }

    if (input.dash) {
      this.triggerDash();
    }

    if (this.isDashing) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
      }

      // Создание фантомного шлейфа
      this.ghostTrails.push({
        x: this.x,
        y: this.y,
        angle: this.angle,
        alpha: 0.8,
        color: skin.primaryColor,
      });
    }

    // 2. Векторные направления машины
    const forwardX = Math.cos(this.angle);
    const forwardY = Math.sin(this.angle);
    const rightX = -forwardY;
    const rightY = forwardX;

    // Проекция скорости на локальные оси машины
    const forwardVel = this.vx * forwardX + this.vy * forwardY;
    const lateralVel = this.vx * rightX + this.vy * rightY;

    // 3. Расчет ускорения и торможения
    let targetForwardAcc = 0;
    if (input.forward > 0) {
      targetForwardAcc += this.acceleration * input.forward;
    }
    if (input.reverse > 0) {
      if (forwardVel > 10) {
        targetForwardAcc -= this.braking * input.reverse; // тормоз
      } else {
        targetForwardAcc -= this.acceleration * 0.6 * input.reverse; // задний ход
      }
    }

    // 4. Поворот колес (зависит от скорости и направления движения)
    const speedRatio = Math.min(1.0, Math.abs(forwardVel) / 75);
    const steerDirection = forwardVel >= -5 ? 1 : -1;
    this.angle += input.steer * this.turnSpeed * speedRatio * steerDirection * dt;

    // 5. Симуляция сцепления шин с дорогой (Дрифт)
    const currentGrip = this.isDashing ? 0.98 : this.lateralGrip;
    let newLateralVel = lateralVel * Math.pow(1 - currentGrip, dt * 10);

    // 6. Обновление продольной скорости
    let newForwardVel = forwardVel + targetForwardAcc * dt;
    if (input.brake) {
      const brakeStep = this.braking * 1.35 * dt;
      newForwardVel = Math.abs(newForwardVel) <= brakeStep
        ? 0
        : newForwardVel - Math.sign(newForwardVel) * brakeStep;
      newLateralVel *= Math.pow(0.12, dt * 10);
    }
    const fuelLimitedMaxSpeed = this.maxSpeed * this.runtimePerformanceMultiplier;
    const currentMaxSpeed = this.isDashing ? fuelLimitedMaxSpeed * 1.5 : fuelLimitedMaxSpeed;

    if (newForwardVel > currentMaxSpeed) {
      newForwardVel = forwardVel > currentMaxSpeed
        ? Math.max(currentMaxSpeed, forwardVel - 200 * dt)
        : currentMaxSpeed;
    } else if (newForwardVel < -this.reverseSpeed) {
      newForwardVel = -this.reverseSpeed;
    }

    // Трение качения при отпущенных педалях
    if (input.forward === 0 && input.reverse === 0 && !input.brake) {
      newForwardVel *= Math.pow(0.85, dt * 5);
      if (Math.abs(newForwardVel) < 3) newForwardVel = 0;
    }

    // 7. Преобразование локальных скоростей обратно в мировые
    this.vx = forwardX * newForwardVel + rightX * newLateralVel;
    this.vy = forwardY * newForwardVel + rightY * newLateralVel;
    this.speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

    // 8. Звуковой отклик мотора
    AudioEngine.getInstance().updateEngineRPM(Math.min(1, this.speed / this.maxSpeed));

    // 9. Перемещение небольшими шагами предотвращает tunneling во время dash.
    const movementDistance = Math.hypot(this.vx, this.vy) * dt;
    const movementSteps = Math.max(1, Math.ceil(movementDistance / Math.max(6, this.collisionRadius * 0.65)));
    const moveDt = dt / movementSteps;
    let strongestImpact: { contact: Contact; color: string; glow: string; intensity: number } | null = null;
    for (let movementStep = 0; movementStep < movementSteps; movementStep++) {
      this.x += this.vx * moveDt;
      this.y += this.vy * moveDt;

      for (let iteration = 0; iteration < 3; iteration++) {
        const collision = map.checkVehicleCollision(this);
        if (!collision) break;
        const impact = this.resolveContact(collision);
        if (impact > 12) strongestImpact = { contact: collision, color: '#fbbf24', glow: '#f59e0b', intensity: impact };
      }

      for (let iteration = 0; iteration < 3; iteration++) {
        let islandHit: Contact | null = null;
        for (const circle of vehicleCollisionCircles(this)) {
          const candidate = map.checkIslandBoundary(circle.x, circle.y, circle.radius);
          if (candidate && (!islandHit || candidate.overlap > islandHit.overlap)) islandHit = candidate as Contact;
        }
        if (!islandHit) break;
        const impact = this.resolveContact(islandHit);
        if (impact > 12) strongestImpact = { contact: islandHit, color: '#00f0ff', glow: '#38bdf8', intensity: impact };
      }

      const trafficHit = map.checkTrafficCollision(this);
      if (trafficHit) {
        const impact = this.resolveContact(trafficHit);
        trafficHit.hitCar.speed = Math.max(0, trafficHit.hitCar.speed - Math.min(70, impact * 0.35));
        if (impact > 12) strongestImpact = { contact: trafficHit, color: '#ef4444', glow: '#f87171', intensity: impact };
      }

      this.x = Math.max(60, Math.min(map.width - 60, this.x));
      this.y = Math.max(60, Math.min(map.height - 60, this.y));
    }
    if (strongestImpact && this.crashCooldown <= 0) {
      this.emitCollision(strongestImpact.contact, strongestImpact.color, strongestImpact.glow);
      this.onCrashCallback?.(Math.min(1, Math.max(0.3, strongestImpact.intensity / this.maxSpeed)));
      this.crashCooldown = 0.18;
      this.applyCollisionDamage(strongestImpact.intensity);
    }

    // 10. Следы шин при заносе или резком торможении
    const isDrifting = Math.abs(lateralVel) > 65 && this.speed > 80;
    const isBrakingHard = input.reverse > 0 && forwardVel > 120;

    const leftTireOffset = { x: -this.length * 0.38, y: -this.width * 0.45 };
    const rightTireOffset = { x: -this.length * 0.38, y: this.width * 0.45 };

    const curLeftTire = {
      x: this.x + leftTireOffset.x * forwardX - leftTireOffset.y * forwardY,
      y: this.y + leftTireOffset.x * forwardY + leftTireOffset.y * forwardX,
    };
    const curRightTire = {
      x: this.x + rightTireOffset.x * forwardX - rightTireOffset.y * forwardY,
      y: this.y + rightTireOffset.x * forwardY + rightTireOffset.y * forwardX,
    };

    if (isDrifting || isBrakingHard) {
      if (this.lastLeftTire && this.lastRightTire) {
        const markAlpha = Math.min(0.65, Math.abs(lateralVel) / 220 + (isBrakingHard ? 0.3 : 0));
        this.skidMarks.push({
          x1: this.lastLeftTire.x,
          y1: this.lastLeftTire.y,
          x2: curLeftTire.x,
          y2: curLeftTire.y,
          alpha: markAlpha,
          color: '#020617',
        });
        this.skidMarks.push({
          x1: this.lastRightTire.x,
          y1: this.lastRightTire.y,
          x2: curRightTire.x,
          y2: curRightTire.y,
          alpha: markAlpha,
          color: '#020617',
        });
        if (this.skidMarks.length > 200) {
          this.skidMarks.splice(0, 2);
        }
      }
    }

    this.lastLeftTire = curLeftTire;
    this.lastRightTire = curRightTire;

    // 11. Частицы нитро/выхлопа
    if (this.speed > 50 || this.isDashing) {
      const rearX = this.x - forwardX * (this.length * 0.5);
      const rearY = this.y - forwardY * (this.length * 0.5);

      this.particles.push({
        x: rearX + (Math.random() - 0.5) * 4,
        y: rearY + (Math.random() - 0.5) * 4,
        vx: -forwardX * 30 + (Math.random() - 0.5) * 15,
        vy: -forwardY * 30 + (Math.random() - 0.5) * 15,
        life: 0.2 + Math.random() * 0.15,
        maxLife: 0.35,
        size: this.isDashing ? 4.5 : 2.5,
        color: this.isDashing ? '#00f0ff' : skin.trailColor,
        glowColor: skin.glowColor,
        alpha: 0.6,
      });
    }

    // Обновление частиц
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Обновление призрачных следов
    for (let i = this.ghostTrails.length - 1; i >= 0; i--) {
      this.ghostTrails[i].alpha -= dt * 3.0;
      if (this.ghostTrails[i].alpha <= 0) {
        this.ghostTrails.splice(i, 1);
      }
    }
  }

  private resolveContact(contact: Contact): number {
    this.x += contact.normalX * (contact.overlap + 0.15);
    this.y += contact.normalY * (contact.overlap + 0.15);
    const inwardSpeed = this.vx * contact.normalX + this.vy * contact.normalY;
    if (inwardSpeed < 0) {
      // Убираем только скорость в препятствие: касательная сохраняется и машина скользит вдоль стены.
      this.vx -= inwardSpeed * contact.normalX;
      this.vy -= inwardSpeed * contact.normalY;
    }
    this.speed = Math.hypot(this.vx, this.vy);
    return Math.max(0, -inwardSpeed);
  }

  private emitCollision(contact: Contact, color: string, glowColor: string) {
    AudioEngine.getInstance().playCrashSound();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate([35, 25, 35]); } catch (_) {}
    }
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: this.x - contact.normalX * this.collisionRadius,
        y: this.y - contact.normalY * this.collisionRadius,
        vx: (contact.normalX + (Math.random() - 0.5)) * (120 + Math.random() * 130),
        vy: (contact.normalY + (Math.random() - 0.5)) * (120 + Math.random() * 130),
        life: 0.16 + Math.random() * 0.2,
        maxLife: 0.36,
        size: 2.7,
        color,
        glowColor,
        alpha: 1,
      });
    }
  }

  /**
   * Высокодетализированный рендеринг автомобиля с уникальной геометрией для каждой модели
   */
  public render(ctx: CanvasRenderingContext2D, skin: CarSkin,
    transform: { x: number; y: number; angle: number } = this) {
    const L = skin.length || this.length;
    const W = skin.width || this.width;

    // 1. Следы шин на асфальте
    for (const sm of this.skidMarks) {
      ctx.strokeStyle = sm.color;
      ctx.globalAlpha = sm.alpha * 0.55;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(sm.x1, sm.y1);
      ctx.lineTo(sm.x2, sm.y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    // 2. Призрачные силуэты во время рывка (Afterimages)
    for (const ghost of this.ghostTrails) {
      ctx.save();
      ctx.translate(ghost.x, ghost.y);
      ctx.rotate(ghost.angle);
      ctx.globalAlpha = ghost.alpha * 0.35;
      const registeredVisual = Car.visualRenderers.get(skin.modelType);
      if (registeredVisual?.renderDashAfterimage) {
        registeredVisual.draw(ctx, L, W, skin);
      } else {
        ctx.strokeStyle = ghost.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(-L / 2, -W / 2, L, W);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1.0;

    // 3. Частицы выхлопа
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 4. Компактное свечение фар, не перекрывающее соседние полосы
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.rotate(transform.angle);
    ctx.globalCompositeOperation = 'screen';
    for (const offsetY of [-W * 0.32, W * 0.32]) {
      const glowX = L * 0.55;
      const headlightGrad = ctx.createRadialGradient(glowX, offsetY, 1, glowX, offsetY, 22);
      headlightGrad.addColorStop(0, 'rgba(255, 255, 230, 0.26)');
      headlightGrad.addColorStop(0.4, 'rgba(255, 255, 255, 0.09)');
      headlightGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = headlightGrad;
      ctx.beginPath();
      ctx.arc(glowX, offsetY, 22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 5. Рендеринг конкретной модели автомобиля
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.rotate(transform.angle);

    Car.drawCarDetailed(ctx, skin, 1, 0, false);

    ctx.restore();
  }

  private static readonly visualRenderers = new Map<CarSkin['modelType'], {
    draw: (ctx: CanvasRenderingContext2D, length: number, width: number, skin: CarSkin) => void;
    renderDashAfterimage: boolean;
  }>();

  /** Registers a model-specific body renderer without changing the legacy fallback path. */
  public static registerVisualRenderer(
    modelType: CarSkin['modelType'],
    renderer: (ctx: CanvasRenderingContext2D, length: number, width: number, skin: CarSkin) => void,
    options: { renderDashAfterimage?: boolean } = {},
  ) {
    Car.visualRenderers.set(modelType, {
      draw: renderer,
      renderDashAfterimage: options.renderDashAfterimage === true,
    });
  }

  /** Статический метод для отрисовки любой модели (используется и в игре, и на подиуме в Гараже) */
  public static drawCarDetailed(
    ctx: CanvasRenderingContext2D,
    skin: CarSkin,
    scale = 1,
    angle = 0,
    withShadow = true
  ) {
    const L = (skin.length || 56) * scale;
    const W = (skin.width || 30) * scale;

    ctx.save();
    if (angle !== 0) {
      ctx.rotate(angle);
    }

    // Неоновое свечение под днищем
    ctx.shadowColor = skin.glowColor;
    ctx.shadowBlur = 16 * scale;
    ctx.fillStyle = skin.glowColor;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.42, W * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;

    // Мягкая тень под кузовом
    if (withShadow) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.beginPath();
      ctx.roundRect(-L / 2 - 2, -W / 2 - 2, L + 4, W + 4, 6 * scale);
      ctx.fill();
    }

    Car.drawCarBody(ctx, L, W, skin);

    ctx.restore();
  }

  private static drawCarBody(ctx: CanvasRenderingContext2D, L: number, W: number, skin: CarSkin) {
    const customRenderer = Car.visualRenderers.get(skin.modelType);
    if (customRenderer) {
      customRenderer.draw(ctx, L, W, skin);
    } else {
      Car.renderWheels(ctx, L, W, skin.modelType);
      switch (skin.modelType) {
        case 'sport':
          Car.renderSportCoupe(ctx, L, W, skin);
          break;
        case 'suv':
          Car.renderTitanSUV(ctx, L, W, skin);
          break;
        case 'hyper':
          Car.renderHypercar(ctx, L, W, skin);
          break;
        case 'aerocar':
          Car.renderAerocar(ctx, L, W, skin);
          break;
        case 'sedan':
        default:
          Car.renderCityCruiser(ctx, L, W, skin);
          break;
      }
    }
  }

  /** Отрисовка 4 колес */
  public static renderWheels(ctx: CanvasRenderingContext2D, L: number, W: number, modelType: string) {
    ctx.fillStyle = '#0f172a';
    const wheelL = modelType === 'suv' ? 14 : 11;
    const wheelW = modelType === 'suv' ? 6 : 4.5;
    const frontX = L * 0.3;
    const rearX = -L * 0.3;
    const lateralY = W * 0.5 - wheelW / 2;

    // 4 колеса
    ctx.fillRect(frontX - wheelL / 2, -lateralY - wheelW, wheelL, wheelW);
    ctx.fillRect(frontX - wheelL / 2, lateralY, wheelL, wheelW);
    ctx.fillRect(rearX - wheelL / 2, -lateralY - wheelW, wheelL, wheelW);
    ctx.fillRect(rearX - wheelL / 2, lateralY, wheelL, wheelW);
  }

  /** МОДЕЛЬ 1: City Cruiser (Классический городской седан такси) */
  public static renderCityCruiser(ctx: CanvasRenderingContext2D, L: number, W: number, skin: CarSkin) {
    // Основной кузов (седан)
    ctx.fillStyle = skin.primaryColor;
    ctx.beginPath();
    ctx.roundRect(-L * 0.5, -W * 0.45, L, W * 0.9, 5);
    ctx.fill();

    // Тонкий контур
    ctx.strokeStyle = skin.secondaryColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Капот
    ctx.fillStyle = skin.secondaryColor;
    ctx.fillRect(L * 0.15, -W * 0.35, L * 0.32, W * 0.7);

    // Лобовое стекло
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(L * 0.05, -W * 0.38, L * 0.14, W * 0.76, 2);
    ctx.fill();

    // Крыша
    ctx.fillStyle = skin.primaryColor;
    ctx.fillRect(-L * 0.22, -W * 0.38, L * 0.27, W * 0.76);

    // Заднее стекло
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-L * 0.36, -W * 0.36, L * 0.12, W * 0.72);

    // Зеркала заднего вида
    ctx.fillStyle = skin.primaryColor;
    ctx.fillRect(L * 0.12, -W * 0.55, 3.5, 3.5);
    ctx.fillRect(L * 0.12, W * 0.45, 3.5, 3.5);

    // Шашечка TAXI на крыше
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#020617';
    ctx.lineWidth = 1;
    ctx.fillRect(-L * 0.12, -W * 0.28, L * 0.16, W * 0.56);
    ctx.strokeRect(-L * 0.12, -W * 0.28, L * 0.16, W * 0.56);

    ctx.fillStyle = '#020617';
    ctx.font = 'bold 7px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TAXI', -L * 0.04, 0);

    // Передние фары (квадратные классические)
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(L * 0.48, -W * 0.4, 2.5, 6);
    ctx.fillRect(L * 0.48, W * 0.4 - 6, 2.5, 6);

    // Задние стоп-сигналы
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-L * 0.5, -W * 0.4, 2, 7);
    ctx.fillRect(-L * 0.5, W * 0.4 - 7, 2, 7);
  }

  /** МОДЕЛЬ 2: Cyber GT Coupe (Спортивное купе с большим антикрылом) */
  public static renderSportCoupe(ctx: CanvasRenderingContext2D, L: number, W: number, skin: CarSkin) {
    // Клиновидный кузов спорткара
    ctx.fillStyle = skin.primaryColor;
    ctx.beginPath();
    ctx.moveTo(L * 0.5, 0);
    ctx.lineTo(L * 0.42, -W * 0.46);
    ctx.lineTo(-L * 0.44, -W * 0.46);
    ctx.lineTo(-L * 0.48, -W * 0.38);
    ctx.lineTo(-L * 0.48, W * 0.38);
    ctx.lineTo(-L * 0.44, W * 0.46);
    ctx.lineTo(L * 0.42, W * 0.46);
    ctx.closePath();
    ctx.fill();

    // Карбоновые вставки на капоте (воздухозаборники)
    ctx.fillStyle = skin.secondaryColor;
    ctx.fillRect(L * 0.14, -W * 0.25, L * 0.22, 3);
    ctx.fillRect(L * 0.14, W * 0.25 - 3, L * 0.22, 3);

    // Тонированный каплевидный кокпит
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.moveTo(L * 0.2, 0);
    ctx.lineTo(L * 0.06, -W * 0.36);
    ctx.lineTo(-L * 0.3, -W * 0.34);
    ctx.lineTo(-L * 0.34, 0);
    ctx.lineTo(-L * 0.34, W * 0.34);
    ctx.lineTo(L * 0.06, W * 0.36);
    ctx.closePath();
    ctx.fill();

    // Спортивная крыша с центральной полосой
    ctx.fillStyle = skin.primaryColor;
    ctx.fillRect(-L * 0.16, -W * 0.28, L * 0.2, W * 0.56);

    // Большое антикрыло (GT Wing) с стойками на корме
    ctx.fillStyle = '#09090b';
    // стойки
    ctx.fillRect(-L * 0.44, -W * 0.28, 4, 3);
    ctx.fillRect(-L * 0.44, W * 0.28 - 3, 4, 3);
    // само крыло
    ctx.fillStyle = '#18181b';
    ctx.fillRect(-L * 0.48, -W * 0.5, 5, W);
    // боковые закрылки спойлера
    ctx.fillStyle = skin.primaryColor;
    ctx.fillRect(-L * 0.5, -W * 0.52, 7, 3);
    ctx.fillRect(-L * 0.5, W * 0.52 - 3, 7, 3);

    // Тонкие хищные LED фары
    ctx.fillStyle = '#67e8f9';
    ctx.fillRect(L * 0.44, -W * 0.42, 4, 4);
    ctx.fillRect(L * 0.44, W * 0.42 - 4, 4, 4);

    // Сдвоенные выхлопные трубы
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(-L * 0.5, -W * 0.2, 2.5, 3);
    ctx.fillRect(-L * 0.5, W * 0.2 - 3, 2.5, 3);
  }

  /** МОДЕЛЬ 3: Titan 4x4 Enforcer (Массивный бронированный внедорожник) */
  public static renderTitanSUV(ctx: CanvasRenderingContext2D, L: number, W: number, skin: CarSkin) {
    // Широкий угловатый кузов внедорожника
    ctx.fillStyle = skin.primaryColor;
    ctx.beginPath();
    ctx.roundRect(-L * 0.5, -W * 0.48, L, W * 0.96, 4);
    ctx.fill();

    // Силовой передний кенгурятник / бампер
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(L * 0.44, -W * 0.42, 6, W * 0.84);
    ctx.fillStyle = '#64748b';
    ctx.fillRect(L * 0.48, -W * 0.3, 3, 4);
    ctx.fillRect(L * 0.48, W * 0.3 - 4, 3, 4);

    // Лобовое бронестекло с защитными стойками
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(L * 0.1, -W * 0.4, L * 0.14, W * 0.8);

    // Крыша с багажником
    ctx.fillStyle = skin.secondaryColor;
    ctx.fillRect(-L * 0.28, -W * 0.4, L * 0.38, W * 0.8);

    // Светодиодная люстра (LED Light Bar) на крыше
    ctx.fillStyle = '#020617';
    ctx.fillRect(L * 0.08, -W * 0.38, 4, W * 0.76);
    // 5 ярких диодов люстры
    ctx.fillStyle = '#fef08a';
    const numLeds = 5;
    const ledStep = (W * 0.68) / (numLeds - 1);
    for (let i = 0; i < numLeds; i++) {
      ctx.fillRect(L * 0.09, -W * 0.34 + i * ledStep, 2.5, 2.5);
    }

    // Запасное колесо на багажнике сзади
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-L * 0.42, 0, W * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Задние вертикальные фонари
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-L * 0.5, -W * 0.44, 2.5, 8);
    ctx.fillRect(-L * 0.5, W * 0.44 - 8, 2.5, 8);
  }

  /** МОДЕЛЬ 4: Veloce Hypercar (Гоночный гиперкар с двойными килями) */
  public static renderHypercar(ctx: CanvasRenderingContext2D, L: number, W: number, skin: CarSkin) {
    // Аэродинамический корпус болида
    ctx.fillStyle = skin.primaryColor;
    ctx.beginPath();
    ctx.moveTo(L * 0.5, 0);
    ctx.lineTo(L * 0.4, -W * 0.48);
    ctx.lineTo(L * 0.15, -W * 0.4);
    ctx.lineTo(-L * 0.25, -W * 0.48);
    ctx.lineTo(-L * 0.5, -W * 0.44);
    ctx.lineTo(-L * 0.42, 0);
    ctx.lineTo(-L * 0.5, W * 0.44);
    ctx.lineTo(-L * 0.25, W * 0.48);
    ctx.lineTo(L * 0.15, W * 0.4);
    ctx.lineTo(L * 0.4, W * 0.48);
    ctx.closePath();
    ctx.fill();

    // Центральный воздухозаборник на крыше
    ctx.fillStyle = skin.secondaryColor;
    ctx.beginPath();
    ctx.roundRect(-L * 0.05, -W * 0.14, L * 0.25, W * 0.28, 2);
    ctx.fill();

    // Каплевидная капсула кокпита
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.ellipse(L * 0.05, 0, L * 0.2, W * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // Двойные вертикальные аэродинамические стабилизаторы (кили)
    ctx.fillStyle = skin.secondaryColor;
    ctx.fillRect(-L * 0.45, -W * 0.4, L * 0.25, 3.5);
    ctx.fillRect(-L * 0.45, W * 0.4 - 3.5, L * 0.25, 3.5);

    // Сплошная неоновая задняя полоса светодиодов
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(-L * 0.48, -W * 0.36, 2, W * 0.72);
  }

  /** МОДЕЛЬ 5: Phantom Aerocar (Футуристический флагман с турбинами) */
  public static renderAerocar(ctx: CanvasRenderingContext2D, L: number, W: number, skin: CarSkin) {
    // Стреловидный киберпанк фюзеляж
    ctx.fillStyle = skin.primaryColor;
    ctx.beginPath();
    ctx.moveTo(L * 0.52, 0);
    ctx.lineTo(L * 0.25, -W * 0.36);
    ctx.lineTo(-L * 0.3, -W * 0.36);
    ctx.lineTo(-L * 0.48, -W * 0.24);
    ctx.lineTo(-L * 0.48, W * 0.24);
    ctx.lineTo(-L * 0.3, W * 0.36);
    ctx.lineTo(L * 0.25, W * 0.36);
    ctx.closePath();
    ctx.fill();

    // Боковые реактивные гондолы / турбины
    ctx.fillStyle = skin.secondaryColor;
    // левая турбина
    ctx.beginPath();
    ctx.roundRect(-L * 0.35, -W * 0.54, L * 0.38, W * 0.2, 4);
    ctx.fill();
    // сопло левой турбины
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(-L * 0.38, -W * 0.52, 3, W * 0.16);

    // правая турбина
    ctx.fillStyle = skin.secondaryColor;
    ctx.beginPath();
    ctx.roundRect(-L * 0.35, W * 0.34, L * 0.38, W * 0.2, 4);
    ctx.fill();
    // сопло правой турбины
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(-L * 0.38, W * 0.36, 3, W * 0.16);

    // Панорамный стеклянный колпак
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.26, W * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();

    // Голографический индикатор на носу
    ctx.fillStyle = '#c084fc';
    ctx.fillRect(L * 0.48, -2, 4, 4);
  }
}
