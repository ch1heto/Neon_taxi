import type { CarSkin } from '../types/game';
import { getCarCatalogEntry, getCatalogCarSkin } from './CarCatalog';

export const MAZDA_RX7_FD_TEST_DRIVE_ID = 'mazda-rx7-fd';
export type ExperimentalTestDriveCar = Readonly<Omit<CarSkin, 'price' | 'requiredOrders'>>;

const mazdaEntry = getCarCatalogEntry(MAZDA_RX7_FD_TEST_DRIVE_ID)!;
const { price: _price, requiredOrders: _requiredOrders, status: _status, renderer: _renderer,
  physicsProvenance: _provenance, ...mazdaProfile } = mazdaEntry;

/** Compatibility exports now derived from the universal catalog. */
export const MAZDA_RX7_FD_TEST_DRIVE_PROFILE: ExperimentalTestDriveCar = Object.freeze(mazdaProfile);
export const MAZDA_RX7_FD_TEST_DRIVE_SKIN = getCatalogCarSkin(MAZDA_RX7_FD_TEST_DRIVE_ID)!;
