/**
 * Message bundle aggregator for `next-intl`.
 *
 * Imports all 12 locale message dictionaries statically so the bundler can
 * tree-shake unused locales per route. Each JSON file shares the exact same
 * key shape (see `en.json` for the canonical schema).
 *
 * Usage in the app:
 *   import { messages } from '@/i18n/messages';
 *   import { defaultLocale } from '@/i18n/config';
 *
 *   <NextIntlClientProvider locale={locale} messages={messages[locale]}>
 *     {children}
 *   </NextIntlClientProvider>
 */
import type { Locale } from './config';

import en from './messages/en.json';
import hi from './messages/hi.json';
import ta from './messages/ta.json';
import te from './messages/te.json';
import bn from './messages/bn.json';
import mr from './messages/mr.json';
import gu from './messages/gu.json';
import kn from './messages/kn.json';
import es from './messages/es.json';
import fr from './messages/fr.json';
import de from './messages/de.json';
import ar from './messages/ar.json';

/**
 * Static map of locale code → message dictionary.
 * Keys are exhaustive over `Locale`; if you add a locale to `config.ts`,
 * add the matching import + entry here as well.
 */
export const messages: Record<Locale, typeof en> = {
  en,
  hi,
  ta,
  te,
  bn,
  mr,
  gu,
  kn,
  es,
  fr,
  de,
  ar,
};

/**
 * TypeScript helper: returns the message dictionary for a locale, falling
 * back to the default (`en`) if the locale is not recognised. Useful in
 * client components where the active locale is derived from user state.
 */
export function getMessages(locale: string): typeof en {
  return (messages as Record<string, typeof en>)[locale] ?? en;
}

export type Messages = typeof en;
