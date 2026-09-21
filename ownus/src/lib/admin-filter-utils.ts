import { AdminBusinessRecord, BusinessStatus } from '@/types/admin';
import { DiscoverFilterState } from '@/components/discover/discover-filters';

/**
 * Universal filter evaluator for AdminBusinessRecord that matches the customer page (Discover) criteria.
 */
export function filterAdminBusinessRecord(
  record: AdminBusinessRecord,
  filters: DiscoverFilterState,
  searchQuery: string = '',
  activeChips: string[] = [],
  adminStatus: string = 'all'
): boolean {
  // 1. Text Search Query
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    const matchName = record.name?.toLowerCase().includes(q);
    const matchPhone = record.phone?.toLowerCase().includes(q);
    const matchEmail = record.email?.toLowerCase().includes(q);
    const matchCity = record.city?.toLowerCase().includes(q);
    const matchDistrict = record.district?.toLowerCase().includes(q);
    const matchState = record.state?.toLowerCase().includes(q);
    const matchPincode = record.pincode?.includes(q);
    const matchId = record.id?.toLowerCase().includes(q);
    const matchIndustry = record.industry?.toLowerCase().includes(q);
    const matchSubIndustry = record.subIndustry?.toLowerCase().includes(q);
    const matchCategory = record.category?.toLowerCase().includes(q);
    const matchType = record.businessType?.toLowerCase().includes(q);

    if (
      !matchName &&
      !matchPhone &&
      !matchEmail &&
      !matchCity &&
      !matchDistrict &&
      !matchState &&
      !matchPincode &&
      !matchId &&
      !matchIndustry &&
      !matchSubIndustry &&
      !matchCategory &&
      !matchType
    ) {
      return false;
    }
  }

  // 2. Admin Specific Status
  if (adminStatus && adminStatus !== 'all' && record.status !== adminStatus) {
    return false;
  }

  // 3. Location (State, District, City, Pincode)
  if (filters.state) {
    const rState = (record.state || '').toLowerCase();
    const fState = filters.state.toLowerCase();
    if (rState !== fState && !rState.includes(fState)) {
      return false;
    }
  }

  if (filters.districts && filters.districts.length > 0) {
    const rDistrict = (record.district || '').toLowerCase();
    if (!rDistrict || !filters.districts.some(d => d.toLowerCase() === rDistrict)) {
      return false;
    }
  }

  if (filters.cities && filters.cities.length > 0) {
    const rCity = (record.city || '').toLowerCase();
    if (!rCity || !filters.cities.some(c => c.toLowerCase() === rCity)) {
      return false;
    }
  }

  if (filters.pincode) {
    if (!record.pincode || !record.pincode.includes(filters.pincode)) {
      return false;
    }
  }

  // 4. Business Information
  if (filters.businessNameQuery?.trim()) {
    const bq = filters.businessNameQuery.toLowerCase().trim();
    if (!record.name?.toLowerCase().includes(bq)) {
      return false;
    }
  }

  if (filters.industries && filters.industries.length > 0) {
    const rInd = (record.industry || '').toLowerCase();
    if (!filters.industries.some(i => i.toLowerCase() === rInd)) {
      return false;
    }
  }

  if (filters.subIndustries && filters.subIndustries.length > 0) {
    const rSub = (record.subIndustry || '').toLowerCase();
    if (!rSub || !filters.subIndustries.some(s => s.toLowerCase() === rSub)) {
      return false;
    }
  }

  if (filters.businessCategories && filters.businessCategories.length > 0) {
    const rCat = (record.category || '').toLowerCase();
    if (!rCat || !filters.businessCategories.some(c => c.toLowerCase() === rCat)) {
      return false;
    }
  }

  if (filters.businessTypes && filters.businessTypes.length > 0) {
    const rType = (record.businessType || '').toLowerCase();
    if (!rType || !filters.businessTypes.some(t => rType.includes(t.toLowerCase()))) {
      return false;
    }
  }

  if (filters.msmeCategories && filters.msmeCategories.length > 0) {
    const rMsme = (record.msmeCategory || '').toLowerCase();
    if (!rMsme || !filters.msmeCategories.some(m => rMsme.includes(m.split(' ')[0].toLowerCase()))) {
      return false;
    }
  }

  // 5. Business Age & Recency
  const dateStr = record.registrationDate || record.createdAt;
  const recordDate = dateStr ? new Date(dateStr).getTime() : null;
  const now = Date.now();

  if (filters.agePreset && filters.agePreset !== 'all' && recordDate) {
    const diffMs = now - recordDate;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (filters.agePreset === 'today' && diffDays > 1) return false;
    if (filters.agePreset === 'yesterday' && diffDays > 2) return false;
    if (filters.agePreset === '7d' && diffDays > 7) return false;
    if (filters.agePreset === '30d' && diffDays > 30) return false;
    if (filters.agePreset === '90d' && diffDays > 90) return false;
    if (filters.agePreset === 'custom') {
      if (filters.customDateStart) {
        const start = new Date(filters.customDateStart).getTime();
        if (recordDate < start) return false;
      }
      if (filters.customDateEnd) {
        const end = new Date(filters.customDateEnd).getTime() + 86400000;
        if (recordDate > end) return false;
      }
    }
  }

  if (filters.ageMaxMonths < 36 && recordDate) {
    const diffMonths = (now - recordDate) / (1000 * 60 * 60 * 24 * 30.4375);
    if (diffMonths > filters.ageMaxMonths) return false;
  }

  // 6. Contact Availability
  const hasValidWebsite = Boolean(
    record.hasWebsite ||
    (record.website && record.website.trim() !== '' && record.website !== 'N/A')
  );
  const hasValidEmail = Boolean(record.email && record.email.includes('@'));
  const hasValidPhone = Boolean(record.phone && record.phone.trim() !== '' && record.phone !== 'N/A');
  const hasValidWhatsApp = Boolean(record.whatsapp || hasValidPhone);

  if (filters.contactAvailability.hasWebsite && !hasValidWebsite) return false;
  if (filters.contactAvailability.noWebsite && hasValidWebsite) return false;
  if (filters.contactAvailability.hasEmail && !hasValidEmail) return false;
  if (filters.contactAvailability.hasPhone && !hasValidPhone) return false;
  if (filters.contactAvailability.hasWhatsApp && !hasValidWhatsApp) return false;

  // 7. Digital Presence
  if (filters.digitalPresence.googleBusinessProfile !== 'all') {
    const hasGmb = Boolean(record.googleMapsLink && record.googleMapsLink.trim() !== '');
    if (
      (filters.digitalPresence.googleBusinessProfile === 'has_gmb' ||
        filters.digitalPresence.googleBusinessProfile === 'claimed') &&
      !hasGmb
    ) {
      return false;
    }
    if (filters.digitalPresence.googleBusinessProfile === 'unclaimed' && hasGmb) {
      return false;
    }
  }

  if (filters.digitalPresence.websiteAvailable && !hasValidWebsite) return false;
  if (filters.digitalPresence.websiteMissing && hasValidWebsite) return false;

  if (filters.digitalPresence.socialMediaAvailable) {
    const hasSocial = Boolean(
      (record.linkedin && record.linkedin.trim() !== '') ||
      (record.instagram && record.instagram.trim() !== '')
    );
    if (!hasSocial) return false;
  }

  // 8. Business Status
  if (filters.businessStatus.active) {
    if (record.status !== 'published' && record.status !== 'approved') return false;
  }

  if (filters.businessStatus.verified) {
    if (record.validationStatus !== 'Approved' && record.validationStatus !== 'Validated') {
      return false;
    }
  }

  if (filters.businessStatus.completeProfile) {
    const isComplete = Boolean(record.phone && record.email && (record.address || record.city));
    if (!isComplete) return false;
  }

  if (filters.businessStatus.recentlyUpdated && record.updatedAt) {
    const updatedDiffDays = (now - new Date(record.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (updatedDiffDays > 30) return false;
  }

  // 9. Lead Quality (Orion Score / Quality Score)
  const score = record.opportunityScore ?? record.dataQualityScore ?? record.validationScore ?? 50;

  if (score < filters.orionScoreRange[0] || score > filters.orionScoreRange[1]) {
    return false;
  }

  if (filters.orionScoreTier === 'high' && score < 80) return false;
  if (filters.orionScoreTier === 'medium' && (score < 50 || score >= 80)) return false;
  if (filters.orionScoreTier === 'low' && score >= 50) return false;

  // 10. Custom Dynamic Admin Filters
  if (filters.customAdminFilters) {
    for (const [catId, selectedValues] of Object.entries(filters.customAdminFilters)) {
      if (Array.isArray(selectedValues) && selectedValues.length > 0) {
        const match = selectedValues.some((sv) => {
          const query = sv.toLowerCase();
          return (
            (record.category && record.category.toLowerCase().includes(query)) ||
            (record.industry && record.industry.toLowerCase().includes(query)) ||
            (record.subIndustry && record.subIndustry.toLowerCase().includes(query)) ||
            (record.businessType && record.businessType.toLowerCase().includes(query)) ||
            (record.tags && record.tags.some(t => t.toLowerCase().includes(query))) ||
            (record.name && record.name.toLowerCase().includes(query))
          );
        });
        if (!match) return false;
      }
    }
  }

  // 11. Quick Filter Chips
  if (activeChips.length > 0) {
    if (activeChips.includes('new_today')) {
      if (!recordDate || (now - recordDate) / (1000 * 60 * 60 * 24) > 1) return false;
    }
    if (activeChips.includes('added_this_week')) {
      if (!recordDate || (now - recordDate) / (1000 * 60 * 60 * 24) > 7) return false;
    }
    if (activeChips.includes('added_this_month')) {
      if (!recordDate || (now - recordDate) / (1000 * 60 * 60 * 24) > 30) return false;
    }
    if (activeChips.includes('no_website') && hasValidWebsite) return false;
    if (activeChips.includes('has_website') && !hasValidWebsite) return false;
    if (activeChips.includes('has_email') && !hasValidEmail) return false;
    if (activeChips.includes('has_phone') && !hasValidPhone) return false;
    if (activeChips.includes('verified')) {
      if (record.validationStatus !== 'Approved' && record.validationStatus !== 'Validated') {
        return false;
      }
    }
    if (activeChips.includes('high_orion_score') && score < 80) return false;
  }

  return true;
}

/**
 * Calculates total count of active filters from DiscoverFilterState and QuickFilterChips.
 */
export function getAdminActiveFiltersCount(
  filters: DiscoverFilterState,
  activeChips: string[] = []
): number {
  let count = 0;
  if (filters.state) count += 1;
  if (filters.districts && filters.districts.length > 0) count += filters.districts.length;
  if (filters.cities && filters.cities.length > 0) count += filters.cities.length;
  if (filters.pincode) count += 1;

  if (filters.businessNameQuery?.trim()) count += 1;
  if (filters.industries && filters.industries.length > 0) count += filters.industries.length;
  if (filters.subIndustries && filters.subIndustries.length > 0) count += filters.subIndustries.length;
  if (filters.businessCategories && filters.businessCategories.length > 0) count += filters.businessCategories.length;
  if (filters.businessTypes && filters.businessTypes.length > 0) count += filters.businessTypes.length;
  if (filters.msmeCategories && filters.msmeCategories.length > 0) count += filters.msmeCategories.length;

  if (filters.customAdminFilters) {
    Object.values(filters.customAdminFilters).forEach((selected) => {
      if (Array.isArray(selected)) count += selected.length;
    });
  }

  if (filters.agePreset !== 'all') count += 1;
  if (filters.ageMaxMonths < 36) count += 1;

  if (filters.contactAvailability.hasWebsite) count += 1;
  if (filters.contactAvailability.noWebsite) count += 1;
  if (filters.contactAvailability.hasEmail) count += 1;
  if (filters.contactAvailability.hasPhone) count += 1;
  if (filters.contactAvailability.hasWhatsApp) count += 1;

  if (filters.digitalPresence.googleBusinessProfile !== 'all') count += 1;
  if (filters.digitalPresence.websiteAvailable) count += 1;
  if (filters.digitalPresence.websiteMissing) count += 1;
  if (filters.digitalPresence.socialMediaAvailable) count += 1;

  if (filters.businessStatus.active) count += 1;
  if (filters.businessStatus.verified) count += 1;
  if (filters.businessStatus.completeProfile) count += 1;
  if (filters.businessStatus.recentlyUpdated) count += 1;

  if (
    filters.orionScoreTier !== 'all' ||
    filters.orionScoreRange[0] > 0 ||
    filters.orionScoreRange[1] < 100
  ) {
    count += 1;
  }

  if (activeChips.length > 0) {
    count += activeChips.length;
  }

  return count;
}
