import type { Metadata } from "next";
import { CartView } from "@/components/cart/cart-view";
import { getBusinessHoursData } from "@/lib/hours/queries";

export const instant = false;

export const metadata: Metadata = {
  title: "Shopping Cart",
  description:
    "Review your selected cakes and bakes before choosing a pickup slot at Namma Bakery, RR Nagar.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CartPage() {
  const hours = await getBusinessHoursData();
  return <CartView hoursLabel={hours?.summaryLabel ?? null} />;
}
