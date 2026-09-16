import { useEffect, useMemo, useRef, useState } from 'react';
import type { CarSkin } from '../types/game';
import { getCameraProfile } from '../game/GameEngine';
import { TestDriveSession } from '../game/TestDriveTrack';
import { TestDriveMotion } from '../game/TestDriveInterpolation';

interface TestDriveProps {
  skin: CarSkin;
  onExit: () => void;
}

export function TestDrive({ skin, onExit }: TestDriveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onExitRef = useRef(onExit);
  const qaPrepared = useRef(false);
  const session = useMemo(() => new TestDriveSession(skin), [skin]);
  const [telemetry, setTelemetry] = useState({ speed: 0, max: 0, zeroToHundred: null as number | null,
    lap: 0, best: null as number | null });
  onExitRef.current = onExit;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx) return;
    const keys = new Set<string>();
    let running = true;
    let frameId = 0;
    let lastTime = performance.now();
    let accumulator = 0;
    let cameraX = session.car.x;
    let cameraY = session.car.y;
    let zoom = 1;
    let lastTelemetry = 0;
    const qaMode = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('qa') : null;
    if (!qaPrepared.current && (qaMode === 'track-straight' || qaMode === 'track-speed')) {
      qaPrepared.current = true;
      for (let tick = 0; tick < 240; tick++) session.update(1 / 60,
        { forward: 1, reverse: 0, steer: 0, brake: false, dash: false });
      if (qaMode === 'track-straight') {
        session.car.vx = 0;
        session.car.vy = 0;
        session.car.speed = 0;
      }
      cameraX = session.car.x;
      cameraY = session.car.y;
    }
    const fixedStep = 1 / 60;
    const motion = new TestDriveMotion(session.car);
    let resetGeneration = session.resetGeneration;

    const qaWindow = window as Window & { __neonTaxiTestDrive?: TestDriveSession };
    if (import.meta.env.DEV) qaWindow.__neonTaxiTestDrive = session;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { onExitRef.current(); return; }
      if (event.code === 'KeyR') { session.reset(); return; }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
      keys.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const onBlur = () => keys.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      accumulator = Math.min(accumulator + dt, 6 * fixedStep);
      if (resetGeneration !== session.resetGeneration) {
        motion.reset(session.car);
        resetGeneration = session.resetGeneration;
        accumulator = 0;
        cameraX = session.car.x;
        cameraY = session.car.y;
      }
      let first = true;
      while (accumulator >= fixedStep) {
        session.update(fixedStep, {
          forward: Number(qaMode === 'track-speed' || keys.has('KeyW') || keys.has('ArrowUp')),
          reverse: Number(keys.has('KeyS') || keys.has('ArrowDown')),
          steer: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
          brake: keys.has('Space'),
          dash: first && keys.has('KeyX'),
        });
        if (resetGeneration !== session.resetGeneration) {
          motion.reset(session.car);
          resetGeneration = session.resetGeneration;
          accumulator = 0;
          cameraX = session.car.x;
          cameraY = session.car.y;
          break;
        }
        motion.step(session.car);
        first = false;
        accumulator -= fixedStep;
      }
      const renderTransform = motion.sample(accumulator / fixedStep);
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const profile = getCameraProfile(session.car.speed, session.car.maxSpeed);
      const targetX = renderTransform.x + Math.cos(renderTransform.angle) * profile.lookAhead;
      const targetY = renderTransform.y + Math.sin(renderTransform.angle) * profile.lookAhead;
      cameraX += (targetX - cameraX) * (1 - Math.exp(-dt * 6));
      cameraY += (targetY - cameraY) * (1 - Math.exp(-dt * 6));
      zoom += (profile.zoom - zoom) * (1 - Math.exp(-dt * 3.2));
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-cameraX, -cameraY);
      session.track.render(ctx, cameraX, cameraY, width / zoom, height / zoom);
      session.car.render(ctx, skin, renderTransform);
      ctx.restore();
      if (now - lastTelemetry >= 100) {
        lastTelemetry = now;
        setTelemetry({ speed: Math.round(session.car.speed / 3), max: Math.round(session.maxSpeedKmh),
          zeroToHundred: session.zeroToHundred, lap: session.lapElapsed, best: session.bestLap });
      }
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(frameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (qaWindow.__neonTaxiTestDrive === session) delete qaWindow.__neonTaxiTestDrive;
    };
  }, [session, skin]);

  return (
    <div id="test-drive" className="absolute inset-0 z-40 bg-[#070a14] text-white font-sans">
      <canvas ref={canvasRef} id="test-drive-canvas" className="absolute inset-0 w-full h-full" />
      <div className="absolute top-5 left-5 rounded-2xl bg-slate-950/90 border border-cyan-400/40 p-4 shadow-xl pointer-events-none">
        <div className="text-cyan-300 text-xs font-bold tracking-widest">ТЕСТ-ДРАЙВ · {skin.name.toUpperCase()}</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-3 text-xs">
          <span>ТЕКУЩАЯ</span><strong id="test-speed" className="text-cyan-300">{telemetry.speed} км/ч</strong>
          <span>МАКСИМУМ</span><strong id="test-max-speed" className="text-amber-300">{telemetry.max} км/ч</strong>
          <span>0–100</span><strong id="test-0-100">{telemetry.zeroToHundred?.toFixed(2) ?? '—'} сек</strong>
          <span>КРУГ</span><strong id="test-lap">{telemetry.lap.toFixed(2)} сек</strong>
          <span>ЛУЧШИЙ</span><strong id="test-best-lap">{telemetry.best?.toFixed(2) ?? '—'} сек</strong>
        </div>
      </div>
      <div className="absolute top-5 right-5 flex gap-2">
        <button id="test-reset" onClick={() => session.reset()} className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-600 hover:border-cyan-400 text-xs font-bold">СБРОСИТЬ МАШИНУ [R]</button>
        <button id="test-exit" onClick={onExit} className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold">ВЫЙТИ В ГАРАЖ [ESC]</button>
      </div>
      <div className="absolute bottom-5 left-5 text-xs text-slate-300 bg-slate-950/75 px-3 py-2 rounded-lg">WASD / стрелки — управление · Space — тормоз · X — рывок · R — сброс</div>
    </div>
  );
}
