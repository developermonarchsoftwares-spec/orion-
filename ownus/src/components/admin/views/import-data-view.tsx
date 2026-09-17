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
  FileCheck,
  AlertTriangle,
  XCircle,
  Database
} from 'lucide-react';
import { ORION_SUPPORTED_FIELDS } from '@/lib/admin-mock-data';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface ImportDataViewProps {
  onImportComplete: (batchSummary: any) => void;
}

const REAL_SAMPLE_BUSINESSES: Array<Record<string, unknown>> = [
  {
    business_name: 'Tata Consultancy Services',
    legal_name: 'Tata Consultancy Services Limited',
    gstin: '27AAACT2727Q1ZW',
    cin: 'L22210MH1995PLC084781',
    pan: 'AAACT2727Q',
    address_line1: '9th Floor Nirmal Building Nariman Point',
    city: 'Mumbai',
    district: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400021',
    phone: '+912267789999',
    email: 'corporate.office@tcs.com',
    website: 'https://www.tcs.com',
    contact_person: 'K. Krithivasan',
    contact_title: 'CEO & Managing Director',
    business_type: 'PUBLIC_LIMITED',
    industry: 'Information Technology',
    category: 'IT Services & Consulting',
    description: 'Global leader in IT services, digital and business solutions.',
    founding_year: 1968,
  },
  {
    business_name: 'Infosys Limited',
    legal_name: 'Infosys Limited',
    gstin: '29AAACI4397H1Z5',
    cin: 'L85110KA1981PLC013115',
    pan: 'AAACI4397H',
    address_line1: 'Plot No 44 Electronics City Hosur Road',
    city: 'Bangalore',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    pincode: '560100',
    phone: '+918028520261',
    email: 'investors@infosys.com',
    website: 'https://www.infosys.com',
    contact_person: 'Salil Parekh',
    contact_title: 'CEO & Managing Director',
    business_type: 'PUBLIC_LIMITED',
    industry: 'Information Technology',
    category: 'Enterprise Software & AI',
    description: 'Next-generation digital services and consulting.',
    founding_year: 1981,
  },
  {
    business_name: 'Wipro Limited',
    legal_name: 'Wipro Limited',
    gstin: '29AAACW0387R1Z9',
    cin: 'L32102KA1945PLC020800',
    pan: 'AAACW0387R',
    address_line1: 'Doddakannelli Sarjapur Road',
    city: 'Bangalore',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    pincode: '560035',
    phone: '+918028440011',
    email: 'info@wipro.com',
    website: 'https://www.wipro.com',
    contact_person: 'Srini Pallia',
    contact_title: 'CEO & Managing Director',
    business_type: 'PUBLIC_LIMITED',
    industry: 'Information Technology',
    category: 'Cloud & Business Transformation',
    description: 'Leading global information technology, consulting and business process services company.',
    founding_year: 1945,
  },
  {
    business_name: 'HCL Technologies',
    legal_name: 'HCL Technologies Limited',
    gstin: '07AAACH2702H1Z6',
    cin: 'L74140DL1991PLC046369',
    pan: 'AAACH2702H',
    address_line1: '806 Siddharth 96 Nehru Place',
    city: 'New Delhi',
    district: 'South East Delhi',
    state: 'Delhi',
    pincode: '110019',
    phone: '+911204013000',
    email: 'investors@hcl.com',
    website: 'https://www.hcltech.com',
    contact_person: 'C Vijayakumar',
    contact_title: 'CEO & Managing Director',
    business_type: 'PUBLIC_LIMITED',
    industry: 'Information Technology',
    category: 'Digital Foundation & Engineering',
    description: 'Global technology company helping enterprises reimagine their businesses.',
    founding_year: 1991,
  },
  {
    business_name: 'Tech Mahindra',
    legal_name: 'Tech Mahindra Limited',
    gstin: '27AAACT1282G1ZV',
    cin: 'L64200MH1986PLC041370',
    pan: 'AAACT1282G',
    address_line1: 'Gateway Building Apollo Bunder',
    city: 'Mumbai',
    district: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    phone: '+912066018100',
    email: 'investor.relations@techmahindra.com',
    website: 'https://www.techmahindra.com',
    contact_person: 'Mohit Joshi',
    contact_title: 'CEO & Managing Director',
    business_type: 'PUBLIC_LIMITED',
    industry: 'Information Technology',
    category: 'Telecommunications & Enterprise IT',
    description: 'Offering innovative and customer-centric digital experiences.',
    founding_year: 1986,
  },
];

function parseCsvToObjects(csvText: string): Array<Record<string, unknown>> {
  const lines = csvText.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(cur.trim().replace(/^"|"$/g, '').trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    result.push(cur.trim().replace(/^"|"$/g, '').trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows: Array<Record<string, unknown>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;
    const rowObj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (h) {
        rowObj[h] = values[idx] ?? '';
      }
    });
    rows.push(rowObj);
  }

  return rows;
}

export function ImportDataView({ onImportComplete }: ImportDataViewProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: string; rows: number } | null>(null);
  const [parsedRows, setParsedRows] = useState<Array<Record<string, unknown>>>([]);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({});
  
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [finalResult, setFinalResult] = useState<any | null>(null);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processIncomingFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processIncomingFile(e.target.files[0]);
    }
  };

  const processIncomingFile = (file: File) => {
    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) {
        setErrorMessage('File appears empty or unreadable.');
        return;
      }
      const rows = parseCsvToObjects(text);
      if (rows.length === 0) {
        setErrorMessage('Could not parse any records from this file. Ensure it is a valid CSV.');
        return;
      }
      setSelectedFile({
        name: file.name,
        size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
        rows: rows.length,
      });
      setParsedRows(rows);
      initMappingsFromRows(rows);
    };
    reader.onerror = () => setErrorMessage('Error reading uploaded file.');
    reader.readAsText(file);
  };

  const loadRealSampleFile = () => {
    setErrorMessage(null);
    setSelectedFile({
      name: 'canonical_indian_enterprises_sample.csv',
      size: '12.4 KB',
      rows: REAL_SAMPLE_BUSINESSES.length,
    });
    setParsedRows(REAL_SAMPLE_BUSINESSES);
    initMappingsFromRows(REAL_SAMPLE_BUSINESSES);
  };

  const initMappingsFromRows = (rows: Array<Record<string, unknown>>) => {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const mappings: Record<string, string> = {};
    headers.forEach((h) => {
      const clean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (clean.includes('business') || clean.includes('company') || clean === 'name' || clean.includes('entity')) {
        mappings[h] = 'business_name';
      } else if (clean.includes('gst') || clean.includes('gstin')) {
        mappings[h] = 'gstin';
      } else if (clean.includes('cin')) {
        mappings[h] = 'cin';
      } else if (clean.includes('pan')) {
        mappings[h] = 'pan';
      } else if (clean.includes('phone') || clean.includes('mobile')) {
        mappings[h] = 'phone';
      } else if (clean.includes('email') || clean.includes('mail')) {
        mappings[h] = 'email';
      } else if (clean.includes('state')) {
        mappings[h] = 'state';
      } else if (clean.includes('city') || clean.includes('location')) {
        mappings[h] = 'city';
      } else if (clean.includes('pin') || clean.includes('postal')) {
        mappings[h] = 'pincode';
      } else if (clean.includes('web') || clean.includes('site') || clean.includes('url')) {
        mappings[h] = 'website';
      } else if (clean.includes('industry') || clean.includes('sector')) {
        mappings[h] = 'industry';
      } else {
        mappings[h] = h;
      }
    });
    setFieldMappings(mappings);
  };

  const handleProceedToPreview = async () => {
    if (parsedRows.length === 0) {
      setErrorMessage('Please select or upload a dataset first.');
      return;
    }
    setErrorMessage(null);
    setIsLoadingPreview(true);
    try {
      const response = await apiClient.request('/admin/import/preview', {
        method: 'POST',
        body: JSON.stringify({
          rows: parsedRows,
          customMapping: fieldMappings,
        }),
      });

      const data = response?.data || response;
      setPreviewData(data);
      setStep(2);
    } catch (err: any) {
      setErrorMessage(err.message || 'Validation preview failed. Please check network or file format.');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleStartIngestion = async () => {
    setStep(4);
    setIsProcessing(true);
    setProgress(20);
    setErrorMessage(null);

    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 85 ? 85 : prev + 15));
    }, 500);

    try {
      const response = await apiClient.request('/admin/import/submit', {
        method: 'POST',
        body: JSON.stringify({
          batchName: selectedFile?.name || 'Production_Ingestion_Batch.csv',
          rows: parsedRows,
          customMapping: fieldMappings,
          autoPublish: true,
        }),
      });

      clearInterval(progressInterval);
      setProgress(100);
      setIsProcessing(false);

      const data = response?.data || response;
      setFinalResult(data);
    } catch (err: any) {
      clearInterval(progressInterval);
      setIsProcessing(false);
      setErrorMessage(err.message || 'Batch ingestion execution failed.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12 text-zinc-900 dark:text-zinc-100 text-xs font-sans">
      
      {/* Wizard Step Progress Tracker */}
      <div className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
        <div className="flex items-center justify-between">
          {[
            { num: 1, title: 'Upload Source' },
            { num: 2, title: 'Validation Preview & Mapping' },
            { num: 3, title: 'Deduplication & Rules' },
            { num: 4, title: 'PostgreSQL Ingestion' },
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

      {errorMessage && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* STEP 1: UPLOAD AREA */}
      {step === 1 && (
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 shadow-xs space-y-6 text-center">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Upload Indian Business Ingestion Batch</h2>
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
                <p className="text-zinc-400 text-xs mt-0.5">Supports CSV with standard Indian columns (GSTIN, PAN, CIN, State, Pincode)</p>
              </div>

              <input
                type="file"
                accept=".csv, text/csv"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="px-4 py-2 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold hover:opacity-90 transition-opacity cursor-pointer inline-block"
              >
                Browse Local CSV File
              </label>
            </div>
          </div>

          {/* Canonical Sample File Picker & Official Template Download */}
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-left flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-6 h-6 text-zinc-500 shrink-0" />
              <div>
                <p className="font-bold text-zinc-900 dark:text-zinc-100">canonical_indian_enterprises_sample.csv</p>
                <p className="text-[11px] text-zinc-500">Verified sample (TCS, Infosys, Wipro, HCL, Tech Mahindra) • Canonical schema</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href="/api/v1/admin/import/template"
                download="orion_business_import_template.csv"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer text-xs text-zinc-900 dark:text-zinc-100"
              >
                <Download className="w-3.5 h-3.5 text-zinc-500" />
                <span>Download Canonical Template</span>
              </a>
              <button
                onClick={loadRealSampleFile}
                className="px-4 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold hover:opacity-90 transition-opacity cursor-pointer shrink-0"
              >
                Use Real Sample File
              </button>
            </div>
          </div>

          {selectedFile && (
            <div className="flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/50">
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                Selected: <strong>{selectedFile.name}</strong> ({selectedFile.rows} records detected)
              </span>
              <button
                onClick={handleProceedToPreview}
                disabled={isLoadingPreview}
                className="px-5 py-2 rounded-lg font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isLoadingPreview ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Validating Pre-Commit...</span>
                  </>
                ) : (
                  <>
                    <span>Continue to Pre-Commit Validation</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: FIELD MAPPING & PREVIEW */}
      {step === 2 && previewData && (
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Pre-Commit Validation & Duplicate Analysis</h2>
              <p className="text-zinc-500 mt-0.5">Scanned against PostgreSQL master database & statutory Indian syntax rules.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-[11px] font-semibold">
                {selectedFile?.name} ({previewData.total} records)
              </span>
            </div>
          </div>

          {/* Validation Metrics KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
              <span className="text-[10px] uppercase font-bold text-zinc-400 block">Total Evaluated</span>
              <span className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">{previewData.total}</span>
            </div>
            <div className="p-3.5 rounded-xl border border-green-200 dark:border-green-900/50 bg-green-50/50 dark:bg-green-950/20">
              <span className="text-[10px] uppercase font-bold text-green-600 dark:text-green-400 block">Clean & Valid</span>
              <span className="text-xl font-bold font-mono text-green-700 dark:text-green-300">{previewData.validCount}</span>
            </div>
            <div className="p-3.5 rounded-xl border border-purple-200 dark:border-purple-900/50 bg-purple-50/50 dark:bg-purple-950/20">
              <span className="text-[10px] uppercase font-bold text-purple-600 dark:text-purple-400 block">Duplicates Detected</span>
              <span className="text-xl font-bold font-mono text-purple-700 dark:text-purple-300">{previewData.duplicateCount}</span>
            </div>
            <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20">
              <span className="text-[10px] uppercase font-bold text-red-600 dark:text-red-400 block">Invalid (Rejected)</span>
              <span className="text-xl font-bold font-mono text-red-700 dark:text-red-300">{previewData.invalidCount}</span>
            </div>
          </div>

          {/* Raw Preview Table */}
          {(() => {
            const recordsList = previewData.previewRecords || previewData.records || [];
            return (
              <div className="space-y-2">
                <h3 className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Eye className="w-4 h-4 text-zinc-400" />
                  <span>Evaluated Rows Preview (Showing first {Math.min(recordsList.length, 10)})</span>
                </h3>
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 font-bold text-zinc-500 uppercase">
                      <tr>
                        <th className="p-2.5">Row</th>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5">Business Name</th>
                        <th className="p-2.5">GSTIN</th>
                        <th className="p-2.5">Location</th>
                        <th className="p-2.5">Phone</th>
                        <th className="p-2.5">Validation Issues / Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {recordsList.slice(0, 10).map((rec: any) => (
                        <tr key={rec.rowNumber} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                          <td className="p-2.5 font-mono text-zinc-500">#{rec.rowNumber}</td>
                      <td className="p-2.5">
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded font-bold text-[10px]',
                            rec.status === 'VALID' && 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
                            rec.status === 'WARNING' && 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
                            rec.status === 'DUPLICATE' && 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
                            rec.status === 'INVALID' && 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                          )}
                        >
                          {rec.status}
                        </span>
                      </td>
                      <td className="p-2.5 font-semibold text-zinc-900 dark:text-zinc-100">{rec.businessName}</td>
                      <td className="p-2.5 font-mono text-zinc-700 dark:text-zinc-300">{rec.gstin || '—'}</td>
                      <td className="p-2.5 text-zinc-700 dark:text-zinc-300">{rec.city}, {rec.state}</td>
                      <td className="p-2.5 font-mono text-zinc-700 dark:text-zinc-300">{rec.phone || '—'}</td>
                      <td className="p-2.5 text-zinc-500 text-[10px]">
                        {rec.issues && rec.issues.length > 0 ? (
                          rec.issues.join('; ')
                        ) : (
                          <span className="text-green-600 dark:text-green-400">Passes statutory checks</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          );
          })()}

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
              <span>Confirm Ingestion Pipeline Rules</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: VALIDATION RULES & INGESTION SETTINGS */}
      {step === 3 && (
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-xs space-y-6">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Ingestion Constraints & Publishing Strategy</h2>
            <p className="text-zinc-500 mt-0.5">Records will be validated in 3NF PostgreSQL schema with instant customer searchability.</p>
          </div>

          <div className="space-y-3">
            {[
              { title: 'Statutory GSTIN & CIN Normalization', desc: 'Converts to clean alphanumeric uppercase; strips whitespace and punctuation', defaultChecked: true },
              { title: 'PostgreSQL Duplicate Protection', desc: 'Identifies exact GSTIN, CIN, and Name + City matches; skips duplicates automatically', defaultChecked: true },
              { title: 'Auto-Publish Valid Records (status = PUBLISHED)', desc: 'Makes valid businesses immediately searchable in PostgreSQL discovery and unlocks', defaultChecked: true },
              { title: 'Lead Masking on Discovery', desc: 'Hides phone numbers and corporate emails until revealed via customer 1-credit unlock', defaultChecked: true },
            ].map((rule, idx) => (
              <label key={idx} className="flex items-start gap-3 p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 transition-colors">
                <input type="checkbox" defaultChecked={rule.defaultChecked} disabled className="rounded border-zinc-300 dark:border-zinc-700 w-4 h-4 mt-0.5" />
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
              <span>Back to Preview</span>
            </button>
            <button
              onClick={handleStartIngestion}
              className="px-6 py-2.5 rounded-lg font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              <FileCheck className="w-4 h-4" />
              <span>Execute Ingestion Job ({previewData?.validCount ?? parsedRows.length} Valid Records)</span>
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
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Ingesting & Publishing Business Entities</h3>
                <p className="text-zinc-500 text-xs mt-1">Persisting 3NF relations into PostgreSQL and indexing for discovery...</p>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-3 rounded-full overflow-hidden border border-zinc-200 dark:border-zinc-700">
                  <div className="bg-zinc-900 dark:bg-white h-3 transition-all duration-300 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between font-mono text-zinc-500 text-[11px]">
                  <span>Processing...</span>
                  <span>{progress}%</span>
                </div>
              </div>
            </div>
          ) : finalResult ? (
            <div className="space-y-6 animate-in fade-in-50">
              <div className="p-4 rounded-full bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 w-16 h-16 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Batch Ingestion Completed Successfully!</h3>
                <p className="text-zinc-500 text-xs mt-1">
                  Batch ID: <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">{finalResult.batch?.id}</span>
                </p>
              </div>

              {/* Ingestion KPI Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
                <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Total Read</span>
                  <span className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">{finalResult.stats?.total ?? 0}</span>
                </div>
                <div className="p-3.5 rounded-xl border border-green-200 dark:border-green-900/50 bg-green-50/50 dark:bg-green-950/20">
                  <span className="text-[10px] uppercase font-bold text-green-600 dark:text-green-400 block">Published to PostgreSQL</span>
                  <span className="text-xl font-bold font-mono text-green-700 dark:text-green-300">{finalResult.stats?.published ?? 0}</span>
                </div>
                <div className="p-3.5 rounded-xl border border-purple-200 dark:border-purple-900/50 bg-purple-50/50 dark:bg-purple-950/20">
                  <span className="text-[10px] uppercase font-bold text-purple-600 dark:text-purple-400 block">Duplicates Filtered</span>
                  <span className="text-xl font-bold font-mono text-purple-700 dark:text-purple-300">{finalResult.stats?.duplicates ?? 0}</span>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Invalid Rows</span>
                  <span className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">{finalResult.stats?.invalid ?? 0}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                <button
                  onClick={() => {
                    setStep(1);
                    setSelectedFile(null);
                    setParsedRows([]);
                    setPreviewData(null);
                    setFinalResult(null);
                  }}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Import Another File
                </button>
                <button
                  onClick={() => onImportComplete(finalResult)}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-lg font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                >
                  View Ingested Batch in Records
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

    </div>
  );
}
