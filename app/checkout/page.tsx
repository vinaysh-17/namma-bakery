import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { getBusinessHoursData } from "@/lib/hours/queries";

export const instant = false;

export const metadata: Metadata = {
  title: "Checkout & Order Review",
  description:
    "Review your fresh bakes and provide contact details for pickup at Namma Bakery, BEML Layout 3rd Stage, RR Nagar.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CheckoutPage() {
  const hours = await getBusinessHoursData();
  return <CheckoutForm hoursLabel={hours?.summaryLabel ?? null} />;
}
