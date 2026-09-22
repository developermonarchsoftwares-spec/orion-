"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Lock, Eye, EyeOff, Check, X, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Validation rules
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password !== "" && password === confirmPassword;

  const isValid = hasMinLength && hasUppercase && hasNumber && passwordsMatch && Boolean(token);

  const getPasswordStrength = () => {
    let score = 0;
    if (hasMinLength) score += 1;
    if (hasUppercase) score += 1;
    if (hasNumber) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    return score;
  };

  const strength = getPasswordStrength();
  
  const getStrengthWidth = () => {
    if (password.length === 0) return "w-0";
    if (strength === 0 || strength === 1) return "w-1/4";
    if (strength === 2) return "w-2/4";
    if (strength === 3) return "w-3/4";
    return "w-full";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setErrorMsg("Password reset token is missing. Please use the reset link sent to your email.");
      return;
    }
    if (!isValid) return;

    setIsLoading(true);
    setErrorMsg("");

    try {
      await apiClient.auth.resetPassword({ token, newPassword: password });
      toast.success("Password updated successfully! Please log in with your new password.");
      router.push("/login?reset=success");
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to reset password. The link may have expired or is invalid.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
      <div className="flex flex-col space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Set new password
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Your new password must be different from your previous password
        </p>
      </div>

      {!token && (
        <div className="rounded-md bg-amber-50 p-3.5 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 flex items-start gap-2 border border-amber-200 dark:border-amber-900/50">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>No reset token provided. Please open the link sent to your email address to reset your password.</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-md bg-red-50 p-3.5 text-xs text-red-600 dark:bg-red-950/50 dark:text-red-400 flex items-start gap-2 border border-red-200 dark:border-red-900/50">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid gap-6">
        <form onSubmit={handleSubmit}>
          <div className="grid gap-5">
            <div className="grid gap-1.5">
              <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                New Password
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="flex h-10 w-full rounded-md border border-zinc-300 bg-transparent px-3 pl-10 pr-10 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-200 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-50"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={cn("h-full bg-zinc-900 dark:bg-zinc-100 transition-all duration-300 ease-in-out", getStrengthWidth())}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="confirmPassword" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Confirm Password
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  className="flex h-10 w-full rounded-md border border-zinc-300 bg-transparent px-3 pl-10 pr-10 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-200 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-50"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-2 space-y-2 text-sm">
              <div className={cn("flex items-center", hasMinLength ? "text-zinc-900 dark:text-zinc-100 font-medium" : "text-zinc-400 dark:text-zinc-600")}>
                {hasMinLength ? <Check className="mr-2 h-4 w-4 text-emerald-500" /> : <X className="mr-2 h-4 w-4" />}
                <span>At least 8 characters</span>
              </div>
              <div className={cn("flex items-center", hasUppercase ? "text-zinc-900 dark:text-zinc-100 font-medium" : "text-zinc-400 dark:text-zinc-600")}>
                {hasUppercase ? <Check className="mr-2 h-4 w-4 text-emerald-500" /> : <X className="mr-2 h-4 w-4" />}
                <span>Contains uppercase letter</span>
              </div>
              <div className={cn("flex items-center", hasNumber ? "text-zinc-900 dark:text-zinc-100 font-medium" : "text-zinc-400 dark:text-zinc-600")}>
                {hasNumber ? <Check className="mr-2 h-4 w-4 text-emerald-500" /> : <X className="mr-2 h-4 w-4" />}
                <span>Contains number</span>
              </div>
              <div className={cn("flex items-center", passwordsMatch ? "text-zinc-900 dark:text-zinc-100 font-medium" : "text-zinc-400 dark:text-zinc-600")}>
                {passwordsMatch ? <Check className="mr-2 h-4 w-4 text-emerald-500" /> : <X className="mr-2 h-4 w-4" />}
                <span>Passwords match</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={!isValid || isLoading}
              className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-4 py-2 text-sm font-semibold shadow focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating password...
                </span>
              ) : (
                "Reset Password"
              )}
            </button>
          </div>
        </form>

        <div className="flex justify-center">
          <Link
            href="/login"
            className="inline-flex items-center text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="mx-auto flex w-full flex-col justify-center items-center space-y-4 sm:w-[350px] py-12">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        <p className="text-xs text-zinc-400">Loading password reset form...</p>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
