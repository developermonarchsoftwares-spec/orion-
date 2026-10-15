import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../errors/business.exception';
import { parsePublicUrl } from './public-url.util';

export const MAX_AVATAR_BYTES = 1_500_000; // ~1.5 MB text / base64
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

/**
 * Validates avatar image input for M-4 / SG-24.
 * Accepts only:
 *  1. Base64 data URI of allowed formats: PNG, JPEG, WEBP, GIF (SVG and executable formats forbidden).
 *  2. HTTPS URL pointing to safe hosts without credentials or private IPs.
 * Enforces a size cap (~1.5MB) to prevent database bloat and memory exhaustion.
 */
export function validateAvatarImage(image: unknown): string {
  if (typeof image !== 'string' || image.trim().length === 0) {
    throw new BusinessException('Avatar image is required.', 'INVALID_AVATAR', HttpStatus.BAD_REQUEST);
  }

  const trimmed = image.trim();
  if (trimmed.length > MAX_AVATAR_BYTES) {
    throw new BusinessException(
      'Avatar image exceeds maximum allowed size (~1.5MB).',
      'AVATAR_TOO_LARGE',
      HttpStatus.BAD_REQUEST,
    );
  }

  if (trimmed.startsWith('data:')) {
    if (!DATA_IMAGE_RE.test(trimmed)) {
      throw new BusinessException(
        'Only PNG, JPEG, WEBP, or GIF base64 images are allowed. SVG and executable formats are forbidden.',
        'INVALID_AVATAR_FORMAT',
        HttpStatus.BAD_REQUEST,
      );
    }
    return trimmed;
  }

  if (/^https:\/\//i.test(trimmed)) {
    // Phase 32: the host rules are the shared value-based ones (IPv6 forms, 127/8, 169.254/16, 100.64/10, unique-local, internal
    // names), not a list of strings: the previous list let `https://[::1]/`, `127.0.0.2` and `metadata.google.internal` through.
    const parsed = parsePublicUrl(trimmed);
    if (parsed.ok) return trimmed;
    if (parsed.reason === 'CREDENTIALS') {
      throw new BusinessException(
        'Avatar URL must not contain embedded credentials.',
        'INVALID_AVATAR_CREDENTIALS',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (parsed.reason === 'HOST_NOT_PUBLIC') {
      throw new BusinessException('Avatar URL host is not permitted.', 'INVALID_AVATAR_HOST', HttpStatus.BAD_REQUEST);
    }
    throw new BusinessException('Invalid avatar URL format.', 'INVALID_AVATAR_URL', HttpStatus.BAD_REQUEST);
  }

  throw new BusinessException(
    'Avatar must be a base64 data image (PNG/JPEG/WEBP/GIF) or an https URL.',
    'INVALID_AVATAR_PROTOCOL',
    HttpStatus.BAD_REQUEST,
  );
}
