import { PasswordService } from './password.service';

describe('PasswordService (Unit Tests)', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  it('should hash a password securely using bcrypt', async () => {
    const rawPassword = 'SecretPassword123!';
    const hash = await service.hash(rawPassword);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(rawPassword);
    expect(hash.startsWith('$2')).toBe(true); // bcrypt prefix
  });

  it('should correctly compare matching password and hash', async () => {
    const rawPassword = 'SecretPassword123!';
    const hash = await service.hash(rawPassword);

    const isMatch = await service.compare(rawPassword, hash);
    expect(isMatch).toBe(true);
  });

  it('should reject non-matching passwords', async () => {
    const rawPassword = 'SecretPassword123!';
    const hash = await service.hash(rawPassword);

    const isMatch = await service.compare('WrongPassword456!', hash);
    expect(isMatch).toBe(false);
  });
});
