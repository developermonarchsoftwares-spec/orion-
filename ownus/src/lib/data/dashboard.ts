import type { DashboardStats, ChartDataPoint, Activity } from '@/lib/types';

/**
 * Baseline dashboard data models for Orion.
 * In production, statistics and unlock activities are fetched dynamically from the NestJS backend.
 */
export const dashboardStats: DashboardStats = {
  newBusinessesToday: 0,
  newBusinessesTrend: 0,
  highOpportunityLeads: 0,
  highOpportunityTrend: 0,
  businessesWithoutWebsite: 0,
  businessesWithoutWebsiteTrend: 0,
  creditsRemaining: 0,
  creditsTrend: 0,
  businessesThisWeek: 0,
  totalUnlocked: 0,
};

export const businessTrendData: ChartDataPoint[] = [];
export const industryDistribution: ChartDataPoint[] = [];
export const recentActivity: Activity[] = [];

export const quickActions = [
  { title: 'Discover Businesses', description: 'Find new leads in your target market', href: '/discover', icon: 'Search' },
  { title: 'Manage Leads', description: 'Track and nurture your pipeline', href: '/leads', icon: 'Users' },
  { title: 'Buy Credits', description: 'Top up your unlock credits', href: '/credits', icon: 'CreditCard' },
  { title: 'Saved Searches', description: 'Run and manage saved queries', href: '/saved-searches', icon: 'BookmarkCheck' },
];
