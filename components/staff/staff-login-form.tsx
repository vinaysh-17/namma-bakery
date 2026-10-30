"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Loader2, Lock, Mail, AlertCircle, ChefHat, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { staffLoginAction, type ActionState } from "@/lib/staff/actions";

const initialState: ActionState = {
  error: null,
};

export function StaffLoginForm() {
  const [showPassword, setShowPassword] = React.useState(false);
  const [state, formAction, isPending] = useActionState(
    staffLoginAction,
    initialState
  );

  return (
    <div className="w-full max-w-md mx-auto space-y-3">
      <div className="rounded-sm border border-border bg-card p-5 sm:p-6 space-y-4 sm:space-y-5">
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center justify-center size-10 rounded-full bg-caramel/10 text-caramel mx-auto mb-0.5">
            <ChefHat className="size-5" />
          </div>
          <h1 className="font-heading text-xl sm:text-2xl font-bold text-foreground">
            Staff Portal
          </h1>
          <p className="text-xs text-muted-foreground">
            Sign in with your staff account to manage orders and kitchen operations.
          </p>
        </div>

        {state?.error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-sm border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive dark:bg-destructive/20"
          >
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span className="leading-tight">{state.error}</span>
          </div>
        )}

        <form action={formAction} className="space-y-3.5" noValidate>
          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="block text-xs font-semibold uppercase tracking-wider text-foreground"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="staff@nammabakery.com"
                className="w-full min-h-[44px] rounded-sm border border-border bg-background pl-10 pr-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel hover:border-caramel/50 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="block text-xs font-semibold uppercase tracking-wider text-foreground"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full min-h-[44px] rounded-sm border border-border bg-background pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel hover:border-caramel/50 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex size-8 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel transition-colors cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-caramel text-sm font-semibold text-white shadow-none transition-colors hover:bg-caramel/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground cursor-pointer mt-1"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Verifying Credentials...</span>
              </>
            ) : (
              <span>Sign In to Dashboard</span>
            )}
          </button>
        </form>

        <div className="pt-3 border-t border-border/60 text-center">
          <p className="text-[11px] text-muted-foreground">
            Internal bakery system. Unauthorized access attempts are logged.
          </p>
        </div>
      </div>

      {/* Secondary navigation back to public bakery homepage */}
      <div className="text-center pt-1">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-caramel transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caramel rounded-sm py-1 px-2.5 cursor-pointer"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          <span>Go to Home</span>
        </Link>
      </div>
    </div>
  );
}
