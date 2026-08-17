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
    background_color: "#f6f7f7",
    theme_color: "#4a875a",
    categories: ["productivity"],
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  };
}
