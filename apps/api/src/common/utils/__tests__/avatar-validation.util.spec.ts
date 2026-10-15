import { validateAvatarImage, MAX_AVATAR_BYTES } from '../avatar-validation.util';
import { BusinessException } from '../../errors/business.exception';

describe('M-4 / SG-24: Avatar validation utility (validateAvatarImage)', () => {
  it('accepts valid base64 PNG data URI', () => {
    const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    expect(validateAvatarImage(validPng)).toBe(validPng);
  });

  it('accepts valid base64 JPEG and WEBP data URIs', () => {
    const validJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const validWebp = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=';
    expect(validateAvatarImage(validJpeg)).toBe(validJpeg);
    expect(validateAvatarImage(validWebp)).toBe(validWebp);
  });

  it('accepts valid HTTPS URL without credentials', () => {
    const httpsUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150';
    expect(validateAvatarImage(httpsUrl)).toBe(httpsUrl);
  });

  it('rejects SVG base64 (executable script vector)', () => {
    const svgData = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=';
    expect(() => validateAvatarImage(svgData)).toThrow(BusinessException);
    expect(() => validateAvatarImage(svgData)).toThrow(/Only PNG, JPEG, WEBP, or GIF/i);
  });

  it('rejects non-image data URIs like text/html or javascript', () => {
    const htmlData = 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==';
    expect(() => validateAvatarImage(htmlData)).toThrow(BusinessException);
  });

  it('rejects oversized avatar payloads (>1.5MB)', () => {
    const hugeImage = 'data:image/png;base64,' + 'A'.repeat(MAX_AVATAR_BYTES + 10);
    expect(() => validateAvatarImage(hugeImage)).toThrow(BusinessException);
    expect(() => validateAvatarImage(hugeImage)).toThrow(/exceeds maximum allowed size/i);
  });

  it('rejects insecure HTTP URLs', () => {
    const httpUrl = 'http://example.com/avatar.jpg';
    expect(() => validateAvatarImage(httpUrl)).toThrow(BusinessException);
  });

  it('rejects private IPs and localhost in avatar URLs', () => {
    expect(() => validateAvatarImage('https://localhost/avatar.png')).toThrow(/host is not permitted/i);
    expect(() => validateAvatarImage('https://127.0.0.1/avatar.png')).toThrow(/host is not permitted/i);
    expect(() => validateAvatarImage('https://169.254.169.254/latest/meta-data')).toThrow(/host is not permitted/i);
    expect(() => validateAvatarImage('https://10.0.0.1/avatar.png')).toThrow(/host is not permitted/i);
    expect(() => validateAvatarImage('https://192.168.1.1/avatar.png')).toThrow(/host is not permitted/i);
  });

  it('rejects URLs containing embedded credentials', () => {
    expect(() => validateAvatarImage('https://admin:secret@images.example.com/pic.jpg')).toThrow(/embedded credentials/i);
  });

  it('rejects javascript: and other dangerous schemes', () => {
    expect(() => validateAvatarImage('javascript:alert(1)')).toThrow(BusinessException);
    expect(() => validateAvatarImage('file:///etc/passwd')).toThrow(BusinessException);
  });

  // Phase 32: these passed the earlier string-list check (found by probing, not by the original tests).
  it.each([
    'https://[::1]/a.png',
    'https://127.0.0.2/a.png',
    'https://[::ffff:127.0.0.1]/a.png',
    'https://169.254.1.1/a.png',
    'https://100.64.0.1/a.png',
    'https://[fd00::1]/a.png',
    'https://[fe80::1]/a.png',
    'https://localhost./a.png',
    'https://metadata.google.internal/a.png',
  ])('rejects non-public host forms that a string list misses: %s', (url) => {
    expect(() => validateAvatarImage(url)).toThrow(/host is not permitted/i);
  });
});
