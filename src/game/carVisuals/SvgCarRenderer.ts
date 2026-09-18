import type { CarSkin } from '../../types/game';

export type CarVisualRenderer = (
  ctx: CanvasRenderingContext2D,
  length: number,
  width: number,
  skin: CarSkin,
) => void;

type SvgImageState = {
  image: HTMLImageElement;
  status: 'loading' | 'loaded' | 'error';
};

const svgImageCache = new Map<string, SvgImageState>();

export const LAMBORGHINI_SVG_VISUAL_SPEC = Object.freeze({
  front: '+X' as const,
  pivot: Object.freeze({ x: 0, y: 0 }),
  viewBox: Object.freeze({ width: 1411, height: 760 }),
  assetUrl: '/assets/cars/lamborghini.svg',
});

function getOrCreateSvgImage(assetUrl: string): SvgImageState | null {
  const cached = svgImageCache.get(assetUrl);
  if (cached) return cached;
  if (typeof Image === 'undefined') return null;

  const image = new Image();
  const state: SvgImageState = { image, status: 'loading' };
  svgImageCache.set(assetUrl, state);
  image.decoding = 'async';
  image.onload = () => { state.status = 'loaded'; };
  image.onerror = () => { state.status = 'error'; };
  image.src = assetUrl;
  if (image.complete && image.naturalWidth > 0) state.status = 'loaded';
  return state;
}

/** Starts loading once and returns immediately; render calls share the same cached Image. */
export function preloadSvgCarVisual(assetUrl: string): void {
  getOrCreateSvgImage(assetUrl);
}

function renderLoadingFallback(ctx: CanvasRenderingContext2D, length: number, width: number, skin: CarSkin) {
  ctx.save();
  ctx.fillStyle = skin.secondaryColor;
  ctx.strokeStyle = skin.primaryColor;
  ctx.lineWidth = Math.max(1, width * 0.05);
  ctx.beginPath();
  ctx.roundRect(-length / 2, -width / 2, length, width, Math.max(2, width * 0.2));
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Creates a centered +X-facing image renderer. Rotation is applied by Car before this callback,
 * so the bitmap never influences collision geometry or vehicle dynamics.
 */
export function createSvgCarRenderer(assetUrl: string): CarVisualRenderer {
  return (ctx, length, width, skin) => {
    const state = getOrCreateSvgImage(assetUrl);
    if (state && (state.status === 'loaded' || (state.image.complete && state.image.naturalWidth > 0))) {
      state.status = 'loaded';
      ctx.drawImage(state.image, -length / 2, -width / 2, length, width);
      return;
    }
    renderLoadingFallback(ctx, length, width, skin);
  };
}

export function getSvgImageCacheSize(): number {
  return svgImageCache.size;
}

export function clearSvgImageCacheForTests(): void {
  svgImageCache.clear();
}
