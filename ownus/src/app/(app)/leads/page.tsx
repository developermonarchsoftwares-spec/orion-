"use client";

import { useState, useEffect, useMemo } from "react";
import { cn, formatRelativeDate } from "@/lib/utils";
import { Download, Search, Filter, ChevronDown, Eye, Plus, Trash2, Building2, Loader2 } from "lucide-react";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";

type Status = "New" | "Contacted" | "Qualified" | "Proposal" | "Won" | "Lost";

const statusColors: Record<string, string> = {
  New: "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border-zinc-200 dark:border-zinc-700",
  Contacted: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  Qualified: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  Proposal: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400 border-purple-200 dark:border-purple-800",
  Won: "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100",
  Lost: "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-800",
};

export default function LeadsPage() {
  const [data, setData] = useState<any[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [isLoading, setIsLoading] = useState(true);

  const fetchLeads = async () => {
    try {
      const res = await apiClient.savedLeads.list();
      if (res?.items) {
        setData(res.items);
      }
    } catch (err) {
      console.warn("Saved leads API fallback active:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const filteredData = useMemo(() => {
    return data.filter((lead) => {
      const name = lead.business?.name || lead.name || "";
      const matchesSearch = searchQuery.trim() === "" || name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStage = stageFilter === "ALL" || (lead.pipelineStage || lead.status)?.toLowerCase() === stageFilter.toLowerCase();
      return matchesSearch && matchesStage;
    });
  }, [data, searchQuery, stageFilter]);

  const stats = [
    { label: "Total Leads", value: String(data.length) },
    { label: "New", value: String(data.filter((l) => (l.pipelineStage || l.status) === "NEW" || (l.pipelineStage || l.status) === "New").length) },
    { label: "Contacted", value: String(data.filter((l) => (l.pipelineStage || l.status) === "CONTACTED" || (l.pipelineStage || l.status) === "Contacted").length) },
    { label: "Qualified", value: String(data.filter((l) => (l.pipelineStage || l.status) === "QUALIFIED" || (l.pipelineStage || l.status) === "Qualified").length) },
  ];

  const toggleSelectAll = () => {
    if (selectedLeads.length === filteredData.length) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(filteredData.map((l) => l.id));
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedLeads.includes(id)) {
      setSelectedLeads(selectedLeads.filter((l) => l !== id));
    } else {
      setSelectedLeads([...selectedLeads, id]);
    }
  };

  const updateStatus = async (id: string, stage: string) => {
    try {
      await apiClient.savedLeads.update(id, { pipelineStage: stage.toUpperCase() });
      setData((prev) =>
        prev.map((lead) => (lead.id === id ? { ...lead, pipelineStage: stage } : lead))
      );
      toast.success(`Lead stage updated to ${stage}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to update lead status");
    }
  };

  const removeLead = async (id: string) => {
    try {
      await apiClient.savedLeads.remove(id);
      setData((prev) => prev.filter((l) => l.id !== id));
      toast.success("Lead removed from pipeline");
    } catch (err: any) {
      toast.error(err.message || "Failed to remove lead");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedLeads.length === 0) return;
    try {
      await apiClient.savedLeads.bulkDelete({ leadIds: selectedLeads });
      setData((prev) => prev.filter((l) => !selectedLeads.includes(l.id)));
      setSelectedLeads([]);
      toast.success("Selected leads deleted");
    } catch (err: any) {
      toast.error(err.message || "Bulk delete failed");
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Saved Leads & CRM</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-sm font-medium border border-zinc-200 dark:border-zinc-700">
            {filteredData.length}
          </span>
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-grow sm:flex-grow-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Search leads..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 pl-9 pr-4 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
            />
          </div>

          {selectedLeads.length > 0 && (
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete ({selectedLeads.length})
            </button>
          )}

          <Link
            href="/discover"
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 rounded-lg text-xs font-semibold shadow-xs transition-opacity cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Discover Leads
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-xs">
            <p className="text-sm font-medium text-zinc-500">{stat.label}</p>
            <p className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium text-xs">
              <tr>
                <th className="px-4 py-3 w-12">
                  <input 
                    type="checkbox" 
                    className="rounded border-zinc-300 dark:border-zinc-700 text-zinc-900 focus:ring-0 cursor-pointer"
                    checked={selectedLeads.length === filteredData.length && filteredData.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-4 py-3">Business Name</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Stage / Status</th>
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3">Saved Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
              {filteredData.length > 0 ? (
                filteredData.map((lead) => {
                  const bName = lead.business?.name || lead.name || "Business Lead";
                  const bInd = lead.business?.industryName || lead.industry || "B2B";
                  const bLoc = lead.business?.city ? `${lead.business.city}, ${lead.business.state || ""}` : lead.location || "India";
                  const currentStage = lead.pipelineStage || lead.status || "New";

                  return (
                    <tr key={lead.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 group">
                      <td className="px-4 py-4">
                        <input 
                          type="checkbox" 
                          className="rounded border-zinc-300 dark:border-zinc-700 text-zinc-900 focus:ring-0 cursor-pointer"
                          checked={selectedLeads.includes(lead.id)}
                          onChange={() => toggleSelect(lead.id)}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shrink-0">
                            <Building2 className="w-4 h-4 text-zinc-500" />
                          </div>
                          <div>
                            <p className="font-medium text-zinc-900 dark:text-zinc-100">{bName}</p>
                            <p className="text-xs text-zinc-500">{bInd}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-zinc-600 dark:text-zinc-400">{bLoc}</td>
                      <td className="px-4 py-4">
                        <div className="relative inline-block text-left group/dropdown">
                          <button className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer",
                            statusColors[currentStage] || statusColors.New
                          )}>
                            {currentStage}
                            <ChevronDown className="w-3 h-3 opacity-50" />
                          </button>
                          <div className="absolute left-0 mt-1 w-32 bg-white dark:bg-zinc-900 rounded-md shadow-lg border border-zinc-200 dark:border-zinc-800 z-10 hidden group-hover/dropdown:block">
                            <div className="py-1">
                              {["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"].map((s) => (
                                <button
                                  key={s}
                                  onClick={() => updateStatus(lead.id, s)}
                                  className="block w-full text-left px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex gap-1 flex-wrap w-48">
                          {(lead.tags || []).map((tag: string, i: number) => (
                            <span key={i} className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                              {tag}
                            </span>
                          ))}
                          {(!lead.tags || lead.tags.length === 0) && <span className="text-zinc-400 text-xs">-</span>}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-zinc-500 font-mono">
                        {lead.createdAt ? formatRelativeDate(lead.createdAt) : lead.date || "Recent"}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {lead.business?.slug && (
                            <Link 
                              href={`/discover?q=${encodeURIComponent(bName)}`}
                              className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors cursor-pointer" 
                              title="View in Discover"
                            >
                              <Eye className="w-4 h-4" />
                            </Link>
                          )}
                          <button 
                            onClick={() => removeLead(lead.id)}
                            className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md transition-colors cursor-pointer" 
                            title="Remove Lead"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500">
                    {isLoading ? "Loading saved leads..." : "No saved leads in your pipeline yet. Start discovering and saving businesses!"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
          <div>Showing {filteredData.length} saved leads</div>
        </div>
      </div>
    </div>
  );
}
