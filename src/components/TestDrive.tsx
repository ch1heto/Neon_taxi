import { useEffect, useMemo, useRef, useState } from 'react';
import type { CarSkin } from '../types/game';
import { getCameraProfile } from '../game/GameEngine';
import { TestDriveSession, type TestDriveUpgradeCategory, type TestDriveUpgradeLevels } from '../game/TestDriveTrack';
import { TestDriveMotion } from '../game/TestDriveInterpolation';
import { speedToKmh } from '../game/VehicleMetrics';

interface TestDriveProps {
  skin: CarSkin;
  onExit: () => void;
}

export function TestDrive({ skin, onExit }: TestDriveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onExitRef = useRef(onExit);
  const qaPrepared = useRef(false);
  const session = useMemo(() => new TestDriveSession(skin), [skin]);
  const configurationNoticeTimer = useRef<number | undefined>(undefined);
  const [levels, setLevels] = useState<Readonly<TestDriveUpgradeLevels>>(() => session.levels);
  const [configurationNotice, setConfigurationNotice] = useState('');
  const [telemetry, setTelemetry] = useState({ speed: 0, max: 0, zeroToHundred: null as number | null,
    lap: 0, best: null as number | null });
  onExitRef.current = onExit;

  const changeLevel = (category: TestDriveUpgradeCategory, delta: number) => {
    const key: keyof TestDriveUpgradeLevels = `${category}Level`;
    if (!session.setUpgradeLevel(category, session.levels[key] + delta)) return;
    setLevels(session.levels);
    setTelemetry({ speed: 0, max: 0, zeroToHundred: null, lap: 0, best: null });
    setConfigurationNotice('КОНФИГУРАЦИЯ ПРИМЕНЕНА · ТЕСТ СБРОШЕН');
    window.clearTimeout(configurationNoticeTimer.current);
    configurationNoticeTimer.current = window.setTimeout(() => setConfigurationNotice(''), 1800);
  };

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
        setTelemetry({ speed: speedToKmh(session.car.speed), max: Math.round(session.maxSpeedKmh),
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
      window.clearTimeout(configurationNoticeTimer.current);
      if (qaWindow.__neonTaxiTestDrive === session) delete qaWindow.__neonTaxiTestDrive;
    };
  }, [session, skin]);

  return (
    <div id="test-drive" className="absolute inset-0 z-40 bg-[#070a14] text-white font-sans">
      <canvas ref={canvasRef} id="test-drive-canvas" className="absolute inset-0 w-full h-full" />
      <div className="absolute top-5 left-5 w-[min(22rem,calc(100vw-2.5rem))] rounded-2xl bg-slate-950/90 border border-cyan-400/40 p-4 shadow-xl pointer-events-auto backdrop-blur-sm">
        <div className="text-cyan-300 text-xs font-bold tracking-widest">ТЕСТ-ДРАЙВ · {skin.name.toUpperCase()}</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-3 text-xs">
          <span>ТЕКУЩАЯ</span><strong id="test-speed" className="text-cyan-300">{telemetry.speed} км/ч</strong>
          <span>МАКСИМУМ</span><strong id="test-max-speed" className="text-amber-300">{telemetry.max} км/ч</strong>
          <span>0–100</span><strong id="test-0-100">{telemetry.zeroToHundred?.toFixed(2) ?? '—'} сек</strong>
          <span>КРУГ</span><strong id="test-lap">{telemetry.lap.toFixed(2)} сек</strong>
          <span>ЛУЧШИЙ</span><strong id="test-best-lap">{telemetry.best?.toFixed(2) ?? '—'} сек</strong>
        </div>
        <div id="test-current-config" className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-slate-700/80 text-[10px] font-bold tracking-wide">
          <span className="rounded-md bg-cyan-400/10 border border-cyan-400/25 px-2 py-1 text-cyan-200">SPEED LV.{levels.speedLevel}</span>
          <span className="rounded-md bg-emerald-400/10 border border-emerald-400/25 px-2 py-1 text-emerald-200">HANDLING LV.{levels.handlingLevel}</span>
          <span className="rounded-md bg-fuchsia-400/10 border border-fuchsia-400/25 px-2 py-1 text-fuchsia-200">DASH LV.{levels.dashLevel}</span>
        </div>
        <div className="mt-3">
          <div className="text-[10px] font-bold tracking-[0.18em] text-slate-400 mb-1.5">ТЕСТОВЫЕ НАСТРОЙКИ · БЕСПЛАТНО</div>
          {([
            ['speed', 'МАКС. СКОРОСТЬ', 'speedLevel'],
            ['handling', 'СЦЕПЛЕНИЕ', 'handlingLevel'],
            ['dash', 'РЫВОК DASH', 'dashLevel'],
          ] as const).map(([category, label, key]) => (
            <div key={category} className="flex items-center justify-between py-1">
              <span className="text-[11px] font-semibold text-slate-300">{label}</span>
              <div className="flex items-center gap-1.5">
                <button id={`test-${category}-minus`} aria-label={`Уменьшить ${label}`} disabled={levels[key] <= 1}
                  onClick={() => changeLevel(category, -1)}
                  className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-600 hover:border-cyan-400 disabled:opacity-35 disabled:hover:border-slate-600 font-bold">−</button>
                <strong id={`test-${category}-level`} className="w-5 text-center text-sm tabular-nums">{levels[key]}</strong>
                <button id={`test-${category}-plus`} aria-label={`Увеличить ${label}`} disabled={levels[key] >= 5}
                  onClick={() => changeLevel(category, 1)}
                  className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-600 hover:border-cyan-400 disabled:opacity-35 disabled:hover:border-slate-600 font-bold">+</button>
              </div>
            </div>
          ))}
          <div className="h-4 mt-1 text-[10px] font-bold text-amber-300" aria-live="polite">{configurationNotice}</div>
        </div>
      </div>
      <div className="absolute top-5 right-5 flex flex-col lg:flex-row items-stretch gap-2">
        <button id="test-reset" onClick={() => session.reset()} className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-600 hover:border-cyan-400 text-xs font-bold">СБРОСИТЬ МАШИНУ [R]</button>
        <button id="test-exit" onClick={onExit} className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold">ВЫЙТИ В ГАРАЖ [ESC]</button>
      </div>
      <div className="absolute bottom-5 left-5 text-xs text-slate-300 bg-slate-950/75 px-3 py-2 rounded-lg">WASD / стрелки — управление · Space — тормоз · X — рывок · R — сброс</div>
    </div>
  );
}
