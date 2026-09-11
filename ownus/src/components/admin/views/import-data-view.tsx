'use client';

import React, { useState } from 'react';
import { 
  UploadCloud, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  ArrowLeft, 
  Check, 
  Download, 
  Sparkles,
  RefreshCw,
  Eye,
  Settings,
  HelpCircle,
  FileCheck
} from 'lucide-react';
import { ORION_SUPPORTED_FIELDS } from '@/lib/admin-mock-data';
import { cn } from '@/lib/utils';

interface ImportDataViewProps {
  onImportComplete: (batchSummary: any) => void;
}

const MOCK_PREVIEW_ROWS = [
  { 'Entity Name': 'Kaveri Precision Tools LLP', 'Sector': 'Manufacturing', 'Location': 'Bengaluru', 'Contact Mobile': '9845012345', 'State': 'Karnataka', 'Postal Code': '560058', 'Web URL': 'https://kaveriprecision.in', 'Mail ID': 'sales@kaveriprecision.in' },
  { 'Entity Name': 'Zenith Biotech & Diagnostics', 'Sector': 'Healthcare', 'Location': 'Hyderabad', 'Contact Mobile': '9123456789', 'State': 'Telangana', 'Postal Code': '500032', 'Web URL': '', 'Mail ID': 'zenithbio@gmail.com' },
  { 'Entity Name': 'Gujarat Organic Fertilizers', 'Sector': 'Agro', 'Location': 'Ahmedabad', 'Contact Mobile': '7925831122', 'State': 'Gujarat', 'Postal Code': '382445', 'Web URL': 'https://gujaratorganic.co', 'Mail ID': 'info@gujaratorganic.co' },
  { 'Entity Name': 'Metro Cargo Freight Solutions', 'Sector': 'Logistics', 'Location': 'Mumbai', 'Contact Mobile': '9820098200', 'State': 'Maharashtra', 'Postal Code': '400703', 'Web URL': 'https://metrocargo.in', 'Mail ID': 'ops@metrocargo.in' },
  { 'Entity Name': 'Sunrise Solar Systems Pvt Ltd', 'Sector': 'Renewables', 'Location': 'Jaipur', 'Contact Mobile': '9414012345', 'State': 'Rajasthan', 'Postal Code': '302001', 'Web URL': 'https://sunrisesolar.com', 'Mail ID': 'contact@sunrisesolar.com' },
];

export function ImportDataView({ onImportComplete }: ImportDataViewProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: string; rows: number } | null>(null);
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({
    'Entity Name': 'name',
    'Sector': 'industry',
    'Location': 'city',
    'Contact Mobile': 'phone',
    'State': 'state',
    'Postal Code': 'pincode',
    'Web URL': 'website',
    'Mail ID': 'email'
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile({
        name: file.name,
        size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
        rows: 14200
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile({
        name: file.name,
        size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
        rows: 14200
      });
    }
  };

  const handleStartIngestion = () => {
    setStep(4);
    setIsProcessing(true);
    setProgress(15);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsProcessing(false);
          return 100;
        }
        return prev + 20;
      });
    }, 400);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12 text-zinc-900 dark:text-zinc-100 text-xs">
      
      {/* Wizard Step Progress Tracker */}
      <div className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
        <div className="flex items-center justify-between">
          {[
            { num: 1, title: 'Upload Source' },
            { num: 2, title: 'Preview & Map Fields' },
            { num: 3, title: 'Validation Rules' },
            { num: 4, title: 'Ingestion & Results' },
          ].map((s, idx) => (
            <React.Fragment key={s.num}>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition-colors',
                    step === s.num
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 ring-2 ring-zinc-400'
                      : step > s.num
                      ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                  )}
                >
                  {step > s.num ? <Check className="w-3.5 h-3.5" /> : s.num}
                </div>
                <span className={cn('font-semibold hidden sm:inline', step === s.num ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400')}>
                  {s.title}
                </span>
              </div>
              {idx < 3 && <div className="flex-1 h-px bg-zinc-200 dark:border-zinc-800 mx-3 hidden sm:block" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* STEP 1: UPLOAD AREA */}
      {step === 1 && (
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 shadow-xs space-y-6 text-center">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Upload Data Ingestion Batch</h2>
            <p className="text-zinc-500 mt-1">Upload verified business registrations, GST listings or commercial records in CSV or XLSX format.</p>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 dark:hover:border-zinc-500 rounded-2xl p-12 transition-all cursor-pointer bg-zinc-50/50 dark:bg-zinc-900/20"
          >
            <div className="flex flex-col items-center justify-center space-y-3 max-w-sm mx-auto">
              <div className="p-4 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
                <UploadCloud className="w-8 h-8" />
              </div>
              <div>
                <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Drag & Drop files here, or browse</p>
                <p className="text-zinc-400 text-xs mt-0.5">Supports CSV, XLSX up to 500MB (100,000+ rows per batch)</p>
              </div>

              <input
                type="file"
                accept=".csv, .xlsx, .xls"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="px-4 py-2 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold hover:opacity-90 transition-opacity cursor-pointer inline-block"
              >
                Browse Local Files
              </label>
            </div>
          </div>

          {/* Preset Demo File Picker for Fast Testing */}
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-left flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-6 h-6 text-zinc-500 shrink-0" />
              <div>
                <p className="font-bold text-zinc-900 dark:text-zinc-100">Sample_MSME_Registrations_Sep2024.xlsx</p>
                <p className="text-[11px] text-zinc-500">14,200 commercial entities • Pre-formatted columns</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href="/api/v1/admin/template/csv"
                download="orion_business_import_template.csv"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer text-xs text-zinc-900 dark:text-zinc-100"
              >
                <Download className="w-3.5 h-3.5 text-zinc-500" />
                <span>Download CSV Template</span>
              </a>
              <button
                onClick={() => {
                  setSelectedFile({
                    name: 'Sample_MSME_Registrations_Sep2024.xlsx',
                    size: '4.8 MB',
                    rows: 14200
                  });
                  setStep(2);
                }}
                className="px-4 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold hover:opacity-90 transition-opacity cursor-pointer shrink-0"
              >
                Use Demo File
              </button>
            </div>
          </div>

          {selectedFile && (
            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="px-5 py-2 rounded-lg font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <span>Continue to Field Mapping</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: FIELD MAPPING & PREVIEW */}
      {step === 2 && (
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Column Mapping & Schema Matching</h2>
              <p className="text-zinc-500 mt-0.5">Map source file headers to standard Orion fields. 8 columns auto-detected.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-[11px] font-semibold">
                {selectedFile?.name} ({selectedFile?.rows.toLocaleString()} rows)
              </span>
            </div>
          </div>

          {/* Mapping Grid */}
          <div className="space-y-3">
            <h3 className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-zinc-900 dark:text-white" />
              <span>Header Mapping Table</span>
            </h3>

            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-200 dark:divide-zinc-800">
              <div className="grid grid-cols-3 p-3 bg-zinc-50 dark:bg-zinc-900 text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                <span>Uploaded Source Header</span>
                <span className="text-center">Target Orion Field</span>
                <span className="text-right">Requirement Status</span>
              </div>

              {Object.entries(fieldMappings).map(([sourceHeader, mappedKey]) => (
                <div key={sourceHeader} className="grid grid-cols-3 p-3 items-center hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                  <div className="font-bold font-mono text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-zinc-400" />
                    <span>{sourceHeader}</span>
                  </div>

                  <div className="flex justify-center">
                    <select
                      value={mappedKey}
                      onChange={(e) => setFieldMappings({ ...fieldMappings, [sourceHeader]: e.target.value })}
                      className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 font-medium text-zinc-900 dark:text-zinc-100 cursor-pointer text-xs w-56"
                    >
                      <option value="">— Do Not Map (Ignore) —</option>
                      {ORION_SUPPORTED_FIELDS.map(f => (
                        <option key={f.key} value={f.key}>
                          {f.label} {f.required ? '*' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="text-right">
                    {ORION_SUPPORTED_FIELDS.find(f => f.key === mappedKey)?.required ? (
                      <span className="px-2 py-0.5 rounded bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-bold text-[10px]">
                        REQUIRED FIELD
                      </span>
                    ) : (
                      <span className="text-zinc-400 text-[11px]">Optional</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Raw Preview First 5 Rows */}
          <div className="space-y-2">
            <h3 className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-zinc-400" />
              <span>Raw Preview (First 5 of 14,200 Rows)</span>
            </h3>
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 font-bold text-zinc-500 uppercase">
                  <tr>
                    {Object.keys(MOCK_PREVIEW_ROWS[0]).map(k => (
                      <th key={k} className="p-2.5 whitespace-nowrap">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {MOCK_PREVIEW_ROWS.map((row, i) => (
                    <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40 font-mono">
                      {Object.values(row).map((val, idx) => (
                        <td key={idx} className="p-2.5 whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                          {val || <span className="text-zinc-400 italic font-sans">NULL</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="flex justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Upload</span>
            </button>
            <button
              onClick={() => setStep(3)}
              className="px-5 py-2 rounded-lg font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <span>Confirm Mapping & Rules</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: VALIDATION RULES & INGESTION SETTINGS */}
      {step === 3 && (
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-xs space-y-6">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Ingestion Validation & Deduplication Rules</h2>
            <p className="text-zinc-500 mt-0.5">Configure schema constraints and automated duplicate handling.</p>
          </div>

          <div className="space-y-3">
            {[
              { title: 'Reject rows with missing Business Name', desc: 'Ensures no entity enters platform without registered name', defaultChecked: true },
              { title: 'Validate Indian Mobile & Landline format (10 digits / STD)', desc: 'Rejects invalid or test strings in phone column', defaultChecked: true },
              { title: 'Pincode State & District Alignment Check', desc: 'Validates 6-digit postal code against India Post master registry', defaultChecked: true },
              { title: 'Live MX Server & Email Syntax Validator', desc: 'Flags non-deliverable mailbox domains', defaultChecked: true },
              { title: 'Automated Deduplication against 1.2M+ Master Database', desc: 'Flags matching Phone, Email, Domain or >90% Name similarity as Duplicates for manual review', defaultChecked: true },
              { title: 'Initial Status Assignment', desc: 'Set initial record state to "Draft" for review before publishing', defaultChecked: true },
            ].map((rule, idx) => (
              <label key={idx} className="flex items-start gap-3 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer">
                <input type="checkbox" defaultChecked={rule.defaultChecked} className="rounded border-zinc-300 dark:border-zinc-700 w-4 h-4 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold text-zinc-900 dark:text-zinc-100 block">{rule.title}</span>
                  <span className="text-[11px] text-zinc-500 block">{rule.desc}</span>
                </div>
              </label>
            ))}
          </div>

          <div className="flex justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Mapping</span>
            </button>
            <button
              onClick={handleStartIngestion}
              className="px-6 py-2.5 rounded-lg font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              <FileCheck className="w-4 h-4" />
              <span>Execute Ingestion Job (14,200 Rows)</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: LIVE INGESTION PROGRESS & RESULTS */}
      {step === 4 && (
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 shadow-xs space-y-6 text-center">
          {isProcessing ? (
            <div className="space-y-6 max-w-md mx-auto py-8">
              <RefreshCw className="w-10 h-10 text-zinc-900 dark:text-white animate-spin mx-auto" />
              <div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Ingesting & Validating 14,200 Records</h3>
                <p className="text-zinc-500 text-xs mt-1">Checking pincode validity, phone verification, and duplicates...</p>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-3 rounded-full overflow-hidden border border-zinc-200 dark:border-zinc-700">
                  <div className="bg-zinc-900 dark:bg-white h-3 transition-all duration-300 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between font-mono text-zinc-500 text-[11px]">
                  <span>Processed: {Math.round((progress / 100) * 14200)} / 14,200</span>
                  <span>{progress}%</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in-50">
              <div className="p-4 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 w-16 h-16 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Batch Ingestion Completed Successfully!</h3>
                <p className="text-zinc-500 text-xs mt-1">Batch ID: <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">IMP-9844</span></p>
              </div>

              {/* Ingestion KPI Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
                <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Total Read</span>
                  <span className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">14,200</span>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Valid Ingested</span>
                  <span className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">13,850</span>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Duplicates Flagged</span>
                  <span className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">230</span>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Failed / Errors</span>
                  <span className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">120</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                <button
                  onClick={() => {
                    setStep(1);
                    setSelectedFile(null);
                  }}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Import Another File
                </button>
                <button
                  onClick={() => onImportComplete({ batchId: 'IMP-9844', count: 13850 })}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-lg font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                >
                  Review Ingested Records
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
