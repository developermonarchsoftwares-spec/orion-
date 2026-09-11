"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { User, Lock, Bell, CreditCard, Settings2, Palette, Code, Check, Copy, RefreshCw, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";

function GoogleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.41 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.59 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

function MicrosoftIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const tabs = [
  { id: "profile", label: "Profile", icon: User },
  { id: "password", label: "Security & Accounts", icon: Lock },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "preferences", label: "Preferences", icon: Settings2 },
  { id: "theme", label: "Theme", icon: Palette },
  { id: "api", label: "API", icon: Code },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("profile");
  const { theme, setTheme } = useTheme();
  const { user, refreshProfile } = useAuth();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);

  // Profile Form State
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Notification Preferences State
  const [notifications, setNotifications] = useState({
    emailNewBusinesses: true,
    savedSearchAlerts: true,
    creditLowWarning: true,
    weeklyDigest: false,
    productUpdates: true,
    marketingEmails: false,
  });

  useEffect(() => {
    if (user) {
      setFullName(user.name || "");
      setEmail(user.email || "");
      setCompanyName(user.companyName || "");
    }

    // Load full settings
    apiClient.settings.getSettings().then((res) => {
      if (res?.company) {
        if (res.company.companyName) setCompanyName(res.company.companyName);
        if (res.company.phone) setPhone(res.company.phone);
        if (res.company.jobTitle) setJobTitle(res.company.jobTitle);
      }
      if (res?.notifications) {
        setNotifications((prev) => ({
          ...prev,
          ...res.notifications,
        }));
      }
    }).catch((err) => {
      console.warn("Could not load remote settings:", err);
    });
  }, [user]);

  const handleSaveProfile = async () => {
    setLoading(true);
    try {
      await apiClient.user.updateProfile({ name: fullName });
      await apiClient.settings.updateCompany({
        companyName,
        phone,
      });
      toast.success("Profile and company details updated successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const handleLinkProvider = (provider: "google" | "microsoft") => {
    window.location.href = provider === "google" 
      ? apiClient.auth.getLinkGoogleUrl() 
      : apiClient.auth.getLinkMicrosoftUrl();
  };

  const handleUnlinkProvider = async (provider: "google" | "microsoft") => {
    setUnlinkingProvider(provider);
    try {
      await apiClient.auth.unlinkProvider({ provider });
      toast.success(`Successfully disconnected ${provider === "google" ? "Google" : "Microsoft"}.`);
      await refreshProfile();
    } catch (err: any) {
      toast.error(err.message || "Failed to disconnect account.");
    } finally {
      setUnlinkingProvider(null);
    }
  };

  const handleUpdatePassword = async () => {
    const hasExistingPassword = user?.hasPassword !== false;
    if (hasExistingPassword && !currentPassword) {
      toast.error("Please enter your current password");
      return;
    }
    if (!newPassword) {
      toast.error("Please enter a new password");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await apiClient.user.changePassword({
        currentPassword: currentPassword || "",
        newPassword,
      });
      toast.success(hasExistingPassword ? "Password changed successfully!" : "Password set successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refreshProfile();
    } catch (err: any) {
      toast.error(err.message || "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleNotification = async (key: keyof typeof notifications) => {
    const updated = { ...notifications, [key]: !notifications[key] };
    setNotifications(updated);
    try {
      await apiClient.settings.updateNotifications(updated);
      toast.success("Notification preferences saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save notifications");
    }
  };

  const copyApiKey = () => {
    navigator.clipboard.writeText("sk-1234567890abcdef1234567890abcdef4f2a");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getInitials = (name: string) => {
    if (!name) return "US";
    return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 text-zinc-900 dark:text-zinc-100">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="text-xs text-zinc-500 mt-1">Manage your account settings and preferences.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <div className="w-full md:w-64 shrink-0 space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer",
                  activeTab === tab.id
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold shadow-xs"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-white"
                )}
              >
                <Icon className={cn("w-4 h-4", activeTab === tab.id ? "text-white dark:text-zinc-900" : "text-zinc-400 dark:text-zinc-500")} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xs min-h-[500px]">
          {/* Profile Tab */}
          {activeTab === "profile" && (
            <div className="p-6 md:p-8 space-y-8">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-4">Profile Information</h2>
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center text-xl font-bold shadow-xs">
                    {getInitials(fullName || user?.name || "Orion User")}
                  </div>
                  <div>
                    <button className="px-3.5 py-1.5 border border-zinc-300 dark:border-zinc-700 rounded-lg text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors cursor-pointer">
                      Change Photo
                    </button>
                    <p className="text-[11px] text-zinc-500 mt-1.5">JPG, GIF or PNG. Max size of 2MB.</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Email Address</label>
                  <input
                    type="email"
                    disabled
                    value={email}
                    className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/50 text-zinc-500 rounded-lg cursor-not-allowed"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Company Name</label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Job Title</label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="e.g. Sales Director"
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98450 12345"
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
                <button
                  onClick={handleSaveProfile}
                  disabled={loading}
                  className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-5 py-2 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-2"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {/* Security & Accounts Tab */}
          {activeTab === "password" && (
            <div className="p-6 md:p-8 space-y-8">
              {/* Connected Accounts Section */}
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Connected Accounts & Identity</h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    Connect your work or personal identity providers for seamless single sign-on.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Google Connection Card */}
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xs">
                          <GoogleIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Google Workspace</h3>
                          <p className="text-xs text-zinc-500">Sign in with your Google account</p>
                        </div>
                      </div>
                      {user?.googleLinked ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                          Connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          Not connected
                        </span>
                      )}
                    </div>

                    <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between">
                      <span className="text-[11px] text-zinc-400">
                        {user?.googleLinked ? "Identity active & linked" : "One-click OAuth authentication"}
                      </span>
                      {user?.googleLinked ? (
                        <button
                          type="button"
                          onClick={() => handleUnlinkProvider("google")}
                          disabled={unlinkingProvider === "google"}
                          className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-3 py-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                        >
                          {unlinkingProvider === "google" ? "Disconnecting..." : "Disconnect"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleLinkProvider("google")}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 px-3 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 transition-colors"
                        >
                          Connect Google
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Microsoft Connection Card */}
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xs">
                          <MicrosoftIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Microsoft Entra ID</h3>
                          <p className="text-xs text-zinc-500">Sign in with Microsoft 365 or Outlook</p>
                        </div>
                      </div>
                      {user?.microsoftLinked ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                          Connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          Not connected
                        </span>
                      )}
                    </div>

                    <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between">
                      <span className="text-[11px] text-zinc-400">
                        {user?.microsoftLinked ? "Identity active & linked" : "Enterprise SSO ready"}
                      </span>
                      {user?.microsoftLinked ? (
                        <button
                          type="button"
                          onClick={() => handleUnlinkProvider("microsoft")}
                          disabled={unlinkingProvider === "microsoft"}
                          className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-3 py-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                        >
                          {unlinkingProvider === "microsoft" ? "Disconnecting..." : "Disconnect"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleLinkProvider("microsoft")}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 px-3 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 transition-colors"
                        >
                          Connect Microsoft
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6" />

              {/* Password Section */}
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    {user?.hasPassword === false ? "Set Account Password" : "Change Password"}
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    {user?.hasPassword === false
                      ? "You currently sign in via social authentication. Create a password to also log in with your email."
                      : "Update your Orion account password to keep your business workspace secure."}
                  </p>
                </div>
                
                <div className="space-y-4 max-w-md text-xs">
                  {user?.hasPassword !== false && (
                    <div className="space-y-1.5">
                      <label className="font-semibold text-zinc-700 dark:text-zinc-300">Current Password</label>
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden"
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                      {user?.hasPassword === false ? "Create Password" : "New Password"}
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="font-semibold text-zinc-700 dark:text-zinc-300">Confirm Password</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 max-w-md text-xs">
                  <h4 className="font-semibold text-zinc-700 dark:text-zinc-300 mb-2">Password requirements:</h4>
                  <ul className="text-zinc-500 dark:text-zinc-400 space-y-1 list-disc pl-5 text-[11px]">
                    <li>Minimum 8 characters long</li>
                    <li>At least one uppercase character</li>
                    <li>At least one number</li>
                    <li>At least one special character</li>
                  </ul>
                </div>

                <div className="pt-2 flex">
                  <button
                    onClick={handleUpdatePassword}
                    disabled={loading}
                    className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-5 py-2 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-2"
                  >
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {user?.hasPassword === false ? "Save New Password" : "Update Password"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === "notifications" && (
            <div className="p-6 md:p-8 space-y-6">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Notification Preferences</h2>
              <p className="text-xs text-zinc-500 pb-4 border-b border-zinc-200 dark:border-zinc-800">Manage how and when you receive automated alerts.</p>

              <div className="space-y-5">
                {[
                  { key: "emailNewBusinesses" as const, title: "Email notifications for new businesses", desc: "Get notified when new businesses matching your criteria are added.", active: notifications.emailNewBusinesses },
                  { key: "savedSearchAlerts" as const, title: "Saved search alerts", desc: "Receive automated alerts for your saved searches.", active: notifications.savedSearchAlerts },
                  { key: "creditLowWarning" as const, title: "Credit low warning", desc: "Alert me when my credit balance falls below 50.", active: notifications.creditLowWarning },
                  { key: "weeklyDigest" as const, title: "Weekly digest", desc: "A summary of your activity and new opportunities.", active: notifications.weeklyDigest },
                  { key: "productUpdates" as const, title: "Product updates", desc: "News about product and feature updates.", active: notifications.productUpdates },
                  { key: "marketingEmails" as const, title: "Marketing emails", desc: "Receive offers and promotions from us.", active: notifications.marketingEmails },
                ].map((item, i) => (
                  <div key={i} className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</h4>
                      <p className="text-[11px] text-zinc-500 mt-0.5">{item.desc}</p>
                    </div>
                    <button
                      onClick={() => handleToggleNotification(item.key)}
                      className={cn(
                        "w-9 h-5 rounded-full relative transition-colors focus:outline-hidden shrink-0 cursor-pointer",
                        item.active ? "bg-zinc-900 dark:bg-white" : "bg-zinc-200 dark:bg-zinc-800"
                      )}
                    >
                      <div className={cn(
                        "absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform shadow-xs",
                        item.active 
                          ? "translate-x-4 bg-white dark:bg-zinc-900" 
                          : "translate-x-0 bg-white dark:bg-zinc-400"
                      )} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Billing Tab */}
          {activeTab === "billing" && (
            <div className="p-6 md:p-8 space-y-8">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-4">Billing & Plans</h2>

              <div className="bg-zinc-900 dark:bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-white">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">Professional Plan</h3>
                    <p className="text-xs text-zinc-400 mb-4">500 credits / month</p>
                    <div className="flex items-center gap-4 text-xs text-zinc-300">
                      <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5 text-white" /> Priority Support</span>
                      <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5 text-white" /> API Access</span>
                    </div>
                  </div>
                  <button className="bg-white text-zinc-900 px-4 py-2 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer">
                    Upgrade Plan
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-3 uppercase tracking-wider">Payment Method</h3>
                <div className="flex items-center justify-between border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-8 bg-zinc-100 dark:bg-zinc-800 rounded flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                      <span className="text-[10px] font-bold font-mono text-zinc-900 dark:text-zinc-100">VISA</span>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Visa ending in 4242</p>
                      <p className="text-[11px] text-zinc-500 font-mono">Expires 12/2025</p>
                    </div>
                  </div>
                  <button className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 hover:underline cursor-pointer">Update</button>
                </div>
              </div>

              <div className="text-xs text-zinc-600 dark:text-zinc-400 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                Next billing date is <span className="font-semibold text-zinc-900 dark:text-zinc-100 font-mono">September 15, 2024</span>. 
                Need to see past payments? <a href="/credits" className="text-zinc-900 dark:text-zinc-100 font-medium hover:underline ml-1">View billing history &rarr;</a>
              </div>
            </div>
          )}

          {/* Preferences Tab */}
          {activeTab === "preferences" && (
            <div className="p-6 md:p-8 space-y-6">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-4">App Preferences</h2>

              <div className="space-y-5 max-w-md text-xs">
                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">Default Results Per Page</label>
                  <select className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden bg-white dark:bg-zinc-900">
                    <option>10 results</option>
                    <option>25 results</option>
                    <option>50 results</option>
                    <option>100 results</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">Default View</label>
                  <select className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden bg-white dark:bg-zinc-900">
                    <option>Table View</option>
                    <option>Grid View</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">Timezone</label>
                  <select className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden bg-white dark:bg-zinc-900">
                    <option>India Standard Time (IST) - New Delhi, Kolkata</option>
                    <option>Pacific Time (PT) - US & Canada</option>
                    <option>Mountain Time (MT) - US & Canada</option>
                    <option>Central Time (CT) - US & Canada</option>
                    <option>Eastern Time (ET) - US & Canada</option>
                    <option>Coordinated Universal Time (UTC)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">Date Format</label>
                  <select className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden bg-white dark:bg-zinc-900">
                    <option>DD/MM/YYYY</option>
                    <option>MM/DD/YYYY</option>
                    <option>YYYY-MM-DD</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <button className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-5 py-2 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer">
                  Save Preferences
                </button>
              </div>
            </div>
          )}

          {/* Theme Tab */}
          {activeTab === "theme" && (
            <div className="p-6 md:p-8 space-y-6">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-2">Appearance</h2>
              <p className="text-xs text-zinc-500 mb-6">Customize how the application looks on your device.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Light */}
                <button 
                  onClick={() => setTheme("light")}
                  className={cn(
                    "border-2 rounded-xl p-4 text-left transition-all cursor-pointer",
                    theme === "light" ? "border-zinc-900 dark:border-white bg-zinc-50 dark:bg-zinc-900" : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400"
                  )}
                >
                  <div className="w-full h-20 bg-zinc-100 rounded-md mb-3 flex flex-col gap-2 p-2 border border-zinc-200">
                    <div className="h-3 bg-white rounded w-1/3"></div>
                    <div className="h-3 bg-white rounded w-full"></div>
                    <div className="h-3 bg-white rounded w-2/3"></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">Light</span>
                    {theme === "light" && <Check className="w-4 h-4 text-zinc-900 dark:text-white" />}
                  </div>
                </button>

                {/* Dark */}
                <button 
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "border-2 rounded-xl p-4 text-left transition-all cursor-pointer",
                    theme === "dark" ? "border-zinc-900 dark:border-white bg-zinc-50 dark:bg-zinc-900" : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400"
                  )}
                >
                  <div className="w-full h-20 bg-black rounded-md mb-3 flex flex-col gap-2 p-2 border border-zinc-800">
                    <div className="h-3 bg-zinc-800 rounded w-1/3"></div>
                    <div className="h-3 bg-zinc-800 rounded w-full"></div>
                    <div className="h-3 bg-zinc-800 rounded w-2/3"></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">Dark</span>
                    {theme === "dark" && <Check className="w-4 h-4 text-zinc-900 dark:text-white" />}
                  </div>
                </button>

                {/* System */}
                <button 
                  onClick={() => setTheme("system")}
                  className={cn(
                    "border-2 rounded-xl p-4 text-left transition-all cursor-pointer",
                    theme === "system" ? "border-zinc-900 dark:border-white bg-zinc-50 dark:bg-zinc-900" : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400"
                  )}
                >
                  <div className="w-full h-20 bg-gradient-to-r from-zinc-100 to-zinc-900 rounded-md mb-3 flex flex-col gap-2 p-2 border border-zinc-300 dark:border-zinc-700">
                    <div className="h-3 bg-white rounded w-1/3"></div>
                    <div className="h-3 bg-zinc-700 rounded w-full"></div>
                    <div className="h-3 bg-zinc-600 rounded w-2/3"></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">System</span>
                    {theme === "system" && <Check className="w-4 h-4 text-zinc-900 dark:text-white" />}
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* API Tab */}
          {activeTab === "api" && (
            <div className="p-6 md:p-8 space-y-8">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1">API Access</h2>
                <p className="text-xs text-zinc-500">Manage your API keys and webhook settings for integration.</p>
              </div>

              <div className="space-y-4 max-w-xl text-xs">
                <div className="space-y-1.5">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">Secret API Key</label>
                  <div className="flex gap-2">
                    <div className="flex-1 px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-900 font-mono text-xs text-zinc-800 dark:text-zinc-200 flex items-center justify-between">
                      <span>sk-•••••••••••••4f2a</span>
                      <button onClick={copyApiKey} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer">
                        {copied ? <Check className="w-4 h-4 text-zinc-900 dark:text-white" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <button className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 flex items-center gap-2 cursor-pointer">
                      <RefreshCw className="w-3.5 h-3.5" />
                      Regenerate
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-500">Never share your API key with anyone.</p>
                </div>

                <div className="space-y-1.5 pt-4">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">Webhook URL</label>
                  <input type="url" placeholder="https://your-domain.com/webhook" className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:outline-hidden" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 max-w-xl text-xs">
                <div className="bg-zinc-50 dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
                  <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Monthly Usage</p>
                  <p className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">1,247 <span className="text-xs font-normal text-zinc-500">requests</span></p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
                  <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Rate Limit</p>
                  <p className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">100 <span className="text-xs font-normal text-zinc-500">/ min</span></p>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <a href="#" className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 hover:underline">
                  View API Documentation &rarr;
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
