import { Car } from './Car';
import { CAR_CATALOG } from './CarCatalog';
import { preloadSvgCarVisual } from './carVisuals/SvgCarRenderer';

for (const entry of CAR_CATALOG) {
  if (entry.renderer.draw) {
    Car.registerVisualRenderer(entry.modelType, entry.renderer.draw, {
      renderDashAfterimage: entry.renderer.type === 'svg',
    });
  }
  if (entry.renderer.type === 'svg') preloadSvgCarVisual(entry.renderer.assetUrl);
}
