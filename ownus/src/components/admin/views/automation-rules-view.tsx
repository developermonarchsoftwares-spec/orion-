'use client';

import React, { useState, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  SlidersHorizontal, 
  Workflow, 
  Zap, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Play, 
  Pause, 
  Trash2, 
  Edit3, 
  Layers, 
  ArrowRight,
  ShieldCheck,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { AutomationRule } from '@/types/admin';
import { AutomationRuleModal } from '@/components/admin/modals/automation-rule-modal';

interface AutomationRulesViewProps {
  rules: AutomationRule[];
  onCreateRule: (rule: Omit<AutomationRule, 'id' | 'executionsCount' | 'successRate' | 'lastExecuted'>) => void;
  onUpdateRule: (rule: AutomationRule) => void;
  onDeleteRule: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onRunRuleNow?: (id: string) => void;
}

export const AutomationRulesView: React.FC<AutomationRulesViewProps> = ({
  rules,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  onToggleStatus,
  onRunRuleNow,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [selectedTrigger, setSelectedTrigger] = useState<string>('all');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);

  // Statistics
  const stats = useMemo(() => {
    const total = rules.length;
    const active = rules.filter(r => r.status === 'Active').length;
    const paused = rules.filter(r => r.status === 'Paused').length;
    const totalExecutions = rules.reduce((acc, r) => acc + r.executionsCount, 0);
    const avgSuccess = total > 0 ? (rules.reduce((acc, r) => acc + r.successRate, 0) / total).toFixed(1) : '100';

    return { total, active, paused, totalExecutions, avgSuccess };
  }, [rules]);

  // Filtered Rules
  const filteredRules = useMemo(() => {
    return rules.filter(r => {
      const matchesSearch = 
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.conditionField.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.action.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = selectedStatus === 'all' || r.status === selectedStatus;
      const matchesPriority = selectedPriority === 'all' || r.priority === selectedPriority;
      const matchesTrigger = selectedTrigger === 'all' || r.trigger === selectedTrigger;

      return matchesSearch && matchesStatus && matchesPriority && matchesTrigger;
    });
  }, [rules, searchQuery, selectedStatus, selectedPriority, selectedTrigger]);

  const handleOpenCreateModal = () => {
    setEditingRule(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (rule: AutomationRule) => {
    setEditingRule(rule);
    setIsModalOpen(true);
  };

  const handleSaveRule = (savedData: any) => {
    if (editingRule) {
      onUpdateRule({
        ...editingRule,
        ...savedData,
      });
    } else {
      onCreateRule(savedData);
    }
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 rounded-2xl shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
              <Workflow className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Automation Engine & Policy Rules
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Define declarative Trigger-Condition-Action policies to automate data cleaning, deduplication routing, and discovery publishing.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-semibold rounded-xl transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create Rule</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Active Rules</span>
            <Zap className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stats.active}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">of {stats.total} total</span>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Executions</span>
            <Workflow className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stats.totalExecutions.toLocaleString()}</span>
            <span className="text-xs text-emerald-500 font-medium">all-time</span>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stats.avgSuccess}%</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">fleet average</span>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Paused Rules</span>
            <Pause className="w-4 h-4 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stats.paused}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">manual standby</span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 rounded-xl shadow-sm">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search automation rules, conditions, actions..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="text-xs bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-700 dark:text-zinc-300 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Paused">Paused</option>
            <option value="Draft">Draft</option>
          </select>

          {/* Priority Filter */}
          <select
            value={selectedPriority}
            onChange={e => setSelectedPriority(e.target.value)}
            className="text-xs bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-700 dark:text-zinc-300 focus:outline-none"
          >
            <option value="all">All Priorities</option>
            <option value="P1 Urgent">P1 Urgent</option>
            <option value="P2 High">P2 High</option>
            <option value="P3 Normal">P3 Normal</option>
            <option value="P4 Low">P4 Low</option>
          </select>

          {/* Trigger Filter */}
          <select
            value={selectedTrigger}
            onChange={e => setSelectedTrigger(e.target.value)}
            className="text-xs bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-700 dark:text-zinc-300 focus:outline-none"
          >
            <option value="all">All Triggers</option>
            <option value="On Record Ingested">On Record Ingested</option>
            <option value="On Validation Passed">On Validation Passed</option>
            <option value="On Validation Failed">On Validation Failed</option>
            <option value="On Duplicate Score > Threshold">On Duplicate Score &gt; Threshold</option>
            <option value="On Lead Score Computed">On Lead Score Computed</option>
            <option value="Scheduled Daily">Scheduled Daily</option>
          </select>

          {(searchQuery || selectedStatus !== 'all' || selectedPriority !== 'all' || selectedTrigger !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedStatus('all');
                setSelectedPriority('all');
                setSelectedTrigger('all');
              }}
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline px-1"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Rules List Cards / Table */}
      <div className="space-y-3">
        {filteredRules.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-12 text-center rounded-2xl">
            <Workflow className="w-10 h-10 mx-auto text-zinc-400 mb-3" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">No automation rules found</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
              Try adjusting your search criteria or create a new Trigger-Condition-Action automation policy.
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Create First Rule
            </button>
          </div>
        ) : (
          filteredRules.map(rule => (
            <div
              key={rule.id}
              className={`bg-white dark:bg-zinc-900 border transition-all rounded-xl p-4 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 ${
                rule.status === 'Active'
                  ? 'border-zinc-200 dark:border-zinc-800'
                  : 'border-zinc-200/60 dark:border-zinc-800/60 opacity-80'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Left: Info & Flow */}
                <div className="space-y-3 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono font-bold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                      {rule.id}
                    </span>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                      {rule.name}
                    </h3>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        rule.status === 'Active'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                          : rule.status === 'Paused'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                          : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                      }`}
                    >
                      {rule.status}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        rule.priority.startsWith('P1')
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                          : rule.priority.startsWith('P2')
                          ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {rule.priority}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                    {rule.description}
                  </p>

                  {/* Flow Diagram Mini Pill */}
                  <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                    {/* Trigger */}
                    <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/80 px-2.5 py-1 rounded-lg border border-zinc-200/80 dark:border-zinc-700/60 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="font-semibold text-zinc-500 dark:text-zinc-400">WHEN:</span>
                      <span>{rule.trigger}</span>
                    </div>

                    <ArrowRight className="w-3.5 h-3.5 text-zinc-400 shrink-0 hidden sm:block" />

                    {/* Condition */}
                    <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/80 px-2.5 py-1 rounded-lg border border-zinc-200/80 dark:border-zinc-700/60 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      <span className="font-semibold text-zinc-500 dark:text-zinc-400">IF:</span>
                      <span>
                        {rule.conditionField} {rule.conditionOperator.replace('_', ' ')} &quot;{rule.conditionValue}&quot;
                      </span>
                    </div>

                    <ArrowRight className="w-3.5 h-3.5 text-zinc-400 shrink-0 hidden sm:block" />

                    {/* Action */}
                    <div className="flex items-center gap-1.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-2.5 py-1 rounded-lg font-mono text-[11px] font-semibold">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400 dark:text-emerald-600 shrink-0" />
                      <span>THEN {rule.action}</span>
                      {rule.actionPayload && (
                        <span className="opacity-80 font-normal">({rule.actionPayload})</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Metrics & Actions */}
                <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between border-t lg:border-t-0 pt-3 lg:pt-0 border-zinc-100 dark:border-zinc-800 gap-3 shrink-0">
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <div className="text-[11px] text-zinc-400">Executions</div>
                      <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                        {rule.executionsCount.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-400">Success</div>
                      <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                        {rule.successRate}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-400">Last Trigger</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400 font-mono">
                        {rule.lastExecuted || 'Never'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {onRunRuleNow && (
                      <button
                        onClick={() => onRunRuleNow(rule.id)}
                        title="Execute manual dry-run"
                        className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-400 transition-colors"
                      >
                        <Play className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      </button>
                    )}
                    <button
                      onClick={() => onToggleStatus(rule.id)}
                      title={rule.status === 'Active' ? 'Pause Rule' : 'Activate Rule'}
                      className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-400 transition-colors"
                    >
                      {rule.status === 'Active' ? (
                        <Pause className="w-4 h-4 text-amber-500" />
                      ) : (
                        <Play className="w-4 h-4 text-emerald-500" />
                      )}
                    </button>
                    <button
                      onClick={() => handleOpenEditModal(rule)}
                      title="Edit Rule Definition"
                      className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-400 transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDeleteRule(rule.id)}
                      title="Delete Rule"
                      className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg text-zinc-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Rule Builder / Editor Modal */}
      {isModalOpen && (
        <AutomationRuleModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSaveRule={handleSaveRule}
          initialRule={editingRule || undefined}
        />
      )}
    </div>
  );
};
