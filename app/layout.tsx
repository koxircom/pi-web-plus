import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import { PiWebEnhancementsRuntime } from "@/components/PiWebEnhancementsRuntime";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "katex/dist/katex.min.css";
import { BRAND_NAME } from "@/lib/branding";
import "./globals.css";
import "./settings.css";
import "./composer.css";
import "./enhancements.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: `${BRAND_NAME} 编程代理网页界面`,
  applicationName: BRAND_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icon.svg?v=pi-plus-disc-20261003",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        url: "/favicon.ico?v=pi-plus-disc-20261003",
        sizes: "16x16 32x32 48x48 64x64 128x128 256x256",
        type: "image/x-icon",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: BRAND_NAME,
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" translate="no" className={`${notoSansMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        {children}
        <PiWebEnhancementsRuntime />
        <PwaRegistration />
      </body>
    </html>
  );
}
