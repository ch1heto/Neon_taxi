import React, { useEffect, useRef } from 'react';
import { CarSkin } from '../types/game';
import { Car } from '../game/Car';

interface CarPreviewCanvasProps {
  skin: CarSkin;
}

export const CarPreviewCanvas: React.FC<CarPreviewCanvasProps> = ({ skin }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const angleRef = useRef<number>(-Math.PI / 4);
  const isDraggingRef = useRef<boolean>(false);
  const lastXRef = useRef<number>(0);
  const autoRotateSpeedRef = useRef<number>(0.8);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let lastTime = performance.now();
    let bobTime = 0;

    const render = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      bobTime += dt;

      // Авто-вращение, если пользователь не перетаскивает мышью
      if (!isDraggingRef.current) {
        angleRef.current += autoRotateSpeedRef.current * dt;
      }

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2 + 10;

      ctx.clearRect(0, 0, w, h);

      // 1. Неоновый подиум (Turntable)
      ctx.save();
      ctx.translate(cx, cy + 32);

      // Свечение подиума
      const glowGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, 140);
      glowGrad.addColorStop(0, skin.glowColor);
      glowGrad.addColorStop(0.7, 'rgba(15, 23, 42, 0.4)');
      glowGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, 130, 48, 0, 0, Math.PI * 2);
      ctx.fill();

      // Круглая светящаяся платформа
      ctx.strokeStyle = skin.glowColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 115, 42, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Внутреннее кольцо
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 85, 30, 0, 0, Math.PI * 2);
      ctx.stroke();

      // 8 светодиодных меток подиума
      for (let i = 0; i < 8; i++) {
        const markerAngle = (i / 8) * Math.PI * 2 + angleRef.current;
        const mx = Math.cos(markerAngle) * 115;
        const my = Math.sin(markerAngle) * 42;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(mx, my, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 2. Легкое покачивание и отрисовка машины
      ctx.save();
      const bobY = Math.sin(bobTime * 2.5) * 3;
      ctx.translate(cx, cy + bobY);

      // Отрисовка детализированной модели машины (масштаб x2.3)
      Car.drawCarDetailed(ctx, skin, 2.3, angleRef.current, true);

      ctx.restore();

      // 3. Подсказка о вращении
      ctx.save();
      ctx.fillStyle = '#64748b';
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Потяните, чтобы повернуть модель 360°', cx, h - 8);
      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [skin]);

  // Обработка ручного вращения (мышь и тач)
  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    lastXRef.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    angleRef.current += deltaX * 0.015;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  return (
    <div className="relative w-full flex flex-col items-center justify-center bg-slate-950/80 rounded-xl border border-slate-800 p-2 overflow-hidden shadow-inner">
      {/* Неоновый акцентный уголок */}
      <div
        className="absolute top-0 right-0 w-24 h-24 pointer-events-none opacity-20 blur-xl rounded-full"
        style={{ backgroundColor: skin.glowColor }}
      />
      <canvas
        ref={canvasRef}
        width={340}
        height={210}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="cursor-grab active:cursor-grabbing touch-none select-none"
      />
    </div>
  );
};
