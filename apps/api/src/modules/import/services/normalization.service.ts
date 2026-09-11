import { Injectable, Logger } from '@nestjs/common';
import { StringUtil } from '../../../common/utils/string.util';
import { IdentifierType } from '@orion/shared';

export interface INormalizedRecordResult {
  name: string;
  legalName: string;
  description?: string;
  businessType?: string;
  msmeCategory?: string;
  foundingYear?: number;
  locations: Array<{
    addressLine1: string;
    addressLine2?: string;
    city: string;
    district: string;
    state: string;
    pincode: string;
    country: string;
  }>;
  contacts: Array<{
    fullName: string;
    title?: string;
    email?: string;
    phone?: string;
    isPrimary?: boolean;
  }>;
  digitalPresences: Array<{
    platform: string;
    url: string;
    domain?: string;
  }>;
  identifiers: Array<{
    type: IdentifierType;
    value: string;
    normalizedValue: string;
  }>;
  raw: Record<string, unknown>;
}

@Injectable()
export class NormalizationService {
  private readonly logger = new Logger(NormalizationService.name);

  /**
   * Normalizes a raw business record payload into standard canonical form
   */
  normalizeRecord(raw: Record<string, unknown>): INormalizedRecordResult {
    // 1. Business Name Normalization
    const rawName = String(raw.name || raw.businessName || raw.companyName || '').trim();
    const normalizedName = this.cleanBusinessName(rawName);
    const legalName = String(raw.legalName || rawName).trim();

    // 2. Location Normalization
    const city = this.cleanCity(String(raw.city || raw.locationCity || ''));
    const district = this.cleanDistrict(String(raw.district || raw.city || ''));
    const state = this.cleanState(String(raw.state || raw.province || ''));
    const pincode = this.cleanPincode(String(raw.pincode || raw.postalCode || raw.zipCode || ''));
    const addressLine1 = String(raw.address || raw.addressLine1 || `${city}, ${state}`).trim();

    const locations = [
      {
        addressLine1,
        addressLine2: raw.addressLine2 ? String(raw.addressLine2).trim() : undefined,
        city: city || 'Unknown City',
        district: district || city || 'Unknown District',
        state: state || 'Unknown State',
        pincode: pincode || '000000',
        country: 'India',
      },
    ];

    // 3. Contact Normalization
    const contacts: INormalizedRecordResult['contacts'] = [];
    const rawEmail = raw.email ? String(raw.email).trim().toLowerCase() : undefined;
    const rawPhone = raw.phone || raw.mobile || raw.contactNumber;
    const normalizedPhone = rawPhone ? this.cleanPhone(String(rawPhone)) : undefined;

    if (raw.contactPerson || raw.directorName || rawEmail || normalizedPhone) {
      contacts.push({
        fullName: String(raw.contactPerson || raw.directorName || 'Primary Contact').trim(),
        title: raw.title ? String(raw.title).trim() : 'Director/Owner',
        email: rawEmail,
        phone: normalizedPhone,
        isPrimary: true,
      });
    }

    // 4. Digital Presence Normalization
    const digitalPresences: INormalizedRecordResult['digitalPresences'] = [];
    if (raw.website || raw.websiteUrl) {
      const rawWeb = String(raw.website || raw.websiteUrl).trim();
      const domain = StringUtil.extractDomain(rawWeb);
      digitalPresences.push({
        platform: 'WEBSITE',
        url: rawWeb.startsWith('http') ? rawWeb : `https://${rawWeb}`,
        domain: domain || undefined,
      });
    }

    if (raw.linkedin || raw.linkedinUrl) {
      digitalPresences.push({
        platform: 'LINKEDIN',
        url: String(raw.linkedin || raw.linkedinUrl).trim(),
      });
    }

    // 5. Identifiers Normalization (GSTIN, PAN, CIN, UDYAM)
    const identifiers: INormalizedRecordResult['identifiers'] = [];
    if (raw.gstin || raw.gstNumber) {
      const gstin = String(raw.gstin || raw.gstNumber).trim().toUpperCase();
      identifiers.push({
        type: IdentifierType.GSTIN,
        value: gstin,
        normalizedValue: gstin.replace(/[^A-Z0-9]/g, ''),
      });
    }

    if (raw.cin || raw.cinNumber) {
      const cin = String(raw.cin || raw.cinNumber).trim().toUpperCase();
      identifiers.push({
        type: IdentifierType.CIN,
        value: cin,
        normalizedValue: cin.replace(/[^A-Z0-9]/g, ''),
      });
    }

    if (raw.pan || raw.panNumber) {
      const pan = String(raw.pan || raw.panNumber).trim().toUpperCase();
      identifiers.push({
        type: IdentifierType.PAN,
        value: pan,
        normalizedValue: pan.replace(/[^A-Z0-9]/g, ''),
      });
    }

    if (raw.udyam || raw.udyamRegistration) {
      const udyam = String(raw.udyam || raw.udyamRegistration).trim().toUpperCase();
      identifiers.push({
        type: IdentifierType.UDYAM,
        value: udyam,
        normalizedValue: udyam.replace(/[^A-Z0-9]/g, ''),
      });
    }

    return {
      name: normalizedName,
      legalName,
      description: raw.description ? String(raw.description).trim() : undefined,
      businessType: raw.businessType ? String(raw.businessType).toUpperCase().trim() : undefined,
      msmeCategory: raw.msmeCategory ? String(raw.msmeCategory).toUpperCase().trim() : undefined,
      foundingYear: raw.foundingYear ? Number(raw.foundingYear) : undefined,
      locations,
      contacts,
      digitalPresences,
      identifiers,
      raw,
    };
  }

  private cleanBusinessName(name: string): string {
    return name
      .replace(/\s+/g, ' ')
      .replace(/\bPvt\.?\s*Ltd\.?\b/gi, 'Private Limited')
      .replace(/\bLtd\.?\b/gi, 'Limited')
      .replace(/\bLLP\.?\b/gi, 'LLP')
      .trim();
  }

  private cleanCity(city: string): string {
    if (!city) return '';
    return city
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private cleanDistrict(district: string): string {
    return this.cleanCity(district);
  }

  private cleanState(state: string): string {
    if (!state) return '';
    const clean = state.trim();
    const stateMap: Record<string, string> = {
      MH: 'Maharashtra',
      KA: 'Karnataka',
      TN: 'Tamil Nadu',
      DL: 'Delhi',
      GJ: 'Gujarat',
      TS: 'Telangana',
      UP: 'Uttar Pradesh',
      WB: 'West Bengal',
      HR: 'Haryana',
      RJ: 'Rajasthan',
      KL: 'Kerala',
    };
    return stateMap[clean.toUpperCase()] || this.cleanCity(clean);
  }

  private cleanPincode(pincode: string): string {
    const digits = pincode.replace(/\D/g, '');
    return digits.length === 6 ? digits : digits.padEnd(6, '0').slice(0, 6);
  }

  private cleanPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    return digits ? `+${digits}` : '';
  }
}
