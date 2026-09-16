import { useEffect, useRef } from 'react';
import { GameEngine } from '../game/GameEngine';
import { PlayerSaveData, Order } from '../types/game';
import { AudioEngine } from '../game/AudioEngine';

interface GameCanvasProps {
  saveData: PlayerSaveData;
  onEngineReady: (engine: GameEngine) => void;
  onDataChange: (data: PlayerSaveData) => void;
  onOrderCompletePrompt: (order: Order, reward: number) => void;
}

export function GameCanvas({
  saveData,
  onEngineReady,
  onDataChange,
  onOrderCompletePrompt,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Инициализация игрового движка
    const engine = new GameEngine(canvasRef.current, saveData);
    engineRef.current = engine;
    const qaWindow = window as Window & { __neonTaxiEngine?: GameEngine };
    if (import.meta.env.DEV) qaWindow.__neonTaxiEngine = engine;
    const qaStartedAt = performance.now();
    const qaPrevious = new Map(engine.map.trafficCars.map(car => [car.id, { x: car.x, y: car.y }]));
    const qaDistance = new Map(engine.map.trafficCars.map(car => [car.id, 0]));
    const qaUnblockedStop = new Map(engine.map.trafficCars.map(car => [car.id, 0]));
    const qaMaxUnblockedStop = new Map(engine.map.trafficCars.map(car => [car.id, 0]));
    const qaMaxJunctionWait = new Map(engine.map.trafficCars.map(car => [car.id, 0]));
    const qaTransitions = new Map(engine.map.trafficCars.map(car => [car.id, new Set<string>()]));
    const qaTransitionStartedAt = new Map<string, { id: string; time: number }>();
    const qaMaxTransitionDuration = new Map(engine.map.trafficCars.map(car => [car.id, 0]));
    const qaMaxSampleStep = new Map(engine.map.trafficCars.map(car => [car.id, 0]));
    let qaMaxJunctionConcurrency = 0;
    let qaMaxRoundaboutConcurrency = 0;
    let qaIllegalRoundaboutMoves = 0;
    const qaInterval = import.meta.env.DEV ? window.setInterval(() => {
      const now = performance.now();
      for (const car of engine.map.trafficCars) {
        const previous = qaPrevious.get(car.id) ?? { x: car.x, y: car.y };
        const sampleStep = Math.hypot(car.x - previous.x, car.y - previous.y);
        qaDistance.set(car.id, (qaDistance.get(car.id) ?? 0) + sampleStep);
        qaMaxSampleStep.set(car.id, Math.max(qaMaxSampleStep.get(car.id) ?? 0, sampleStep));
        qaPrevious.set(car.id, { x: car.x, y: car.y });
        const stoppedWithoutReason = car.speed < 1 && car.blockingReason === null;
        qaUnblockedStop.set(car.id, stoppedWithoutReason ? (qaUnblockedStop.get(car.id) ?? 0) + 0.25 : 0);
        qaMaxUnblockedStop.set(car.id, Math.max(qaMaxUnblockedStop.get(car.id) ?? 0, qaUnblockedStop.get(car.id) ?? 0));
        qaMaxJunctionWait.set(car.id, Math.max(qaMaxJunctionWait.get(car.id) ?? 0, car.waitingDuration));
        const active = qaTransitionStartedAt.get(car.id);
        if (car.activeTransitionId) {
          qaTransitions.get(car.id)?.add(car.activeTransitionId);
          if (!active || active.id !== car.activeTransitionId) {
            if (active) qaMaxTransitionDuration.set(car.id, Math.max(qaMaxTransitionDuration.get(car.id) ?? 0, (now - active.time) / 1000));
            qaTransitionStartedAt.set(car.id, { id: car.activeTransitionId, time: now });
          }
        } else if (active) {
          qaMaxTransitionDuration.set(car.id, Math.max(qaMaxTransitionDuration.get(car.id) ?? 0, (now - active.time) / 1000));
          qaTransitionStartedAt.delete(car.id);
        }
      }
      const activeTransitions = engine.map.trafficCars
        .map(car => engine.map.laneTransitions.find(transition => transition.id === car.activeTransitionId))
        .filter(transition => transition !== undefined);
      const byJunction = new Map<string, number>();
      const byRoundabout = new Map<string, number>();
      for (const transition of activeTransitions) {
        if (transition.junctionId) byJunction.set(transition.junctionId, (byJunction.get(transition.junctionId) ?? 0) + 1);
        if (transition.circularLaneId) {
          byRoundabout.set(transition.circularLaneId, (byRoundabout.get(transition.circularLaneId) ?? 0) + 1);
          const circularLane = engine.map.circularLanes.find(lane => lane.id === transition.circularLaneId);
          if (circularLane?.direction !== 'counterclockwise') qaIllegalRoundaboutMoves += 1;
        }
      }
      qaMaxJunctionConcurrency = Math.max(qaMaxJunctionConcurrency, ...byJunction.values(), 0);
      qaMaxRoundaboutConcurrency = Math.max(qaMaxRoundaboutConcurrency, ...byRoundabout.values(), 0);
      const order = engine.orders.getCurrentOrder();
      const target = order ? {
        x: order.status === 'pickup' ? order.pickupX : order.destinationX,
        y: order.status === 'pickup' ? order.pickupY : order.destinationY,
      } : null;
      const gps = target ? engine.map.getGpsRoute(engine.car.x, engine.car.y, target.x, target.y, engine.car.angle) : null;
      canvasRef.current!.dataset.qaSnapshot = JSON.stringify({
        elapsedSeconds: (performance.now() - qaStartedAt) / 1000,
        npcCount: engine.map.trafficCars.length,
        maxJunctionConcurrency: qaMaxJunctionConcurrency,
        maxRoundaboutConcurrency: qaMaxRoundaboutConcurrency,
        illegalRoundaboutMoves: qaIllegalRoundaboutMoves,
        gpsLaneCount: gps?.laneIds.length ?? 0,
        gpsHasLoop: gps ? new Set(gps.laneIds).size !== gps.laneIds.length : false,
        cars: engine.map.trafficCars.map(car => ({
          id: car.id,
          distance: qaDistance.get(car.id) ?? 0,
          maxUnblockedStop: qaMaxUnblockedStop.get(car.id) ?? 0,
          maxJunctionWait: qaMaxJunctionWait.get(car.id) ?? 0,
          transitionsSeen: qaTransitions.get(car.id)?.size ?? 0,
          maxTransitionDuration: Math.max(
            qaMaxTransitionDuration.get(car.id) ?? 0,
            qaTransitionStartedAt.has(car.id) ? (now - qaTransitionStartedAt.get(car.id)!.time) / 1000 : 0,
          ),
          maxSampleStep: qaMaxSampleStep.get(car.id) ?? 0,
          recoveryCount: car.recoveryCount,
          blockingReason: car.blockingReason,
        })),
      });
    }, 250) : null;
    onEngineReady(engine);

    engine.setOnDataChange(onDataChange);
    engine.setOnOrderCompletePrompt(onOrderCompletePrompt);

    // Обработка размеров окна
    const handleResize = () => {
      if (canvasRef.current && engineRef.current) {
        engineRef.current.resize(window.innerWidth, window.innerHeight);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    // Запуск цикла игры
    engine.start();

    // Разблокировка аудио по первому тапу / клику пользователя
    const handleFirstUserInteraction = () => {
      AudioEngine.getInstance().unlock();
      window.removeEventListener('pointerdown', handleFirstUserInteraction);
      window.removeEventListener('keydown', handleFirstUserInteraction);
    };

    window.addEventListener('pointerdown', handleFirstUserInteraction);
    window.addEventListener('keydown', handleFirstUserInteraction);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointerdown', handleFirstUserInteraction);
      window.removeEventListener('keydown', handleFirstUserInteraction);
      engine.stop();
      if (qaInterval !== null) window.clearInterval(qaInterval);
      if (qaWindow.__neonTaxiEngine === engine) delete qaWindow.__neonTaxiEngine;
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.syncSaveData(saveData);
  }, [saveData]);

  return (
    <canvas
      ref={canvasRef}
      id="game-canvas"
      className="absolute inset-0 w-full h-full block bg-[#070a14] cursor-crosshair touch-none"
    />
  );
}
