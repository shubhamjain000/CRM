'use client'

import * as React from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { messages } from '@/i18n/messages'
import { defaultLocale, isRTL, locales, type Locale } from '@/i18n/config'

const LOCALE_KEY = 'fn_locale'

export function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return defaultLocale
  const stored = window.localStorage.getItem(LOCALE_KEY)
  if (stored && (locales as readonly string[]).includes(stored)) return stored as Locale
  return defaultLocale
}

export function setStoredLocale(locale: Locale) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LOCALE_KEY, locale)
}

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  dir: 'ltr' | 'rtl'
}

const I18nContext = React.createContext<I18nContextValue | null>(null)

export function useI18n() {
  const ctx = React.useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(defaultLocale)

  React.useEffect(() => {
    setLocaleState(getStoredLocale())
  }, [])

  React.useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = isRTL(locale) ? 'rtl' : 'ltr'
  }, [locale])

  const setLocale = React.useCallback((l: Locale) => {
    setLocaleState(l)
    setStoredLocale(l)
  }, [])

  const value = React.useMemo<I18nContextValue>(
    () => ({ locale, setLocale, dir: isRTL(locale) ? 'rtl' : 'ltr' }),
    [locale, setLocale],
  )

  const dict = (messages as Record<string, Record<string, unknown>>)[locale] ?? messages.en

  return (
    <I18nContext.Provider value={value}>
      <NextIntlClientProvider locale={locale} messages={dict}>
        {children}
      </NextIntlClientProvider>
    </I18nContext.Provider>
  )
}
