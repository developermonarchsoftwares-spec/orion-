'use client';

import React, { useState } from 'react';
import {
  SlidersHorizontal,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  RotateCcw,
  Sparkles,
  Search,
  Tag,
  Layers,
  Building,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  Globe,
  Sliders,
  FolderPlus,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import {
  useFilterOptions,
  FilterCategory,
  FilterOption,
  addCategory,
  updateCategory,
  deleteCategory,
  addOptionToCategory,
  updateOptionInCategory,
  deleteOptionFromCategory,
  toggleOptionActive,
  resetFilterOptionsToDefault
} from '@/lib/filter-options-store';

export const AdminFilterManager: React.FC = () => {
  const { config, loading } = useFilterOptions();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('quick_filters');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [newCatType, setNewCatType] = useState<FilterCategory['type']>('multi_select');

  const [isAddOptionOpen, setIsAddOptionOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<FilterOption | null>(null);

  const [optLabel, setOptLabel] = useState('');
  const [optValue, setOptValue] = useState('');
  const [optDesc, setOptDesc] = useState('');
  const [optParent, setOptParent] = useState('');
  const [optIcon, setOptIcon] = useState('');

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const selectedCategory = config.categories.find((c) => c.id === selectedCategoryId) || config.categories[0];

  const filteredOptions = (selectedCategory?.options || []).filter((opt) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      opt.label.toLowerCase().includes(q) ||
      opt.value.toLowerCase().includes(q) ||
      (opt.parentValue && opt.parentValue.toLowerCase().includes(q))
    );
  });

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    const cat = addCategory({
      name: newCatName.trim(),
      description: newCatDesc.trim(),
      type: newCatType,
      isActive: true,
    });
    setSelectedCategoryId(cat.id);
    setIsAddCategoryOpen(false);
    setNewCatName('');
    setNewCatDesc('');
    showToast(`Filter Category "${cat.name}" created successfully.`);
  };

  const handleDeleteCategory = (cat: FilterCategory) => {
    if (confirm(`Are you sure you want to delete filter category "${cat.name}" and all its options?`)) {
      deleteCategory(cat.id);
      if (selectedCategoryId === cat.id) {
        const remaining = config.categories.filter((c) => c.id !== cat.id);
        if (remaining.length > 0) setSelectedCategoryId(remaining[0].id);
      }
      showToast(`Category "${cat.name}" deleted.`);
    }
  };

  const handleOpenAddOption = () => {
    setEditingOption(null);
    setOptLabel('');
    setOptValue('');
    setOptDesc('');
    setOptParent('');
    setOptIcon('');
    setIsAddOptionOpen(true);
  };

  const handleOpenEditOption = (opt: FilterOption) => {
    setEditingOption(opt);
    setOptLabel(opt.label);
    setOptValue(opt.value);
    setOptDesc(opt.description || '');
    setOptParent(opt.parentValue || '');
    setOptIcon(opt.iconName || '');
    setIsAddOptionOpen(true);
  };

  const handleSaveOption = (e: React.FormEvent) => {
    e.preventDefault();
    if (!optLabel.trim() || !selectedCategory) return;

    const val = optValue.trim() || optLabel.trim();

    if (editingOption) {
      updateOptionInCategory(selectedCategory.id, editingOption.id, {
        label: optLabel.trim(),
        value: val,
        description: optDesc.trim(),
        parentValue: optParent.trim() || undefined,
        iconName: optIcon.trim() || undefined,
      });
      showToast(`Filter Option "${optLabel}" updated.`);
    } else {
      addOptionToCategory(selectedCategory.id, {
        label: optLabel.trim(),
        value: val,
        description: optDesc.trim(),
        parentValue: optParent.trim() || undefined,
        iconName: optIcon.trim() || undefined,
        isActive: true,
        displayOrder: (selectedCategory.options.length || 0) + 1,
      });
      showToast(`Filter Option "${optLabel}" added to ${selectedCategory.name}.`);
    }

    setIsAddOptionOpen(false);
  };

  const handleDeleteOption = (opt: FilterOption) => {
    if (!selectedCategory) return;
    if (confirm(`Delete filter option "${opt.label}"?`)) {
      deleteOptionFromCategory(selectedCategory.id, opt.id);
      showToast(`Option "${opt.label}" deleted.`);
    }
  };

  const handleToggleActive = (optId: string) => {
    if (!selectedCategory) return;
    toggleOptionActive(selectedCategory.id, optId);
  };

  const handleResetDefaults = () => {
    if (confirm('Reset all filter categories and options to factory defaults? Custom categories will be removed.')) {
      resetFilterOptionsToDefault();
      showToast('Filter options reset to default configuration.');
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-zinc-400">Loading Filter Governance Options...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-green-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Telemetry & Control Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-zinc-300" />
              User Page Filter Options Manager
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-green-950 text-green-300 border border-green-800 text-[10px] font-bold flex items-center gap-1">
              <Globe className="w-3 h-3 text-green-400" /> Live Sync Active
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Add, edit, enable/disable, or delete filter categories and options. All updates made here dynamically reflect on the customer Discover page in real time.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleResetDefaults}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>

          <button
            onClick={() => setIsAddCategoryOpen(true)}
            className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition flex items-center gap-1.5 cursor-pointer shadow"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Add Filter Category
          </button>
        </div>
      </div>

      {/* Category Tabs & Options Manager Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: Category Selector List */}
        <div className="lg:col-span-1 bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="px-2 py-1 text-[11px] uppercase font-bold text-zinc-400 tracking-wider flex justify-between items-center">
            <span>Filter Categories ({config.categories.length})</span>
          </div>

          <div className="space-y-1">
            {config.categories.map((cat) => {
              const isSelected = cat.id === selectedCategoryId;
              const activeCount = cat.options.filter((o) => o.isActive).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`w-full text-left p-2.5 rounded-lg text-xs font-medium transition flex items-center justify-between group cursor-pointer ${
                    isSelected
                      ? 'bg-zinc-800 text-zinc-100 font-bold border border-zinc-700 shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-950/60 border border-transparent'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <span className="truncate block font-semibold">{cat.name}</span>
                    <span className="text-[10px] text-zinc-500 font-mono block">
                      {activeCount}/{cat.options.length} options active
                    </span>
                  </div>

                  <span className={`px-1.5 py-0.5 text-[9px] rounded font-mono shrink-0 uppercase ${
                    cat.type === 'chip' ? 'bg-purple-950 text-purple-300 border border-purple-800' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                  }`}>
                    {cat.type.replace('_', ' ')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Category Options Workspace */}
        {selectedCategory && (
          <div className="lg:col-span-3 bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
            {/* Category Header Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-zinc-100">{selectedCategory.name}</h3>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono">
                    ID: {selectedCategory.id}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">{selectedCategory.description || 'Manage options for this filter category'}</p>
              </div>

              <div className="flex items-center gap-2">
                {!selectedCategory.isSystem && (
                  <button
                    onClick={() => handleDeleteCategory(selectedCategory)}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-900/50 transition flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete Category
                  </button>
                )}

                <button
                  onClick={handleOpenAddOption}
                  className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition flex items-center gap-1.5 cursor-pointer shadow"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Option Value
                </button>
              </div>
            </div>

            {/* Filter Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search options in ${selectedCategory.name}...`}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {/* Options List */}
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {filteredOptions.length === 0 ? (
                <div className="p-8 text-center bg-zinc-950 border border-zinc-800/80 rounded-xl space-y-2">
                  <Sliders className="w-6 h-6 text-zinc-600 mx-auto" />
                  <p className="text-xs text-zinc-400">No filter options found matching search.</p>
                </div>
              ) : (
                filteredOptions.map((opt, idx) => (
                  <div
                    key={opt.id}
                    className={`p-3 rounded-lg border transition flex items-center justify-between gap-3 ${
                      opt.isActive
                        ? 'bg-zinc-950 border-zinc-800/80 hover:border-zinc-700'
                        : 'bg-zinc-950/40 border-zinc-900 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-mono font-bold text-zinc-600 w-6">#{idx + 1}</span>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-zinc-100 truncate">{opt.label}</span>
                          {opt.iconName && (
                            <span className="px-1.5 py-0.2 text-[9px] font-mono rounded bg-purple-950 text-purple-300 border border-purple-900">
                              icon: {opt.iconName}
                            </span>
                          )}
                          {!opt.isActive && (
                            <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-zinc-800 text-zinc-500 border border-zinc-700">
                              Disabled
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-zinc-500 mt-0.5">
                          <span>Value: <strong className="text-zinc-400 font-mono">{opt.value}</strong></span>
                          {opt.parentValue && (
                            <span>Parent Industry: <strong className="text-zinc-300">{opt.parentValue}</strong></span>
                          )}
                          {opt.description && (
                            <span className="truncate">{opt.description}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Active Toggle Button */}
                      <button
                        onClick={() => handleToggleActive(opt.id)}
                        title={opt.isActive ? 'Disable option on User Page' : 'Enable option on User Page'}
                        className={`p-1.5 rounded-lg border text-xs font-medium transition cursor-pointer flex items-center gap-1 ${
                          opt.isActive
                            ? 'bg-green-950/50 border-green-800 text-green-300 hover:bg-green-900/60'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {opt.isActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        <span>{opt.isActive ? 'Active' : 'Disabled'}</span>
                      </button>

                      {/* Edit Option Button */}
                      <button
                        onClick={() => handleOpenEditOption(opt)}
                        className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition cursor-pointer"
                        title="Edit Option details"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      {/* Delete Option Button */}
                      <button
                        onClick={() => handleDeleteOption(opt)}
                        className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-red-950 text-zinc-400 hover:text-red-400 transition cursor-pointer"
                        title="Delete Option"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal 1: Create Category */}
      {isAddCategoryOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-5 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-zinc-100 text-sm flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-zinc-300" /> Create Custom Filter Category
              </h3>
              <button onClick={() => setIsAddCategoryOpen(false)} className="text-zinc-400 hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Category Title *</label>
                <input
                  type="text"
                  required
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="e.g. Export Certifications, Legal Status"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Description</label>
                <input
                  type="text"
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                  placeholder="Explaining the filter scope to administrators and users"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Category Type *</label>
                <select
                  value={newCatType}
                  onChange={(e) => setNewCatType(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                >
                  <option value="multi_select">Multi-Select Checkboxes</option>
                  <option value="single_select">Single Radio Select</option>
                  <option value="chip">Horizontal Filter Chips</option>
                  <option value="boolean_toggle">Boolean Toggle</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsAddCategoryOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-800 hover:bg-zinc-800 text-zinc-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 shadow"
                >
                  Create Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Add / Edit Option */}
      {isAddOptionOpen && selectedCategory && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-5 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-zinc-100 text-sm flex items-center gap-2">
                <Plus className="w-4 h-4 text-zinc-300" />
                {editingOption ? `Edit Option in "${selectedCategory.name}"` : `Add Option to "${selectedCategory.name}"`}
              </h3>
              <button onClick={() => setIsAddOptionOpen(false)} className="text-zinc-400 hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveOption} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Display Label *</label>
                <input
                  type="text"
                  required
                  value={optLabel}
                  onChange={(e) => {
                    setOptLabel(e.target.value);
                    if (!editingOption) setOptValue(e.target.value);
                  }}
                  placeholder="e.g. Robotics & Industrial AI"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Target Search Value *</label>
                <input
                  type="text"
                  required
                  value={optValue}
                  onChange={(e) => setOptValue(e.target.value)}
                  placeholder="Exact string value matched against business catalog"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono"
                />
              </div>

              {selectedCategory.id === 'sub_industries' && (
                <div>
                  <label className="text-xs font-semibold text-zinc-300 block mb-1">Parent Industry Sector</label>
                  <input
                    type="text"
                    value={optParent}
                    onChange={(e) => setOptParent(e.target.value)}
                    placeholder="e.g. Manufacturing & Industrial"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                  />
                </div>
              )}

              {selectedCategory.id === 'quick_filters' && (
                <div>
                  <label className="text-xs font-semibold text-zinc-300 block mb-1">Lucide Icon Name</label>
                  <input
                    type="text"
                    value={optIcon}
                    onChange={(e) => setOptIcon(e.target.value)}
                    placeholder="e.g. Sparkles, Calendar, Globe, Mail, Phone, ShieldCheck"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">Description / Tooltip</label>
                <input
                  type="text"
                  value={optDesc}
                  onChange={(e) => setOptDesc(e.target.value)}
                  placeholder="Optional explanatory note"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsAddOptionOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-800 hover:bg-zinc-800 text-zinc-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 shadow"
                >
                  {editingOption ? 'Save Changes' : 'Add Option Value'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
