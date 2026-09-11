"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { handleOAuthTokens } = useAuth();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [message, setMessage] = useState("Authenticating with Orion...");

  useEffect(() => {
    let isMounted = true;

    async function processAuth() {
      const error = searchParams.get("error");
      const accessToken = searchParams.get("accessToken");
      const refreshToken = searchParams.get("refreshToken");
      const isNewUser = searchParams.get("isNewUser") === "true";
      const linked = searchParams.get("linked") === "true";
      const provider = searchParams.get("provider");

      if (error) {
        if (!isMounted) return;
        setStatus("error");
        setMessage(decodeURIComponent(error));
        toast.error(decodeURIComponent(error));
        setTimeout(() => router.replace("/login"), 2500);
        return;
      }

      if (linked) {
        if (!isMounted) return;
        setStatus("success");
        setMessage(`Successfully linked ${provider || "provider"} to your account!`);
        toast.success(`Successfully connected your ${provider || "social"} account.`);
        setTimeout(() => router.replace("/settings"), 1500);
        return;
      }

      if (accessToken && refreshToken) {
        try {
          if (!isMounted) return;
          setMessage("Setting up your workspace & wallet...");
          await handleOAuthTokens(accessToken, refreshToken);

          if (!isMounted) return;
          setStatus("success");

          if (isNewUser) {
            toast.success("Welcome to Orion! 5 free daily credits added to your wallet.");
          } else {
            toast.success("Welcome back to Orion!");
          }

          router.replace("/dashboard");
        } catch (err: any) {
          if (!isMounted) return;
          setStatus("error");
          const errorMsg = err.message || "Failed to initialize session. Please try logging in again.";
          setMessage(errorMsg);
          toast.error(errorMsg);
          setTimeout(() => router.replace("/login"), 2500);
        }
        return;
      }

      // No relevant params found
      if (!isMounted) return;
      setStatus("error");
      setMessage("No authentication tokens found. Redirecting to login...");
      setTimeout(() => router.replace("/login"), 1500);
    }

    processAuth();

    return () => {
      isMounted = false;
    };
  }, [searchParams, handleOAuthTokens, router]);

  return (
    <div className="flex flex-col items-center justify-center space-y-4 text-center p-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl max-w-md mx-auto">
      <div className="relative">
        <div className="h-16 w-16 rounded-full bg-blue-500/10 dark:bg-blue-400/10 flex items-center justify-center">
          {status === "processing" && (
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
          )}
          {status === "success" && (
            <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          )}
          {status === "error" && (
            <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
          )}
        </div>
      </div>

      <div className="space-y-1">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {status === "processing" && "Securing Identity"}
          {status === "success" && "Authentication Successful"}
          {status === "error" && "Sign-In Failed"}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {message}
        </p>
      </div>

      <div className="pt-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Orion Enterprise Identity
        </span>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
