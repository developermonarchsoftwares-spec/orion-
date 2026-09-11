import { Injectable, Logger } from '@nestjs/common';
import { BusinessOpportunityTier } from '@orion/shared';

export interface IBusinessScoringInput {
  business: {
    name: string;
    legalName?: string | null;
    description?: string | null;
    foundingYear?: number | null;
    industryId?: string | null;
    categoryId?: string | null;
    isEnriched?: boolean;
    isVerified?: boolean;
    lastEnrichedAt?: Date | null;
  };
  locations: Array<{
    addressLine1: string;
    city: string;
    district: string;
    state: string;
    pincode: string;
    latitude?: string | null;
    longitude?: string | null;
  }>;
  contacts: Array<{
    fullName: string;
    email?: string | null;
    phone?: string | null;
    isEmailVerified?: boolean;
    isPhoneVerified?: boolean;
    isDecisionMaker?: boolean;
  }>;
  digitalPresences: Array<{
    platform: string;
    url: string;
    isVerified?: boolean;
    techStackDetected?: unknown[];
  }>;
  identifiers: Array<{
    type: string;
    value: string;
    isVerified?: boolean;
  }>;
}

export interface ICalculatedScores {
  completenessScore: number;
  verificationScore: number;
  freshnessScore: number;
  digitalPresenceScore: number;
  confidenceScore: number;
  orionScore: number;
  opportunityTier: BusinessOpportunityTier;
  factorBreakdown: Record<string, number>;
  weightsApplied: Record<string, number>;
}

@Injectable()
export class BusinessScoringService {
  private readonly logger = new Logger(BusinessScoringService.name);

  calculateScores(input: IBusinessScoringInput): ICalculatedScores {
    const { business, locations, contacts, digitalPresences, identifiers } = input;

    // 1. Completeness Score (0 - 100)
    let completeness = 0;
    if (business.name) completeness += 10;
    if (business.legalName) completeness += 10;
    if (business.description) completeness += 10;
    if (business.industryId) completeness += 10;
    if (business.categoryId) completeness += 10;
    if (locations.length > 0) completeness += 15;
    if (locations.some((l) => l.latitude && l.longitude)) completeness += 5;
    if (contacts.length > 0) completeness += 15;
    if (digitalPresences.length > 0) completeness += 10;
    if (identifiers.length > 0) completeness += 5;
    completeness = Math.min(completeness, 100);

    // 2. Verification Score (0 - 100)
    let verification = 0;
    if (identifiers.some((i) => i.isVerified || ['GSTIN', 'CIN', 'PAN'].includes(i.type))) {
      verification += 40;
    }
    if (contacts.some((c) => c.isEmailVerified)) verification += 20;
    if (contacts.some((c) => c.isPhoneVerified)) verification += 20;
    if (digitalPresences.some((d) => d.isVerified)) verification += 10;
    if (business.isVerified) verification += 10;
    verification = Math.min(verification, 100);

    // 3. Digital Presence Score (0 - 100)
    let digital = 0;
    const hasWebsite = digitalPresences.some((d) => d.platform === 'WEBSITE');
    const hasLinkedin = digitalPresences.some((d) => d.platform === 'LINKEDIN');
    const hasTechStack = digitalPresences.some((d) => Array.isArray(d.techStackDetected) && d.techStackDetected.length > 0);

    if (hasWebsite) digital += 40;
    if (hasLinkedin) digital += 25;
    if (digitalPresences.length >= 3) digital += 15;
    if (hasTechStack) digital += 20;
    digital = Math.min(digital, 100);

    // 4. Freshness Score (0 - 100)
    let freshness = 80;
    if (business.lastEnrichedAt) {
      const daysSinceEnrichment = Math.floor(
        (Date.now() - new Date(business.lastEnrichedAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      freshness = Math.max(10, 100 - daysSinceEnrichment * 2);
    }

    // 5. Confidence Score (0 - 100)
    const confidence = Math.round(
      completeness * 0.35 + verification * 0.45 + freshness * 0.2,
    );

    // 6. Orion Composite Score (0 - 100)
    const weights = {
      completeness: 0.25,
      verification: 0.35,
      digitalPresence: 0.20,
      freshness: 0.10,
      confidence: 0.10,
    };

    const orionScore = Math.round(
      completeness * weights.completeness +
        verification * weights.verification +
        digital * weights.digitalPresence +
        freshness * weights.freshness +
        confidence * weights.confidence,
    );

    let opportunityTier = BusinessOpportunityTier.LOW;
    if (orionScore >= 75) {
      opportunityTier = BusinessOpportunityTier.HIGH;
    } else if (orionScore >= 45) {
      opportunityTier = BusinessOpportunityTier.MEDIUM;
    }

    return {
      completenessScore: completeness,
      verificationScore: verification,
      freshnessScore: freshness,
      digitalPresenceScore: digital,
      confidenceScore: confidence,
      orionScore,
      opportunityTier,
      factorBreakdown: {
        completeness,
        verification,
        digitalPresence: digital,
        freshness,
        confidence,
      },
      weightsApplied: weights,
    };
  }
}
