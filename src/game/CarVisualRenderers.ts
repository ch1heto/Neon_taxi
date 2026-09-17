import { Car } from './Car';
import { renderNeonStreetGT as renderSkylineR34 } from './carVisuals/NeonStreetGT';
import { renderMazdaRX7FD } from './carVisuals/MazdaRX7FD';

Car.registerVisualRenderer('skyline-r34', renderSkylineR34);
Car.registerVisualRenderer('mazda-rx7-fd', renderMazdaRX7FD);
