import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getStaffSession } from "@/lib/staff/auth";
import { StaffLoginForm } from "@/components/staff/staff-login-form";

export const instant = false;

export const metadata: Metadata = {
  title: "Staff Login",
  description: "Internal staff sign in for Namma Bakery kitchen and operations.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function StaffLoginPage() {
  await connection();
  const session = await getStaffSession();

  // If already authenticated with staff privileges, go directly to the dashboard
  if (session.isStaff) {
    redirect("/staff");
  }

  return (
    <div className="min-h-[calc(100dvh-16rem)] flex flex-col items-center justify-center py-4 sm:py-6 px-4 sm:px-6 lg:px-8 bg-background">
      <StaffLoginForm />
    </div>
  );
}
