import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Social Scheduler",
    short_name: "Scheduler",
    description: "Schedule Instagram and YouTube content",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f6f4",
    theme_color: "#2b59ff",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
