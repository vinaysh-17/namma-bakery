import { Suspense } from "react";
import type { Metadata } from "next";
import { CustomCakeHero } from "@/components/custom-cake/custom-cake-hero";
import { CustomCakeForm } from "@/components/custom-cake/custom-cake-form";
import { getBusinessHoursData, getSpecialClosures } from "@/lib/hours/queries";
import { getEarliestCustomCakePickupDate } from "@/lib/custom-cake/validation";

export const instant = false;

export const metadata: Metadata = {
  title: "Custom Celebration Cakes & Enquiries",
  description:
    "Order bespoke handcrafted celebration cakes in RR Nagar, Bengaluru. Wedding tiers, birthday cakes, custom flavours, photo cakes, and eggless varieties made fresh.",
  alternates: {
    canonical: "/custom-cake",
  },
  openGraph: {
    title: "Custom Celebration Cakes & Enquiries | Namma Bakery",
    description:
      "Order bespoke handcrafted celebration cakes in RR Nagar, Bengaluru. Wedding tiers, birthday cakes, custom flavours, and eggless varieties made fresh.",
    url: "/custom-cake",
  },
};

export default async function CustomCakePage() {
  const hours = await getBusinessHoursData();
  // Evaluated after the data fetch above, so the current date is read at request time.
  const specialClosures = await getSpecialClosures(getEarliestCustomCakePickupDate());

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <CustomCakeHero />
      <Suspense
        fallback={
          <div className="rounded-sm border border-border bg-card p-12 text-center text-muted-foreground text-sm">
            Loading custom cake builder...
          </div>
        }
      >
        <CustomCakeForm
          businessHoursEntries={hours?.entries ?? null}
          specialClosures={specialClosures}
        />
      </Suspense>
    </div>
  );
}
