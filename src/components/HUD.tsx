import { useState, useEffect, type ReactNode } from 'react';
import {
  Coins,
  ShoppingBag,
  Volume2,
  VolumeX,
  Music,
  Zap,
  Navigation,
  MapPin,
} from 'lucide-react';
import { PlayerSaveData, Order } from '../types/game';
import { GameEngine, type FuelStationStatus } from '../game/GameEngine';
import { speedToKmh } from '../game/VehicleMetrics';
import { EXPRESS_MAX_MULTIPLIER, getExpressEfficiency, getOrderReward, polylineDistance } from '../game/OrderEconomy';
import { NeonFMPlayer } from './NeonFMPlayer';

interface HUDProps {
  engine: GameEngine | null;
  saveData: PlayerSaveData;
  onOpenShop: () => void;
  developerControls?: ReactNode;
  onToggleSound: () => void;
  onToggleMusic: () => void;
  onSetAudioVolume: (key: 'masterVolume' | 'engineVolume' | 'musicVolume', value: number) => void;
}

interface FloatingCoinText {
  id: number;
  text: string;
}

export function HUD({
  engine,
  saveData,
  onOpenShop,
  developerControls,
  onToggleSound,
  onToggleMusic,
  onSetAudioVolume,
}: HUDProps) {
  const [speed, setSpeed] = useState(0);
  const [dashProgress, setDashProgress] = useState(1);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [shiftActive, setShiftActive] = useState(false);
  const [targetAngle, setTargetAngle] = useState(0);
  const [targetDistance, setTargetDistance] = useState(0);
  const [carDistrict, setCarDistrict] = useState('DOWNTOWN');
  const [hp, setHp] = useState(100);
  const [fuel, setFuel] = useState(saveData.fuel);
  const [fuelStationStatus, setFuelStationStatus] = useState<FuelStationStatus | null>(null);
  const [refuelFeedback, setRefuelFeedback] = useState('');
  const [autoDockVisible, setAutoDockVisible] = useState(false);

  // 4.1 Анимация вылетающих монет
  const [floatingCoins, setFloatingCoins] = useState<FloatingCoinText[]>([]);
  const [prevCoins, setPrevCoins] = useState(saveData.coins);

  // Анимация прибавки монет (+100 $)
  useEffect(() => {
    if (saveData.coins > prevCoins) {
      const diff = saveData.coins - prevCoins;
      const newId = Date.now() + Math.random();
      setFloatingCoins(prev => [...prev, { id: newId, text: `+${diff} $` }]);

      setTimeout(() => {
        setFloatingCoins(prev => prev.filter(c => c.id !== newId));
      }, 1600);
    }
    setPrevCoins(saveData.coins);
  }, [saveData.coins, prevCoins]);

  useEffect(() => {
    if (!engine) return;

    const interval = setInterval(() => {
      const spdKmh = speedToKmh(engine.car.speed);
      setSpeed(spdKmh);
      setHp(Math.round(engine.car.hp));
      setFuel(engine.saveData.fuel);
      setFuelStationStatus(engine.getFuelStationStatus());
      setRefuelFeedback(engine.getRefuelFeedback());
      setAutoDockVisible(engine.isPassengerAutoDockIndicatorVisible());

      // Перезарядка рывка
      const maxCd = engine.car.dashCooldownMax;
      const curCd = engine.car.dashCooldownTimer;
      setDashProgress(curCd <= 0 ? 1 : 1 - curCd / maxCd);

      // Текущий район машины
      const closestNode = engine.map.findClosestRoadNode(engine.car.x, engine.car.y);
      setCarDistrict(closestNode.district.toUpperCase());

      // GPS расчет
      const ord = engine.orders.getCurrentOrder();
      setCurrentOrder(ord);
      setShiftActive(engine.orders.isShiftActive());

      if (ord) {
        const targetX = ord.status === 'pickup' ? ord.pickupX : ord.destinationX;
        const targetY = ord.status === 'pickup' ? ord.pickupY : ord.destinationY;
        const route = engine.map.getRemainingGpsRoute(engine.car.x, engine.car.y, targetX, targetY, engine.car.angle);
        const dist = Math.round(polylineDistance(route) / 3.2);
        setTargetDistance(dist);

        const waypoint = engine.map.getNextGpsWaypoint(
          engine.car.x,
          engine.car.y,
          targetX,
          targetY,
          engine.car.angle,
        );
        const angleRad = Math.atan2(waypoint.y - engine.car.y, waypoint.x - engine.car.x);
        setTargetAngle(angleRad * (180 / Math.PI) + 90);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [engine]);

  const handleDashClick = () => {
    if (engine) {
      engine.car.triggerDash();
    }
  };

  const nearbyHint = currentOrder && targetDistance <= 120
    ? currentOrder.status === 'pickup'
      ? 'Заедьте в [P], выровняйтесь и остановитесь'
      : 'Остановитесь в [P] для высадки'
    : '';
  const roundedFuel = Math.round(fuel);
  const fuelWarning = fuel <= 5
    ? 'ТОПЛИВО НА ИСХОДЕ'
    : fuel <= 20
      ? 'НИЗКИЙ УРОВЕНЬ ТОПЛИВА'
      : '';

  return (
    <div
      id="game-hud"
      className="absolute inset-0 pointer-events-none flex flex-col justify-between p-3 sm:p-5 select-none font-sans text-slate-100"
    >
      {/* 1. Верхняя панель: баланс, текущий район, GPS и кнопки меню */}
      <div className="flex items-start justify-between w-full pointer-events-auto gap-2">
        {/* Баланс монет и всплывающие анимации */}
        <div className="relative flex items-center gap-2">
          <div
            id="hud-coins"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/85 border border-slate-700/70 shadow-lg backdrop-blur-md"
          >
            <Coins className="w-4 h-4 text-amber-400" />
            <span className="text-base sm:text-lg font-bold tracking-tight text-amber-300">
              {saveData.coins.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400 font-semibold">$</span>
          </div>

          {/* 4.1 Анимация вылетающих монет */}
          <div className="absolute top-10 left-3 pointer-events-none flex flex-col gap-1">
            {floatingCoins.map(coin => (
              <div
                key={coin.id}
                className="text-sm font-extrabold text-amber-300 drop-shadow-md animate-bounce tracking-wide"
              >
                {coin.text}
              </div>
            ))}
          </div>

          <div
            id="hud-district"
            className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/85 border border-slate-700/70 shadow-lg backdrop-blur-md"
          >
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              {carDistrict}
            </span>
          </div>
        </div>

        {/* GPS навигатор к пассажиру или точке доставки */}
        {!shiftActive && (
          <button id="btn-start-shift" onClick={() => engine?.startShift()} className="px-5 py-3 rounded-xl bg-cyan-500 text-slate-950 font-bold text-sm shadow-lg shadow-cyan-500/30">
            НАЧАТЬ СМЕНУ
          </button>
        )}
        {currentOrder && (
          <div
            id="hud-gps"
            className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2 rounded-xl bg-slate-900/90 border border-slate-700/70 shadow-xl backdrop-blur-md"
          >
            <div
              className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center text-cyan-400 transition-transform duration-100 ease-out shrink-0"
              style={{ transform: `rotate(${targetAngle}deg)` }}
            >
              <Navigation className="w-5 h-5 fill-cyan-400 stroke-slate-950 stroke-[1.5]" />
            </div>

            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    currentOrder.status === 'pickup'
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                      : 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30'
                  }`}
                >
                  {currentOrder.status === 'pickup' ? 'ПОСАДКА [P]' : 'ВЫСАДКА [P]'}
                </span>
                <span className="text-xs font-semibold text-slate-200">
                  {currentOrder.status === 'pickup'
                    ? currentOrder.pickupDistrict
                    : currentOrder.destinationDistrict}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                <span>{targetDistance} м</span>
                <span>•</span>
                <span className="text-amber-400 font-bold">{currentOrder.orderType === 'normal' ? currentOrder.baseReward : getOrderReward(currentOrder)} $</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-300">
                {currentOrder.orderType === 'express' ? (
                  <span className="text-amber-300 font-bold">⚡ ЭКСПРЕСС · Эффективность: {Math.round(getExpressEfficiency(currentOrder.rideElapsed, currentOrder.targetTime) * 100)}%<br />Текущая выплата: {getOrderReward(currentOrder)} $ · Максимум: {Math.round(currentOrder.baseReward * EXPRESS_MAX_MULTIPLIER)} $</span>
                ) : <span>ОБЫЧНЫЙ ЗАКАЗ · Оплата фиксирована · {Math.round(currentOrder.routeDistance / 3.2)} м</span>}
              </div>
              <button id="btn-refuse-order" onClick={() => engine?.refuseOrder()} className="mt-1 text-[11px] font-bold text-rose-300 hover:text-rose-200">ОТКАЗАТЬСЯ</button>
              {nearbyHint && (
                <div className="mt-1 text-[10px] leading-tight text-cyan-200/90 whitespace-nowrap">
                  {nearbyHint}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Кнопки управления: Гараж, Звук, Музыка, Инфо */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            id="hud-btn-shop"
            onClick={onOpenShop}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-850 hover:bg-slate-750 text-slate-100 border border-slate-700 font-bold text-xs transition-all active:scale-95 shadow-md bg-slate-900/90"
          >
            <ShoppingBag className="w-4 h-4 text-cyan-400" />
            <span className="hidden sm:inline">Гараж</span>
          </button>

          <button
            id="hud-btn-sound"
            onClick={onToggleSound}
            aria-label="Звуки"
            className="p-2 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-700/70 text-slate-300 hover:text-white active:scale-95 transition-all shadow-md"
          >
            {saveData.settings.soundEnabled ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4 text-rose-400" />
            )}
          </button>

          <button
            id="hud-btn-music"
            onClick={onToggleMusic}
            aria-label="Музыка"
            className="p-2 rounded-xl bg-slate-900/85 hover:bg-slate-800 border border-slate-700/70 text-slate-300 hover:text-white active:scale-95 transition-all shadow-md"
          >
            <Music
              className={`w-4 h-4 ${
                saveData.settings.musicEnabled ? 'text-cyan-400' : 'text-slate-500'
              }`}
            />
          </button>

          {developerControls}
        </div>
      </div>

      <NeonFMPlayer
        settings={saveData.settings}
        onToggleMusic={onToggleMusic}
        onSetVolume={onSetAudioVolume}
      />

      {/* 2. Нижняя панель: Лаконичный Спидометр и кнопка Neon Dash */}
      {autoDockVisible && (
        <div id="hud-auto-dock" className={`absolute ${fuelStationStatus || refuelFeedback ? 'bottom-36' : 'bottom-24'} left-1/2 -translate-x-1/2 rounded-xl bg-cyan-950/92 border border-cyan-300/60 px-4 py-2 text-xs font-extrabold tracking-[0.18em] text-cyan-100 shadow-xl backdrop-blur-md`}>
          АВТОПАРКОВКА
        </div>
      )}
      {(fuelStationStatus || refuelFeedback) && (
        <div id="hud-refuel" className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950/92 border border-amber-400/50 px-4 py-2 text-xs font-extrabold text-amber-200 shadow-xl backdrop-blur-md">
          {refuelFeedback || (fuelStationStatus?.full
            ? `${fuelStationStatus.stationName} · БАК ПОЛОН`
            : `[F] ЗАПРАВИТЬСЯ · ${fuelStationStatus?.cost ?? 0} $`)}
        </div>
      )}
      <div className="flex items-end justify-between w-full pointer-events-auto">
        {/* Лаконичный спидометр без лишнего неона */}
        <div className="flex flex-col gap-2">
        <div id="hud-fuel" className={`px-3 py-2 rounded-xl bg-slate-900/85 border shadow-lg backdrop-blur-md ${fuel <= 20 ? 'border-amber-400/60' : 'border-slate-700/70'}`}>
          <div className="flex items-center justify-between gap-3 text-[11px] font-bold mb-1">
            <span className="text-slate-300">ТОПЛИВО</span>
            <span className={fuel <= 5 ? 'text-rose-400' : fuel <= 20 ? 'text-amber-300' : 'text-cyan-300'}>{roundedFuel}%</span>
          </div>
          <div className="w-24 sm:w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-150 ${fuel <= 5 ? 'bg-rose-500' : fuel <= 20 ? 'bg-amber-400' : 'bg-cyan-400'}`} style={{ width: `${Math.max(0, Math.min(100, fuel))}%` }} />
          </div>
          {fuelWarning && <div className={`mt-1 text-[9px] font-extrabold ${fuel <= 5 ? 'text-rose-300' : 'text-amber-300'}`}>{fuelWarning}</div>}
        </div>
        <div id="hud-hp" className="px-3 py-2 rounded-xl bg-slate-900/85 border border-slate-700/70 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between text-[11px] font-bold mb-1"><span className="text-slate-300">HP АВТО</span><span className={hp < 30 ? 'text-rose-400' : 'text-emerald-400'}>{hp}%</span></div>
          <div className="w-24 sm:w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${hp < 30 ? 'bg-rose-500' : 'bg-emerald-400'}`} style={{ width: `${hp}%` }} /></div>
        </div>
        <div id="hud-speedometer" className="flex flex-col px-4 py-2.5 rounded-2xl bg-slate-900/85 border border-slate-700/70 shadow-lg backdrop-blur-md">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight tabular-nums font-mono">
              {speed}
            </span>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              км/ч
            </span>
          </div>

          <div className="w-24 sm:w-32 h-1.5 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
            <div
              className="h-full bg-cyan-400 transition-all duration-75 rounded-full"
              style={{ width: `${Math.min(100, (speed / 180) * 100)}%` }}
            />
          </div>
        </div>
        </div>

        {/* Кнопка Neon Dash */}
        <div className="flex flex-col items-center">
          <button
            id="hud-btn-dash"
            onClick={handleDashClick}
            disabled={dashProgress < 1}
            className={`relative flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all active:scale-95 shadow-lg border ${
              dashProgress >= 1
                ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 border-cyan-300 shadow-cyan-500/20'
                : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
            }`}
          >
            <Zap className={`w-4 h-4 ${dashProgress >= 1 ? 'fill-slate-950' : 'text-slate-500'}`} />
            <span>РЫВОК DASH</span>

            {dashProgress < 1 && (
              <div
                className="absolute inset-0 rounded-xl bg-white/10 transition-all"
                style={{ width: `${dashProgress * 100}%` }}
              />
            )}
          </button>
          <div className="text-[11px] text-slate-400 font-medium mt-1">
            {dashProgress >= 1 ? '[X]' : `${Math.ceil((1 - dashProgress) * 4)}с`}
          </div>
        </div>
      </div>
    </div>
  );
}
