export interface ICreditPackage {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  priceInr: number | null;
  priceAnnualInr?: number | null;
  credits: number;
  userLimit?: number | null;
  billingType: string;
  popular?: boolean;
  features: string[];
  badgeText?: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface IPricingConfig {
  dailyFreeCredits: number;
  annualDiscountPercentage: number;
  defaultCurrency: string;
  currencySymbol: string;
}
