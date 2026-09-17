import type { CarSkin } from '../types/game';

export const MAZDA_RX7_FD_TEST_DRIVE_ID = 'experimental-mazda-rx7-fd';

export type ExperimentalTestDriveCar = Readonly<Omit<CarSkin, 'price' | 'requiredOrders'>>;

/** Test-only profile. Its performance values are an independent copy of the Cyber GT baseline. */
export const MAZDA_RX7_FD_TEST_DRIVE_PROFILE: ExperimentalTestDriveCar = Object.freeze({
  id: MAZDA_RX7_FD_TEST_DRIVE_ID,
  name: 'Mazda RX-7 FD',
  modelType: 'mazda-rx7-fd',
  description: 'Экспериментальное низкое спорт-купе: плавный длинный капот, компактная кабина и большое заднее антикрыло.',
  primaryColor: '#C9152D',
  secondaryColor: '#171820',
  glowColor: 'rgba(255, 49, 95, 0.46)',
  trailColor: 'rgba(255, 49, 95, 0.46)',
  length: 56,
  width: 30,
  maxSpeed: 392,
  acceleration: 475,
  braking: 690,
  steering: 3.75,
  grip: 0.82,
  durability: 0.85,
  dashPower: 390,
  dashCooldown: 3.7,
  speedBonus: 52,
  handlingBonus: 0.25,
});

// TestDrive consumes only driving/visual fields; keeping commerce fields absent is intentional.
export const MAZDA_RX7_FD_TEST_DRIVE_SKIN = MAZDA_RX7_FD_TEST_DRIVE_PROFILE as CarSkin;
