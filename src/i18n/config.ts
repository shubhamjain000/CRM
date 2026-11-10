/**
 * i18n configuration for the Foundation platform.
 *
 * This is a client-side i18n setup using `next-intl`. There is no Next.js
 * middleware-based locale routing — this is a single-route sandbox app, so the
 * active locale is chosen in the client (persisted in localStorage) and
 * applied via a `NextIntlClientProvider` mounted in the root layout.
 *
 * Canonical source for the list of supported locales, their human-readable
 * native names, and RTL/LTR direction logic.
 */

/** All supported locale codes. Keep in stable display order. */
export const locales = [
  'en',
  'hi',
  'ta',
  'te',
  'bn',
  'mr',
  'gu',
  'kn',
  'es',
  'fr',
  'de',
  'ar',
] as const;

export type Locale = (typeof locales)[number];

/** Default locale used when no preference is stored or detectable. */
export const defaultLocale: Locale = 'en';

/**
 * Native display name for each locale, in that locale's own script.
 * Used to populate the language switcher dropdown.
 */
export const localeNames: Record<Locale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  bn: 'বাংলা',
  mr: 'मराठी',
  gu: 'ગુજરાતી',
  kn: 'ಕನ್ನಡ',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ar: 'العربية',
};

/** Locales whose script renders right-to-left. */
const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ar']);

/** Returns true when the locale's script is right-to-left. */
export function isRTL(locale: string): boolean {
  return RTL_LOCALES.has(locale as Locale);
}

/** Returns the HTML `dir` attribute value for the locale. */
export function dir(locale: string): 'rtl' | 'ltr' {
  return isRTL(locale) ? 'rtl' : 'ltr';
}

/**
 * Type guard: narrows an arbitrary string to a `Locale` if it is supported,
 * otherwise returns the `defaultLocale`.
 */
export function normalizeLocale(value: string | undefined | null): Locale {
  if (value && (locales as readonly string[]).includes(value)) {
    return value as Locale;
  }
  return defaultLocale;
}
