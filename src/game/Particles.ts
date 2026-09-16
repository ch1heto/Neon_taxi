import { Particle } from '../types/game';

export class ParticleSystem {
  private particles: Particle[] = [];
  private readonly maxParticles = 300;

  // Пул объектов для максимальной производительности (60 FPS без лишних аллокаций)
  private pool: Particle[] = [];

  constructor() {
    for (let i = 0; i < this.maxParticles; i++) {
      this.pool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        size: 2,
        color: '#ffffff',
        glowColor: '#00f0ff',
        alpha: 1,
        type: 'spark',
      });
    }
  }

  private getParticle(): Particle | null {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return null;
  }

  private releaseParticle(p: Particle) {
    this.pool.push(p);
  }

  /**
   * Искры при ударе о здание или стену
   */
  public spawnSparks(x: number, y: number, count = 12, color = '#f59e0b') {
    for (let i = 0; i < count; i++) {
      const p = this.getParticle();
      if (!p) break;

      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 260;

      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.maxLife = 0.25 + Math.random() * 0.35;
      p.life = p.maxLife;
      p.size = 2 + Math.random() * 2.5;
      p.color = color;
      p.glowColor = color;
      p.alpha = 1;
      p.type = 'spark';

      this.particles.push(p);
    }
  }

  /**
   * Дым из-под колес при заносе или резком старте/торможении
   */
  public spawnDriftSmoke(x: number, y: number, count = 2, color = 'rgba(100, 116, 139, 0.45)') {
    for (let i = 0; i < count; i++) {
      const p = this.getParticle();
      if (!p) break;

      p.x = x + (Math.random() - 0.5) * 8;
      p.y = y + (Math.random() - 0.5) * 8;
      p.vx = (Math.random() - 0.5) * 25;
      p.vy = (Math.random() - 0.5) * 25;
      p.maxLife = 0.4 + Math.random() * 0.3;
      p.life = p.maxLife;
      p.size = 5 + Math.random() * 8;
      p.color = color;
      p.glowColor = '#38bdf8';
      p.alpha = 0.5;
      p.type = 'smoke';

      this.particles.push(p);
    }
  }

  /**
   * Световой след рывка Dash
   */
  public spawnDashTrail(x: number, y: number, color = '#06b6d4') {
    const p = this.getParticle();
    if (!p) return;

    p.x = x + (Math.random() - 0.5) * 6;
    p.y = y + (Math.random() - 0.5) * 6;
    p.vx = (Math.random() - 0.5) * 15;
    p.vy = (Math.random() - 0.5) * 15;
    p.maxLife = 0.35;
    p.life = p.maxLife;
    p.size = 12 + Math.random() * 6;
    p.color = color;
    p.glowColor = color;
    p.alpha = 0.7;
    p.type = 'trail';

    this.particles.push(p);
  }

  /**
   * Золотые искры при успешном завершении заказа
   */
  public spawnCoinSparks(x: number, y: number, count = 20) {
    for (let i = 0; i < count; i++) {
      const p = this.getParticle();
      if (!p) break;

      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 200;

      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.maxLife = 0.6 + Math.random() * 0.4;
      p.life = p.maxLife;
      p.size = 3 + Math.random() * 3;
      p.color = '#facc15';
      p.glowColor = '#f59e0b';
      p.alpha = 1;
      p.type = 'coin';

      this.particles.push(p);
    }
  }

  public update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        this.releaseParticle(p);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.type === 'smoke') {
        p.size += dt * 10;
        p.alpha = Math.max(0, (p.life / p.maxLife) * 0.4);
      } else {
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.alpha = Math.max(0, p.life / p.maxLife);
      }
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number
  ) {
    const left = camX - viewW / 2 - 50;
    const right = camX + viewW / 2 + 50;
    const top = camY - viewH / 2 - 50;
    const bottom = camY + viewH / 2 + 50;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.x < left || p.x > right || p.y < top || p.y > bottom) continue;

      ctx.save();
      ctx.globalAlpha = p.alpha;

      if (p.type === 'spark' || p.type === 'coin') {
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.glowColor;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'trail') {
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.glowColor;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  public clear() {
    for (const p of this.particles) {
      this.releaseParticle(p);
    }
    this.particles = [];
  }
}
