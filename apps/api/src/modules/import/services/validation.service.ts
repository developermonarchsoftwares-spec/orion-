import { Injectable, Logger } from '@nestjs/common';
import { INormalizedRecordResult } from './normalization.service';
import { ValidationSeverity } from '@orion/shared';

export interface IValidationLogItem {
  ruleName: string;
  field: string;
  severity: ValidationSeverity;
  message: string;
  passed: boolean;
  metadata?: Record<string, unknown>;
}

export interface IValidationResult {
  isValid: boolean;
  hasWarnings: boolean;
  logs: IValidationLogItem[];
}

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  validateRecord(record: INormalizedRecordResult): IValidationResult {
    const logs: IValidationLogItem[] = [];

    // 1. Required Fields Check
    if (!record.name || record.name.length < 2) {
      logs.push({
        ruleName: 'REQUIRED_BUSINESS_NAME',
        field: 'name',
        severity: ValidationSeverity.ERROR,
        message: 'Business name is missing or too short (< 2 characters)',
        passed: false,
      });
    }

    if (!record.locations || record.locations.length === 0) {
      logs.push({
        ruleName: 'REQUIRED_LOCATION',
        field: 'locations',
        severity: ValidationSeverity.ERROR,
        message: 'At least one location must be provided',
        passed: false,
      });
    } else {
      const loc = record.locations[0];
      if (!loc.city || loc.city === 'Unknown City') {
        logs.push({
          ruleName: 'REQUIRED_CITY',
          field: 'locations.city',
          severity: ValidationSeverity.WARNING,
          message: 'Location city is undefined or ambiguous',
          passed: false,
        });
      }
      if (!loc.state || loc.state === 'Unknown State') {
        logs.push({
          ruleName: 'REQUIRED_STATE',
          field: 'locations.state',
          severity: ValidationSeverity.ERROR,
          message: 'Location state is mandatory',
          passed: false,
        });
      }
      if (loc.pincode && loc.pincode.length !== 6) {
        logs.push({
          ruleName: 'INVALID_PINCODE_LENGTH',
          field: 'locations.pincode',
          severity: ValidationSeverity.WARNING,
          message: `Pincode '${loc.pincode}' must be 6 digits`,
          passed: false,
        });
      }
    }

    // 2. Email Validation
    for (const contact of record.contacts) {
      if (contact.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(contact.email)) {
          logs.push({
            ruleName: 'INVALID_EMAIL_FORMAT',
            field: 'contacts.email',
            severity: ValidationSeverity.WARNING,
            message: `Email '${contact.email}' is malformed`,
            passed: false,
          });
        }
      }

      // 3. Phone Validation
      if (contact.phone) {
        const phoneRegex = /^\+91[6-9]\d{9}$/;
        if (!phoneRegex.test(contact.phone)) {
          logs.push({
            ruleName: 'INVALID_PHONE_FORMAT',
            field: 'contacts.phone',
            severity: ValidationSeverity.WARNING,
            message: `Phone '${contact.phone}' is not a valid Indian mobile format (+91XXXXXXXXXX)`,
            passed: false,
          });
        }
      }
    }

    // 4. Identifier Regex Validations
    for (const ident of record.identifiers) {
      if (ident.type === 'GSTIN') {
        const gstinRegex = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;
        if (!gstinRegex.test(ident.normalizedValue)) {
          logs.push({
            ruleName: 'INVALID_GSTIN_FORMAT',
            field: 'identifiers.GSTIN',
            severity: ValidationSeverity.WARNING,
            message: `GSTIN '${ident.value}' does not conform to statutory 15-character format`,
            passed: false,
          });
        }
      }

      if (ident.type === 'PAN') {
        const panRegex = /^[A-Z]{5}\d{4}[A-Z]{1}$/;
        if (!panRegex.test(ident.normalizedValue)) {
          logs.push({
            ruleName: 'INVALID_PAN_FORMAT',
            field: 'identifiers.PAN',
            severity: ValidationSeverity.WARNING,
            message: `PAN '${ident.value}' does not conform to statutory 10-character format`,
            passed: false,
          });
        }
      }

      if (ident.type === 'CIN') {
        const cinRegex = /^[LU]{1}\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
        if (!cinRegex.test(ident.normalizedValue)) {
          logs.push({
            ruleName: 'INVALID_CIN_FORMAT',
            field: 'identifiers.CIN',
            severity: ValidationSeverity.WARNING,
            message: `CIN '${ident.value}' does not conform to statutory 21-character format`,
            passed: false,
          });
        }
      }
    }

    const hasErrors = logs.some((l) => l.severity === ValidationSeverity.ERROR && !l.passed);
    const hasWarnings = logs.some((l) => l.severity === ValidationSeverity.WARNING && !l.passed);

    return {
      isValid: !hasErrors,
      hasWarnings,
      logs,
    };
  }
}
