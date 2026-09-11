import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql, inArray, and } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { INormalizedRecordResult } from './normalization.service';
import { DuplicateMatchType } from '@orion/shared';

export interface IDuplicateCandidateMatch {
  matchedBusinessId: string;
  confidenceScore: number;
  matchType: DuplicateMatchType;
  matchDetails: Record<string, unknown>;
}

@Injectable()
export class DuplicateDetectionService {
  private readonly logger = new Logger(DuplicateDetectionService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  /**
   * Scans existing production businesses to identify duplicates with multiple detection heuristics
   */
  async detectDuplicates(record: INormalizedRecordResult): Promise<IDuplicateCandidateMatch[]> {
    const matches: IDuplicateCandidateMatch[] = [];

    // 1. Identifier Matching (100% confidence for statutory IDs)
    if (record.identifiers && record.identifiers.length > 0) {
      const normalizedValues = record.identifiers.map((i) => i.normalizedValue);
      const identifierHits = await this.db.query.businessIdentifiers.findMany({
        where: inArray(schema.businessIdentifiers.normalizedValue, normalizedValues),
        with: { business: true },
      });

      for (const hit of identifierHits) {
        matches.push({
          matchedBusinessId: hit.businessId,
          confidenceScore: 100.0,
          matchType: DuplicateMatchType.IDENTIFIER,
          matchDetails: {
            identifierType: hit.type,
            matchedValue: hit.value,
            businessName: hit.business?.name,
          },
        });
      }
    }

    // 2. Domain / Website Exact Matching (95% confidence)
    const websitePresence = record.digitalPresences.find((d) => d.platform === 'WEBSITE' && d.domain);
    if (websitePresence?.domain) {
      const domainHit = await this.db.query.digitalPresences.findFirst({
        where: eq(schema.digitalPresences.domain, websitePresence.domain),
        with: { business: true },
      });

      if (domainHit && !matches.some((m) => m.matchedBusinessId === domainHit.businessId)) {
        matches.push({
          matchedBusinessId: domainHit.businessId,
          confidenceScore: 95.0,
          matchType: DuplicateMatchType.EXACT,
          matchDetails: {
            domain: websitePresence.domain,
            businessName: domainHit.business?.name,
          },
        });
      }
    }

    // 3. Name + Location Heuristics
    const primaryLocation = record.locations[0];
    if (primaryLocation?.state && primaryLocation.city) {
      // Find businesses in the same city/state
      const locationCandidates = await this.db.query.businessLocations.findMany({
        where: and(
          eq(schema.businessLocations.state, primaryLocation.state),
          eq(schema.businessLocations.city, primaryLocation.city),
        ),
        with: { business: true },
        limit: 50,
      });

      for (const candidate of locationCandidates) {
        if (!candidate.business) continue;
        if (matches.some((m) => m.matchedBusinessId === candidate.businessId)) continue;

        const similarity = this.calculateStringSimilarity(
          record.name.toLowerCase(),
          candidate.business.name.toLowerCase(),
        );

        if (similarity >= 0.90) {
          matches.push({
            matchedBusinessId: candidate.businessId,
            confidenceScore: Math.round(similarity * 1000) / 10,
            matchType: DuplicateMatchType.FUZZY_NAME,
            matchDetails: {
              similarityScore: similarity,
              recordName: record.name,
              existingName: candidate.business.name,
              city: primaryLocation.city,
            },
          });
        } else if (similarity >= 0.75 && candidate.pincode === primaryLocation.pincode) {
          matches.push({
            matchedBusinessId: candidate.businessId,
            confidenceScore: Math.round(similarity * 900) / 10,
            matchType: DuplicateMatchType.LOCATION,
            matchDetails: {
              similarityScore: similarity,
              recordName: record.name,
              existingName: candidate.business.name,
              pincode: primaryLocation.pincode,
            },
          });
        }
      }
    }

    return matches;
  }

  /**
   * Jaro-Winkler / Bigram similarity calculation
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (str1.length < 2 || str2.length < 2) return 0.0;

    const bigrams1 = this.getBigrams(str1);
    const bigrams2 = this.getBigrams(str2);

    let intersection = 0;
    for (const [bigram, count1] of bigrams1.entries()) {
      const count2 = bigrams2.get(bigram) || 0;
      intersection += Math.min(count1, count2);
    }

    const total = str1.length - 1 + (str2.length - 1);
    return total > 0 ? (2.0 * intersection) / total : 0;
  }

  private getBigrams(str: string): Map<string, number> {
    const map = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.substring(i, i + 2);
      map.set(bigram, (map.get(bigram) || 0) + 1);
    }
    return map;
  }
}
