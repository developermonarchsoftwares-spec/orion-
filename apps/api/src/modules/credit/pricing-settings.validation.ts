import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/errors/business.exception';

/**
 * The pricing settings an administrator may change, and the shape and range of each value. These numbers feed wallet arithmetic and
 * the amount charged at checkout (daily credits, annual discount, tax, top-up price), so an unvalidated value could create credits
 * from nothing (a huge daily allocation), corrupt a wallet (NaN, a string or a negative), or produce a negative or absurd price
 * (an annual discount above 100). The endpoint used to accept any key with any JSON value.
 */
type Rule = { type: 'int' | 'number' | 'string'; min?: number; max?: number; pattern?: RegExp; required?: boolean };

const RULES: Readonly<Record<string, Readonly<Record<string, Rule>>>> = Object.freeze({
  DAILY_FREE_CREDITS: { amount: { type: 'int', min: 0, max: 1000, required: true } },
  LOW_CREDIT_THRESHOLD: { amount: { type: 'int', min: 0, max: 1000, required: true } },
  ANNUAL_DISCOUNT_PERCENTAGE: { percentage: { type: 'number', min: 0, max: 99, required: true } },
  TAX_PERCENTAGE: { percentage: { type: 'number', min: 0, max: 99, required: true } },
  DEFAULT_CURRENCY: { currency: { type: 'string', pattern: /^[A-Z]{3}$/, required: true }, symbol: { type: 'string', max: 4 } },
  TOPUP_PRICING: {
    pricePerCreditInr: { type: 'number', min: 0.01, max: 10_000 },
    minCredits: { type: 'int', min: 1, max: 1_000_000 },
    maxCredits: { type: 'int', min: 1, max: 1_000_000 },
  },
});

export const PRICING_SETTING_KEYS: readonly string[] = Object.freeze(Object.keys(RULES));

const invalid = (message: string): never => {
  throw new BusinessException(message, 'INVALID_PRICING_SETTING', HttpStatus.BAD_REQUEST);
};

/** Returns the value to store, or throws a 400. Only the documented fields (plus an optional text `description`) are kept. */
export function validatePricingSetting(key: unknown, value: unknown): Record<string, unknown> {
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(RULES, key)) {
    return invalid(`Unknown pricing setting. Allowed: ${PRICING_SETTING_KEYS.join(', ')}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid(`${key} must be an object`);
  const input = value as Record<string, unknown>;
  const rules = RULES[key];
  const out: Record<string, unknown> = {};

  for (const name of Object.keys(input)) {
    if (name !== 'description' && !Object.prototype.hasOwnProperty.call(rules, name)) return invalid(`${key} has no field "${name}"`);
  }
  for (const [name, rule] of Object.entries(rules)) {
    const v = input[name];
    if (v === undefined) {
      if (rule.required) return invalid(`${key}.${name} is required`);
      continue;
    }
    if (rule.type === 'string') {
      if (typeof v !== 'string' || (rule.pattern && !rule.pattern.test(v)) || (rule.max !== undefined && v.length > rule.max)) return invalid(`${key}.${name} is not valid`);
    } else {
      if (typeof v !== 'number' || !Number.isFinite(v) || (rule.type === 'int' && !Number.isInteger(v))) return invalid(`${key}.${name} must be a ${rule.type === 'int' ? 'whole ' : ''}number`);
      if ((rule.min !== undefined && v < rule.min) || (rule.max !== undefined && v > rule.max)) return invalid(`${key}.${name} must be between ${rule.min} and ${rule.max}`);
    }
    out[name] = v;
  }
  if (key === 'TOPUP_PRICING' && typeof out.minCredits === 'number' && typeof out.maxCredits === 'number' && out.maxCredits < out.minCredits) {
    return invalid('TOPUP_PRICING.maxCredits must not be below minCredits');
  }
  if (typeof input.description === 'string') out.description = input.description.slice(0, 255);
  return out;
}

/** A stored value read back for arithmetic: anything outside the allowed range falls back to the default instead of reaching a wallet. */
export function safeIntSetting(value: unknown, field: string, fallback: number, min: number, max: number): number {
  const n = (value as Record<string, unknown> | null | undefined)?.[field];
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function safeNumberSetting(value: unknown, field: string, fallback: number, min: number, max: number): number {
  const n = (value as Record<string, unknown> | null | undefined)?.[field];
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
