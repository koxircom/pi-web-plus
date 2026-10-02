import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@/lib/branding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: `${BRAND_NAME} 编程代理网页界面`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1a1a1a",
    categories: ["developer", "productivity"],
    lang: "zh-CN",
    icons: [
      {
        src: "/icons/pi-web-plus-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
