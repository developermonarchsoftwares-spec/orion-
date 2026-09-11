'use client';

import React, { useState } from 'react';
import { 
  Workflow, 
  X, 
  Play, 
  Save, 
  Sliders, 
  ArrowRight,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import { AutomationRule } from '@/types/admin';

interface AutomationRuleModalProps {
  rule?: AutomationRule | null;
  initialRule?: AutomationRule | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveRule: (rule: Omit<AutomationRule, 'id' | 'executionsCount' | 'successRate'>) => void;
}

export const AutomationRuleModal: React.FC<AutomationRuleModalProps> = ({
  rule,
  initialRule,
  isOpen,
  onClose,
  onSaveRule,
}) => {
  const activeRule = rule || initialRule;
  const [name, setName] = useState(activeRule?.name || '');
  const [description, setDescription] = useState(activeRule?.description || '');
  const [trigger, setTrigger] = useState<AutomationRule['trigger']>(activeRule?.trigger || 'On Record Ingested');
  const [conditionField, setConditionField] = useState(activeRule?.conditionField || 'dataQualityScore');
  const [conditionOperator, setConditionOperator] = useState<AutomationRule['conditionOperator']>(activeRule?.conditionOperator || 'greater_than');
  const [conditionValue, setConditionValue] = useState(activeRule?.conditionValue || '90');
  const [action, setAction] = useState<AutomationRule['action']>(activeRule?.action || 'Auto-Publish');
  const [actionPayload, setActionPayload] = useState(activeRule?.actionPayload || '');
  const [priority, setPriority] = useState<AutomationRule['priority']>(activeRule?.priority || 'P2 High');
  const [status, setStatus] = useState<AutomationRule['status']>(activeRule?.status || 'Active');

  React.useEffect(() => {
    if (activeRule) {
      setName(activeRule.name);
      setDescription(activeRule.description);
      setTrigger(activeRule.trigger);
      setConditionField(activeRule.conditionField);
      setConditionOperator(activeRule.conditionOperator);
      setConditionValue(activeRule.conditionValue);
      setAction(activeRule.action);
      setActionPayload(activeRule.actionPayload || '');
      setPriority(activeRule.priority);
      setStatus(activeRule.status);
    }
  }, [activeRule]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSaveRule({
      name: name.trim(),
      description: description.trim() || 'Automated rule engine policy.',
      trigger,
      conditionField,
      conditionOperator,
      conditionValue,
      action,
      actionPayload: actionPayload.trim() || undefined,
      priority,
      status,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-4 text-xs font-sans text-zinc-100">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Workflow className="w-5 h-5 text-zinc-300" />
            <h3 className="text-base font-bold text-zinc-100">
              {rule ? 'Edit Automation Rule' : 'Create Automation Rule'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block font-medium text-zinc-400 mb-1">Rule Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Auto-Publish 100% Verified Records"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="block font-medium text-zinc-400 mb-1">Rule Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Explain the intent and behavior of this automated policy..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>

          {/* Trigger Card */}
          <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">1. Pipeline Trigger</span>
            <select
              value={trigger}
              onChange={e => setTrigger(e.target.value as any)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
            >
              <option value="On Record Ingested">On Record Ingested (Batch or Stream)</option>
              <option value="On Validation Passed">On Validation Passed (Schema Valid)</option>
              <option value="On Validation Failed">On Validation Failed (Format Error)</option>
              <option value="On Duplicate Score > Threshold">On Duplicate Score &gt; Threshold</option>
              <option value="On Lead Score Computed">On Lead Score Computed</option>
              <option value="Scheduled Daily">Scheduled Daily Cron</option>
            </select>
          </div>

          {/* Condition Card */}
          <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">2. Evaluation Condition</span>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={conditionField}
                onChange={e => setConditionField(e.target.value)}
                placeholder="Field (e.g. dataQualityScore)"
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100"
              />
              <select
                value={conditionOperator}
                onChange={e => setConditionOperator(e.target.value as any)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
              >
                <option value="equals">equals (==)</option>
                <option value="greater_than">greater than (&gt;)</option>
                <option value="less_than">less than (&lt;)</option>
                <option value="contains">contains</option>
                <option value="is_empty">is empty</option>
                <option value="is_not_empty">is not empty</option>
              </select>
              <input
                type="text"
                value={conditionValue}
                onChange={e => setConditionValue(e.target.value)}
                placeholder="Value (e.g. 90)"
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100"
              />
            </div>
          </div>

          {/* Action Card */}
          <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">3. Target Action</span>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={action}
                onChange={e => setAction(e.target.value as any)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
              >
                <option value="Auto-Publish">Auto-Publish to Discover</option>
                <option value="Auto-Reject">Auto-Reject Candidate Record</option>
                <option value="Assign Industry">Assign Industry Sector</option>
                <option value="Assign Category">Assign Business Category</option>
                <option value="Quarantine for Review">Quarantine to Review Queue</option>
                <option value="Trigger AI Enrichment">Trigger AI Enrichment Task</option>
                <option value="Send Alert">Send Admin Alert</option>
              </select>
              <input
                type="text"
                value={actionPayload}
                onChange={e => setActionPayload(e.target.value)}
                placeholder="Optional Payload / Tag (e.g. Cloud ERP)"
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-zinc-400 mb-1">Execution Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
              >
                <option value="P1 Urgent">P1 Urgent (Real-time evaluation)</option>
                <option value="P2 High">P2 High</option>
                <option value="P3 Normal">P3 Normal (Batch evaluation)</option>
                <option value="P4 Low">P4 Low</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-zinc-400 mb-1">Policy Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
              >
                <option value="Active">Active</option>
                <option value="Paused">Paused</option>
                <option value="Draft">Draft</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition"
            >
              Save Automation Rule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
