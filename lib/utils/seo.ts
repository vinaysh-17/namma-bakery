/**
 * Utility helpers for SEO, base URL resolution, and structured data.
 */

import type { BusinessHoursData } from "@/lib/hours/types";

export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }
  return "https://nammabakery.com";
}

/**
 * Standard Bakery schema.org JSON-LD matching real project details.
 */
const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export function getBakeryJsonLd(hours?: BusinessHoursData | null) {
  const siteUrl = getBaseUrl();

  let openingHoursSpec: object[] = [];
  if (hours && hours.entries.length > 0) {
    const byKey = new Map<string, number[]>();
    for (const e of hours.entries) {
      const key = `${e.opens}|${e.closes}`;
      const arr = byKey.get(key) ?? [];
      arr.push(e.weekday);
      byKey.set(key, arr);
    }
    openingHoursSpec = Array.from(byKey.entries()).map(([key, weekdays]) => {
      const [opens, closes] = key.split("|");
      return {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: weekdays.map((w) => WEEKDAY_NAMES[w]),
        opens,
        closes,
      };
    });
  }

  return {
    "@context": "https://schema.org",
    "@type": "Bakery",
    name: "Namma Bakery",
    alternateName: "ನಮ್ಮ ಬೇಕರಿ",
    url: siteUrl,
    description:
      "Handcrafted cakes, fresh savoury bakes, and everyday neighbourhood favourites in Rajarajeshwari Nagar, Bengaluru.",
    address: {
      "@type": "PostalAddress",
      streetAddress: "BEML Layout 3rd Stage",
      addressLocality: "Rajarajeshwari Nagar",
      addressRegion: "Karnataka",
      postalCode: "560098",
      addressCountry: "IN",
    },
    geo: {
      "@type": "GeoCoordinates",
      addressCountry: "IN",
    },
    ...(openingHoursSpec.length > 0
      ? { openingHoursSpecification: openingHoursSpec }
      : {}),
    hasMenu: `${siteUrl}/menu`,
    servesCuisine: ["Bakery", "Desserts", "Snacks"],
    paymentAccepted: "Cash, Credit Card, Debit Card, UPI",
    currenciesAccepted: "INR",
    priceRange: "₹₹",
  };
}
