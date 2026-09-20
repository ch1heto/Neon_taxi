export type GameLocale = 'ru' | 'en';

export const DEFAULT_GAME_LOCALE: GameLocale = 'ru';
export const SUPPORTED_GAME_LOCALES: readonly GameLocale[] = Object.freeze(['ru']);

/** Maps the Yandex locale to a language currently shipped by the game. */
export function resolveGameLocale(yandexLanguage?: unknown): GameLocale {
  if (typeof yandexLanguage !== 'string') return DEFAULT_GAME_LOCALE;
  const normalized = yandexLanguage.trim().toLowerCase().replace('_', '-').split('-')[0];
  return SUPPORTED_GAME_LOCALES.includes(normalized as GameLocale)
    ? normalized as GameLocale
    : DEFAULT_GAME_LOCALE;
}
