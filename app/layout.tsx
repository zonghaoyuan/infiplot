import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { Analytics } from "@/components/Analytics";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { localePath } from "@/lib/i18n/navigation";
import { stripLocalePrefix } from "@/lib/i18n/navigation";
import "./globals.css";

// Editorial fonts: drive tailwind `font-serif`/`font-sans` via
// --font-serif / --font-sans across every page (home, /play, /new, CustomForm).
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "InfiPlot — AI 实时交互剧情游戏",
  description: "InfiPlot 是一款用 AI 实时生成图片、语音与剧情分支的交互式剧情游戏 Demo。",
};

// viewportFit:cover lets the immersive /play portrait layout extend under the
// iOS notch / home-indicator and exposes env(safe-area-inset-*) to the
// floating controls. device-width + initialScale keep mobile rendering 1:1.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const locale = headersList.get("x-locale") || "zh-CN";

  const origin =
    process.env.NEXT_PUBLIC_BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "https://infiplot.com");
  const pathname = headersList.get("x-pathname") || "/";
  const barePath = stripLocalePrefix(pathname);

  return (
    <html
      lang={locale}
      className={`${cormorant.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Font Awesome — fa-solid icons used by home, /play, /new, CustomForm. */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
        {LOCALES.map((l) => (
          <link
            key={l}
            rel="alternate"
            hrefLang={l}
            href={`${origin}${localePath(barePath, l)}`}
          />
        ))}
        <link rel="alternate" hrefLang="x-default" href={`${origin}${barePath}`} />
      </head>
      <body className="bg-cream-50 text-clay-900 font-sans antialiased min-h-screen overflow-x-hidden">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
