import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PlanBaan แผนบ้าน",
    short_name: "PlanBaan",
    description: "ติดตามการตลาดและการขายของโครงการบ้าน",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F4F7FD",
    theme_color: "#2563EB",
    lang: "th",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
