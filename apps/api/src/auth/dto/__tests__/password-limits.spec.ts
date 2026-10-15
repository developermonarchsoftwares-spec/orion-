import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from '../../../modules/user/dto/user.dto';
import { RegisterDto, ResetPasswordDto } from '../auth.dto';

/**
 * SG-25: an unbounded password makes bcrypt hashing an easy CPU-exhaustion request, so every DTO that carries a password caps it at 128
 * characters (and still requires 8). Boundary values are tested on both sides.
 */
const pw = (n: number) => 'Aa1!'.repeat(Math.ceil(n / 4)).slice(0, n);
const errorsFor = async (cls: any, plain: Record<string, unknown>) => (await validate(plainToInstance(cls, plain))).map((e) => e.property);

describe('password length limits (SG-25)', () => {
  const register = { email: 'person@example.test', firstName: 'Pat', lastName: 'Lee' };

  it('RegisterDto accepts 8 and 128 characters and rejects 7 and 129', async () => {
    expect(await errorsFor(RegisterDto, { ...register, password: pw(8) })).not.toContain('password');
    expect(await errorsFor(RegisterDto, { ...register, password: pw(128) })).not.toContain('password');
    expect(await errorsFor(RegisterDto, { ...register, password: pw(7) })).toContain('password');
    expect(await errorsFor(RegisterDto, { ...register, password: pw(129) })).toContain('password');
    expect(await errorsFor(RegisterDto, { ...register, password: pw(100000) })).toContain('password');
  });

  it('ResetPasswordDto bounds the new password the same way', async () => {
    expect(await errorsFor(ResetPasswordDto, { token: 't', newPassword: pw(128) })).not.toContain('newPassword');
    expect(await errorsFor(ResetPasswordDto, { token: 't', newPassword: pw(129) })).toContain('newPassword');
    expect(await errorsFor(ResetPasswordDto, { token: 't', newPassword: pw(7) })).toContain('newPassword');
  });

  it('ChangePasswordDto bounds both the current and the new password', async () => {
    expect(await errorsFor(ChangePasswordDto, { currentPassword: pw(128), newPassword: pw(128) })).toEqual([]);
    expect(await errorsFor(ChangePasswordDto, { currentPassword: pw(129), newPassword: pw(20) })).toContain('currentPassword');
    expect(await errorsFor(ChangePasswordDto, { currentPassword: pw(20), newPassword: pw(129) })).toContain('newPassword');
    expect(await errorsFor(ChangePasswordDto, { newPassword: pw(7) })).toContain('newPassword');
  });
});
