import { Business } from '@/lib/types';

export const industries = [
  'Manufacturing & Industrial',
  'Wholesale & Distribution',
  'Machinery & Equipment',
  'Packaging & Materials',
  'Logistics & Warehousing',
  'Construction & Real Estate',
  'Architecture & Interiors',
  'Chartered Accountancy & Tax',
  'Consulting & Advisory',
  'HR & Staffing Services',
  'Banking & Financial Services',
  'Insurance Services',
  'Software & IT Services',
  'Marketing & Advertising',
  'Healthcare & Pharmaceuticals',
  'Education & Training',
  'Printing & Publishing',
  'Textiles & Garments',
  'Chemicals & Polymers',
  'Automobile & Components',
  'Food Processing & Agro',
  'Hospitality & Catering',
  'Export & Import Trading',
  'Retail & Supermarkets',
];

export const subIndustriesMap: Record<string, string[]> = {
  'Manufacturing & Industrial': ['CNC Machining', 'Fabrication', 'Plastics Molding', 'Sheet Metal', 'Foundry & Casting'],
  'Wholesale & Distribution': ['FMCG Wholesale', 'Industrial Supplies', 'Building Materials', 'Electrical Goods'],
  'Logistics & Warehousing': ['Freight Forwarding', 'Cold Storage', '3PL Logistics', 'Fleet Operations'],
  'Construction & Real Estate': ['Civil Contracting', 'Commercial Builders', 'RMC Ready Mix', 'Electrical Contracting'],
  'Chartered Accountancy & Tax': ['Auditing & Assurance', 'GST Filing', 'Corporate Tax Advisory', 'Bookkeeping'],
  'Software & IT Services': ['Enterprise ERP', 'Cloud Solutions', 'Cybersecurity', 'IT Support & Hardware'],
  'Textiles & Garments': ['Yarn Manufacturing', 'Garment Export', 'Dyeing & Printing', 'Fabrics Wholesale'],
  'Food Processing & Agro': ['Spices & Condiments', 'Dairy Products', 'Grains & Pulses Milling', 'Frozen Foods'],
};

export const businessCategories = [
  'B2B Product Manufacturer',
  'Authorized Distributor / Wholesaler',
  'Service Provider / Agency',
  'Retailer / Commercial Dealer',
  'Import / Export Merchant',
  'Contractor / Infrastructure Firm',
];

// In production, real business data is served dynamically from PostgreSQL via NestJS API.
export const businesses: Business[] = [];
