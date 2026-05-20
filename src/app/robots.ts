import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/docs",
      disallow: ["/dashboard/", "/api/", "/auth/"],
    },
  };
}
