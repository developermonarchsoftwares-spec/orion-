'use client';

import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Key, 
  Users, 
  Plus, 
  Save, 
  RotateCcw, 
  CheckCircle2, 
  Lock, 
  Unlock, 
  Sliders, 
  FileCheck2,
  Trash2,
  Copy,
  Info
} from 'lucide-react';
import { 
  RoleDefinition, 
  PermissionAction 
} from '@/types/admin';

interface RolesPermissionsViewProps {
  roles: RoleDefinition[];
  onUpdateRole: (role: RoleDefinition) => void;
  onCreateRole: (newRole: Omit<RoleDefinition, 'id'>) => void;
}

export const RolesPermissionsView: React.FC<RolesPermissionsViewProps> = ({
  roles,
  onUpdateRole,
  onCreateRole,
}) => {
  const [selectedRoleId, setSelectedRoleId] = useState<string>(roles[0]?.id || 'role-superadmin');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [cloneFromRoleId, setCloneFromRoleId] = useState(roles[0]?.id || '');
  const [savedNotification, setSavedNotification] = useState(false);

  // Active role being edited
  const currentRole = roles.find(r => r.id === selectedRoleId) || roles[0];
  const [editedModules, setEditedModules] = useState(currentRole?.modules || []);

  React.useEffect(() => {
    if (currentRole) {
      setEditedModules(currentRole.modules);
    }
  }, [selectedRoleId, currentRole]);

  const handleTogglePermission = (moduleKey: string, action: PermissionAction) => {
    setEditedModules(prev => prev.map(mod => {
      if (mod.moduleKey === moduleKey) {
        return {
          ...mod,
          permissions: {
            ...mod.permissions,
            [action]: !mod.permissions[action]
          }
        };
      }
      return mod;
    }));
  };

  const handleToggleRow = (moduleKey: string, enableAll: boolean) => {
    setEditedModules(prev => prev.map(mod => {
      if (mod.moduleKey === moduleKey) {
        return {
          ...mod,
          permissions: {
            read: enableAll,
            write: enableAll,
            delete: enableAll,
            export: enableAll,
            admin: enableAll,
          }
        };
      }
      return mod;
    }));
  };

  const handleSaveRoleMatrix = () => {
    if (!currentRole) return;
    onUpdateRole({
      ...currentRole,
      modules: editedModules
    });
    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 3000);
  };

  const handleCreateNewRoleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;

    const baseRole = roles.find(r => r.id === cloneFromRoleId) || roles[0];
    const clonedModules = JSON.parse(JSON.stringify(baseRole.modules));

    onCreateRole({
      name: newRoleName.trim(),
      description: newRoleDescription.trim() || 'Custom organizational role.',
      userCount: 0,
      isSystem: false,
      modules: clonedModules
    });

    setNewRoleName('');
    setNewRoleDescription('');
    setShowCreateModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-zinc-300" />
            Roles & Granular Permissions Matrix
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Enforce least-privilege security access across 12 Orion core modules for Super Admins, Data Managers, Reviewers, and Finance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {savedNotification && (
            <span className="text-xs font-semibold text-zinc-200 bg-zinc-800 border border-zinc-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-zinc-300" /> Matrix Saved
            </span>
          )}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
          >
            <Plus className="w-4 h-4" />
            Create Role
          </button>
          <button
            onClick={handleSaveRoleMatrix}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition shadow"
          >
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </div>

      {/* Main Container: Roles Sidebar + Permissions Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        
        {/* Roles List */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2 lg:sticky lg:top-32">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-2 pb-1 border-b border-zinc-800">
            Platform Roles ({roles.length})
          </div>

          <div className="space-y-1 pt-1">
            {roles.map(role => {
              const isSelected = selectedRoleId === role.id;
              return (
                <button
                  key={role.id}
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`w-full p-3 rounded-lg text-left transition flex items-start justify-between gap-2 ${
                    isSelected
                      ? 'bg-zinc-100 text-zinc-950 font-bold shadow'
                      : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  <div>
                    <div className="text-sm font-semibold">{role.name}</div>
                    <div className={`text-[11px] mt-0.5 ${isSelected ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      {role.userCount} assigned users
                    </div>
                  </div>
                  {role.isSystem && (
                    <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${
                      isSelected ? 'bg-zinc-200 text-zinc-800' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    }`}>
                      System
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Permissions Matrix */}
        <div className="lg:col-span-3 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm space-y-4 p-5">
          {/* Active Role Meta Card */}
          <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-zinc-100">{currentRole.name} Matrix</h2>
                {currentRole.isSystem && (
                  <span className="text-[10px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700 px-2 py-0.5 rounded">
                    Default System Role
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                {currentRole.description}
              </p>
            </div>

            <div className="text-xs text-zinc-400 font-mono shrink-0">
              Assigned to <strong className="text-zinc-100">{currentRole.userCount}</strong> active administrators
            </div>
          </div>

          {/* 12 Modules Matrix Table */}
          <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-900 text-[11px] uppercase font-semibold text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Platform Module</th>
                    <th className="py-3 px-4 text-center">Read / View</th>
                    <th className="py-3 px-4 text-center">Create / Edit</th>
                    <th className="py-3 px-4 text-center">Delete</th>
                    <th className="py-3 px-4 text-center">Export Data</th>
                    <th className="py-3 px-4 text-center">Admin Controls</th>
                    <th className="py-3 px-4 text-right">Quick Toggle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 font-mono">
                  {editedModules.map(mod => {
                    const allChecked = mod.permissions.read && mod.permissions.write && mod.permissions.delete && mod.permissions.export && mod.permissions.admin;
                    return (
                      <tr key={mod.moduleKey} className="hover:bg-zinc-900/40 transition">
                        <td className="py-3.5 px-4 font-sans font-semibold text-zinc-200 text-sm">
                          {mod.moduleName}
                        </td>

                        {/* Read */}
                        <td className="py-3.5 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={mod.permissions.read}
                            onChange={() => handleTogglePermission(mod.moduleKey, 'read')}
                            className="w-4 h-4 rounded accent-zinc-200 cursor-pointer"
                          />
                        </td>

                        {/* Write */}
                        <td className="py-3.5 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={mod.permissions.write}
                            onChange={() => handleTogglePermission(mod.moduleKey, 'write')}
                            className="w-4 h-4 rounded accent-zinc-200 cursor-pointer"
                          />
                        </td>

                        {/* Delete */}
                        <td className="py-3.5 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={mod.permissions.delete}
                            onChange={() => handleTogglePermission(mod.moduleKey, 'delete')}
                            className="w-4 h-4 rounded accent-zinc-200 cursor-pointer"
                          />
                        </td>

                        {/* Export */}
                        <td className="py-3.5 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={mod.permissions.export}
                            onChange={() => handleTogglePermission(mod.moduleKey, 'export')}
                            className="w-4 h-4 rounded accent-zinc-200 cursor-pointer"
                          />
                        </td>

                        {/* Admin */}
                        <td className="py-3.5 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={mod.permissions.admin}
                            onChange={() => handleTogglePermission(mod.moduleKey, 'admin')}
                            className="w-4 h-4 rounded accent-zinc-200 cursor-pointer"
                          />
                        </td>

                        {/* Quick toggle row */}
                        <td className="py-3.5 px-4 text-right font-sans">
                          <button
                            type="button"
                            onClick={() => handleToggleRow(mod.moduleKey, !allChecked)}
                            className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-100 transition"
                          >
                            {allChecked ? 'Uncheck All' : 'Grant All'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Create Custom Role Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-zinc-300" />
                Create Custom Role
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNewRoleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-zinc-400 mb-1">Role Title</label>
                <input
                  type="text"
                  required
                  value={newRoleName}
                  onChange={e => setNewRoleName(e.target.value)}
                  placeholder="e.g. Lead Operations Auditor"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div>
                <label className="block font-medium text-zinc-400 mb-1">Role Scope Description</label>
                <textarea
                  rows={2}
                  value={newRoleDescription}
                  onChange={e => setNewRoleDescription(e.target.value)}
                  placeholder="Describe the operational responsibilities of this role..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 resize-none"
                />
              </div>

              <div>
                <label className="block font-medium text-zinc-400 mb-1">Clone Base Permissions From</label>
                <select
                  value={cloneFromRoleId}
                  onChange={e => setCloneFromRoleId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                >
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition"
                >
                  Create & Configure
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
