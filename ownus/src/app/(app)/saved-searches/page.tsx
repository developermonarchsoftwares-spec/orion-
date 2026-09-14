"use client";

import { cn, formatRelativeDate } from "@/lib/utils";
import { Plus, Play, Pencil, Trash2, Bell, BellOff, Clock, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";

export default function SavedSearchesPage() {
  const [searches, setSearches] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSearches = async () => {
    try {
      const res = await apiClient.savedSearches.list();
      if (Array.isArray(res)) {
        setSearches(res);
      }
    } catch (err) {
      console.warn("Saved searches API fallback active:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSearches();
  }, []);

  const toggleAlert = async (id: string, currentAlert: boolean) => {
    try {
      const updated = await apiClient.savedSearches.update(id, { alertEnabled: !currentAlert });
      setSearches((prev) =>
        prev.map((s) => (s.id === id ? { ...s, alertEnabled: !currentAlert } : s))
      );
      toast.success(`Search alert ${!currentAlert ? "enabled" : "disabled"}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to update alert settings");
    }
  };

  const deleteSearch = async (id: string) => {
    try {
      await apiClient.savedSearches.delete(id);
      setSearches((prev) => prev.filter((s) => s.id !== id));
      toast.success("Saved search query deleted");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete saved search");
    }
  };

  const displaySearches = searches.length > 0 ? searches : [
    {
      id: "1",
      name: "New Restaurants Without Website",
      filters: { industry: "Restaurant", hasWebsite: false },
      alertEnabled: true,
      alertFrequency: "DAILY",
      createdAt: new Date(),
    },
    {
      id: "2",
      name: "High Opportunity Tech Startups",
      filters: { industry: "Technology", minOrionScore: 80 },
      alertEnabled: true,
      alertFrequency: "WEEKLY",
      createdAt: new Date(),
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Saved Searches & Alerts</h1>
          <p className="text-xs text-zinc-500 mt-1">Manage automated search queries and periodic lead notifications.</p>
        </div>
        
        <Link 
          href="/discover"
          className="inline-flex items-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Create New Search
        </Link>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {displaySearches.map((search) => {
          const filterEntries = typeof search.filters === "object" ? Object.entries(search.filters) : [];

          return (
            <div key={search.id} className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-all flex flex-col group">
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-base leading-tight">{search.name}</h3>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => deleteSearch(search.id)}
                    className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer" 
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-1.5 mb-4">
                {filterEntries.slice(0, 4).map(([k, v], i) => (
                  <span key={i} className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium border border-zinc-200 dark:border-zinc-700">
                    {k}: {String(v)}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between text-xs mt-auto pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">Live Alert Stream</span>
                  <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                    <Clock className="w-3 h-3" /> Saved {search.createdAt ? formatRelativeDate(search.createdAt) : "recently"}
                  </span>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => toggleAlert(search.id, search.alertEnabled)}
                      className={cn(
                        "w-9 h-5 rounded-full relative transition-colors focus:outline-hidden cursor-pointer",
                        search.alertEnabled ? "bg-zinc-900 dark:bg-white" : "bg-zinc-200 dark:bg-zinc-800"
                      )}
                    >
                      <div className={cn(
                        "absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform shadow-xs",
                        search.alertEnabled 
                          ? "translate-x-4 bg-white dark:bg-zinc-900" 
                          : "translate-x-0 bg-white dark:bg-zinc-400"
                      )} />
                    </button>
                    {search.alertEnabled ? (
                      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                        <Bell className="w-3 h-3 text-zinc-700 dark:text-zinc-300" /> {search.alertFrequency || "Daily"}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400 flex items-center gap-1">
                        <BellOff className="w-3 h-3" /> Off
                      </span>
                    )}
                  </div>
                  
                  <Link 
                    href={`/discover?savedSearchId=${search.id}`}
                    className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-zinc-700 cursor-pointer"
                    title="Run Search in Discover"
                  >
                    <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
