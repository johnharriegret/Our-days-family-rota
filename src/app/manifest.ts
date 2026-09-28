import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Our Days · Family rota",
    short_name: "Our Days",
    description: "The Gret family calendar, shifts and school days.",
    start_url: "/month",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#6a63d1",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/our-days-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/our-days-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
