import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/i18n/provider";
import { PWARegistrar } from "@/components/pwa";
import { CanvasThemeApplier } from "@/components/customization/canvas-theme-applier";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* Browser chrome follows the light/dark chrome (white header / deep slate). */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1522" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Unstop CRM — Sales, Cadence & Success Platform",
  description:
    "Unstop Sales CRM: leads, contacts with CSM cadence, deals, pipelines, follow-up automation, BI analytics, tasks & calendar, omni-channel inbox, AI assistant and enterprise security.",
  keywords: [
    "CRM", "sales pipeline", "CSM cadence", "lead management", "follow-up automation",
    "analytics", "Unstop", "AI assistant", "multi-tenant", "SOC 2",
  ],
  authors: [{ name: "Unstop Sales" }],
  manifest: "/manifest.webmanifest",
  applicationName: "Unstop CRM",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Unstop CRM",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider>
            {children}
            <PWARegistrar />
            <CanvasThemeApplier />
            <Toaster />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
