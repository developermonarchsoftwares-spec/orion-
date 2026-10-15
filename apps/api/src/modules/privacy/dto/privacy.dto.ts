import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CONSENT_PURPOSES } from '../privacy.config';

export class SetConsentDto {
  @IsIn([...CONSENT_PURPOSES])
  purpose!: string;

  @IsBoolean()
  granted!: boolean;
}

export class RequestDeletionDto {
  /** Typed confirmation: must equal the account e-mail. */
  @IsEmail()
  confirmEmail!: string;

  /** Required when the account has a password. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}
