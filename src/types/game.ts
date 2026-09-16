export interface PlayerSaveData {
  saveRevision: number;
  updatedAt: number;
  coins: number;
  ordersCompleted: number;
  highScore: number;
  stats: {
    speedLevel: number;
    handlingLevel: number;
    dashLevel: number;
  };
  selectedSkinId: string;
  unlockedSkinIds: string[];
  settings: {
    soundEnabled: boolean;
    musicEnabled: boolean;
  };
}

export type CarModelType = 'sedan' | 'sport' | 'suv' | 'hyper' | 'aerocar';

export interface CarSkin {
  id: string;
  name: string;
  modelType: CarModelType;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  glowColor: string;
  trailColor: string;
  length: number;
  width: number;
  price: number;
  requiredOrders: number;
  maxSpeed: number;
  acceleration: number;
  braking: number;
  steering: number;
  grip: number;
  durability: number;
  dashPower: number;
  dashCooldown: number;
  speedBonus: number;
  handlingBonus: number;
  armorBonus?: number;
}

export interface ParkingZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number; // ориентация кармана
  district: string;
  name: string; // название объекта (например: "Отель Неон", "Кибер-Бар")
  accessRoadSegmentId: string;
}

export interface Order {
  id: string;
  passengerName: string;
  pickupDistrict: string;
  destinationDistrict: string;
  pickupSpotName: string;
  destinationSpotName: string;
  pickupX: number;
  pickupY: number;
  pickupAngle: number;
  destinationX: number;
  destinationY: number;
  destinationAngle: number;
  pickupZoneId: string;
  destinationZoneId: string;
  routeDistance: number;
  orderType: 'normal' | 'express';
  baseReward: number;
  targetTime: number;
  pickupElapsed: number;
  rideElapsed: number;
  status: 'pickup' | 'in_transit' | 'completed';
}

export interface District {
  id: string;
  name: string;
  label: string;
  icon: string;
  color: string;
  centerX: number;
  centerY: number;
  radius: number;
}

export interface NeonSign {
  text: string;
  color: string;
  glowColor: string;
  size: number;
  offsetX: number;
  offsetY: number;
  angle: number;
}

export interface Building {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  roofColor: string;
  neonBorderColor: string;
  glowColor: string;
  neonSign?: NeonSign;
  district?: string;
  type?: 'skyscraper' | 'commercial' | 'industrial' | 'residential' | 'terminal';
}

export interface StreetLight {
  x: number;
  y: number;
  color: string;
  radius: number;
  dirAngle?: number;
}

export interface TrafficLight {
  x: number;
  y: number;
  state: 'red' | 'yellow' | 'green';
  timer: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  glowColor: string;
  alpha: number;
  type?: 'spark' | 'smoke' | 'trail' | 'coin';
}

export interface SkidMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  alpha: number;
  color: string;
}

export interface FloatingText {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface TrafficCar {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  speed: number;
  targetSpeed: number;
  maxSpeed: number;
  width: number;
  length: number;
  color: string;
  glowColor: string;
  modelType: 'sedan' | 'suv' | 'truck' | 'sport';
  currentRoadId: string;
  targetNodeId: number;
  isBraking: boolean;
  honkTimer: number;
  currentLaneId: string;
  laneProgress: number;
  nextLaneId: string | null;
  activeTransitionId: string | null;
  transitionPoints: { x: number; y: number }[];
  transitionIndex: number;
  reservationZoneId: string | null;
  waitingForJunction: boolean;
  waitingDuration: number;
  blockingReason: 'vehicleAhead' | 'conflictZone' | 'routeUnavailable' | null;
  blockingCarId: string | null;
  progressWindowTime: number;
  progressWindowDistance: number;
  stalledWindowCount: number;
  stuckTimer: number;
  recoveryCount: number;
}

export interface AdCallbacks {
  onOpen?: () => void;
  onRewarded?: () => void;
  onClose?: () => void;
  onError?: (err: unknown) => void;
}
