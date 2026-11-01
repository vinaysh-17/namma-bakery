import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { FindMyOrders } from "@/components/orders/find-my-orders";
import { getMyOrdersAction } from "@/lib/customer/find-orders-actions";

export const instant = false;

export const metadata: Metadata = {
  title: "Find My Orders",
  description:
    "Recover your Namma Bakery order and custom cake references by verifying your phone number.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function FindMyOrdersPage() {
  await connection();
  // If this browser already holds a verified phone session, show its orders directly
  const initial = await getMyOrdersAction();

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-xl px-4 py-8 sm:py-10 space-y-6">
        <nav aria-label="Breadcrumb">
          <Link
            href="/orders"
            className="inline-flex min-touch-target items-center gap-1.5 text-xs text-muted-foreground hover:text-caramel focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caramel transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Order Tracking</span>
          </Link>
        </nav>

        <div>
          <span className="font-kannada text-xs font-semibold text-caramel block mb-1">
            ನಿಮ್ಮ ಆರ್ಡರ್ ಹುಡುಕಿ
          </span>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Find My Orders
          </h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Forgot your order reference? Verify your phone number to see all your orders and
            custom cakes.
          </p>
        </div>

        <FindMyOrders initial={initial} />
      </div>
    </div>
  );
}
