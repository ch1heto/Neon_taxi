/**
 * Stable Yandex Player IDs allowed to use privileged tooling in hosted staging.
 * Keep production IDs out of source control when possible; this explicit list is
 * intentionally empty until an administrator adds approved IDs.
 */
export const ADMIN_PLAYER_IDS: readonly string[] = Object.freeze([
  // 'yandex-player-unique-id',
]);

interface DeveloperAccessContext {
  buildEnabled: boolean;
  isLocalDevelopment: boolean;
  allowLocalhostFallback: boolean;
  playerId: string | null;
  adminPlayerIds?: readonly string[];
}

const env = typeof import.meta.env !== 'undefined' ? import.meta.env : undefined;

/** Production builds opt in explicitly; Vite dev builds are eligible by default. */
export const DEV_TOOLS_BUILD_ENABLED = Boolean(
  env?.DEV || env?.VITE_ENABLE_ADMIN_TOOLS === 'true',
);

/** Explicit local-only fallback. It is compiled out of ordinary production builds. */
export const LOCAL_DEV_ADMIN_FALLBACK_ENABLED = env?.VITE_LOCAL_DEV_ADMIN !== 'false';

export function isLocalDevelopmentHost(hostname?: string): boolean {
  if (!env?.DEV) return false;
  const host = hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function canAccessDeveloperTools({
  buildEnabled,
  isLocalDevelopment,
  allowLocalhostFallback,
  playerId,
  adminPlayerIds = ADMIN_PLAYER_IDS,
}: DeveloperAccessContext): boolean {
  if (!buildEnabled) return false;
  if (isLocalDevelopment && allowLocalhostFallback) return true;
  return typeof playerId === 'string' && playerId.length > 0 && adminPlayerIds.includes(playerId);
}

export function isDeveloperToolsAuthorized(playerId: string | null): boolean {
  return canAccessDeveloperTools({
    buildEnabled: DEV_TOOLS_BUILD_ENABLED,
    isLocalDevelopment: isLocalDevelopmentHost(),
    allowLocalhostFallback: LOCAL_DEV_ADMIN_FALLBACK_ENABLED,
    playerId,
  });
}
