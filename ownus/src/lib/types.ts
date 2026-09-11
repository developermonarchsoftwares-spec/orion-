// ============================================================
// Orion — TypeScript Type Definitions
// ============================================================

export interface Business {
  id: string;
  name: string;
  industry: string;
  subIndustry?: string;
  category?: string;
  city: string;
  district?: string;
  state: string;
  address?: string;
  zipCode?: string;
  pincode?: string;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  hasWhatsApp?: boolean;
  phoneStatus?: "available" | "not_available";
  emailStatus?: "available" | "not_available";
  websiteStatus?: "available" | "no_website" | "has_website";
  googleBusinessProfile?: boolean;
  socialMediaPresence?: boolean;
  verified?: boolean;
  completeProfile?: boolean;
  recentlyUpdated?: boolean;
  businessType?: "Proprietorship" | "Partnership" | "LLP" | "OPC" | "Private Limited" | "Public Limited";
  msmeCategory?: "Micro" | "Small" | "Medium";
  opportunityScore?: number;
  businessAge?: string;
  registrationDate?: string;
  source?: string;
  creditsRequired?: number;
  status?: "active" | "pending" | "inactive";
  description?: string;
  employeeCount?: string;
  revenue?: string;
  socialMedia?: SocialMedia;
  technologies?: string[];
  signals?: string[];
  registrationNumber?: string;
  entityType?: string;
  isUnlocked?: boolean;
  tags?: string[];
}

export interface SocialMedia {
  linkedin: string | null;
  facebook: string | null;
  twitter: string | null;
  instagram: string | null;
}

export interface Lead {
  id: string;
  businessId?: string;
  businessName?: string;
  name?: string;
  industry?: string;
  city?: string;
  state?: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  opportunityScore?: number;
  status: LeadStatus;
  unlockedAt?: string;
  notes?: string;
  tags?: string[];
  lastContactedAt?: string | null;
  nextFollowUp?: string | null;
}

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal"
  | "won"
  | "lost";

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  pricePerCredit?: number;
  popular?: boolean;
  features: string[];
}

export interface CreditTransaction {
  id: string;
  type: "purchase" | "unlock" | "refund" | "bonus";
  description: string;
  amount: number;
  balance?: number;
  date: string;
  businessName?: string;
}

export interface Invoice {
  id: string;
  number?: string;
  date: string;
  amount: number;
  status: "paid" | "pending" | "overdue";
  package?: string;
  paymentMethod?: string;
  downloadUrl?: string;
}

export interface DashboardStats {
  newBusinessesToday: number;
  newBusinessesTrend: number;
  highOpportunityLeads: number;
  highOpportunityTrend: number;
  businessesWithoutWebsite: number;
  businessesWithoutWebsiteTrend: number;
  creditsRemaining: number;
  creditsTrend: number;
  businessesThisWeek: number;
  totalUnlocked: number;
}

export interface ChartDataPoint {
  name: string;
  value?: number;
  businesses?: number;
  leads?: number;
  [key: string]: string | number | undefined;
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: SearchFilters | Record<string, unknown>;
  resultCount?: number;
  lastRun?: string;
  createdAt?: string;
  notificationsEnabled?: boolean;
  frequency?: "daily" | "weekly" | "monthly";
  alertEnabled?: boolean;
}

export interface SearchFilters {
  industries?: string[];
  states?: string[];
  cities?: string[];
  websiteStatus?: string[];
  phoneStatus?: string[];
  emailStatus?: string[];
  opportunityScoreMin?: number;
  opportunityScoreMax?: number;
  businessAgeMin?: string;
  businessAgeMax?: string;
  sources?: string[];
  dateRange?: { from: string; to: string } | null;
  [key: string]: string | string[] | boolean | number | Record<string, string> | null | undefined;
}

export interface User {
  id: string;
  name: string;
  email: string;
  company?: string;
  role?: string;
  avatar?: string | null;
  plan?: "starter" | "professional" | "enterprise";
  credits?: number;
  joinedAt?: string;
  preferences?: UserPreferences;
}

export interface UserPreferences {
  theme?: "light" | "dark" | "system";
  resultsPerPage?: number;
  defaultView?: "table" | "grid";
  timezone?: string;
  emailNotifications?: boolean;
  savedSearchAlerts?: boolean;
  creditLowAlert?: boolean;
  weeklyDigest?: boolean;
}

export interface ImportRecord {
  id: string;
  filename: string;
  uploadedAt?: string;
  uploadedBy?: string;
  status: "processing" | "completed" | "failed" | "partial";
  date?: string;
  recordCount?: number;
  recordsProcessed?: number;
  successCount?: number;
  failedCount?: number;
  duplicateCount?: number;
  recordsAdded?: number;
  error?: string;
}

export interface DuplicateGroup {
  id: string;
  original?: Business;
  duplicate?: Business;
  businesses?: Business[];
  similarity?: number;
  field?: string;
  status?: "pending" | "merged" | "dismissed";
  confidence?: number;
}

export interface AdminLog {
  id: string;
  action: string;
  user: string;
  details: string;
  timestamp: string;
  level?: "info" | "warning" | "error";
}

export interface SystemService {
  id?: string;
  name: string;
  status: "operational" | "degraded" | "down";
  uptime: string;
  lastChecked?: string;
  lastCheck?: string;
  responseTime?: number;
}

export interface Activity {
  id: string;
  type: "unlock" | "search" | "export" | "note" | "status_change" | "import" | "purchase";
  title?: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, string | number>;
}

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: number;
  children?: NavItem[];
}

export interface PricingPlan {
  name: string;
  description: string;
  price: number;
  period: string;
  features: string[];
  cta: string;
  popular: boolean;
  creditsIncluded: number;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessorKey?: keyof T;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  visible?: boolean;
  width?: number;
  minWidth?: number;
}

// Filter Option Types
export interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

export interface FilterGroup {
  id: string;
  label: string;
  type: "multi-select" | "range" | "date-range" | "toggle";
  options?: FilterOption[];
  min?: number;
  max?: number;
}

// Timeline Event
export interface TimelineEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  type: "registration" | "discovery" | "analysis" | "update" | "unlock";
  icon: string;
}

// Note
export interface Note {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: string;
}
