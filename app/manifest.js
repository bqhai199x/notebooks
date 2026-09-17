export default function manifest() {
  return {
    name: "Notes",
    short_name: "Notes",
    description: "Private notes.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    orientation: "portrait-primary",
    background_color: "#f8fafc",
    theme_color: "#4a875a",
    categories: ["productivity"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  };
}
