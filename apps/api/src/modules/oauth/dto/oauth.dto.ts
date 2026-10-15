import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength } from 'class-validator';

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toLowerCase() : value);
export const OAUTH_PROVIDERS = ['google', 'microsoft'] as const;

/** The identity provider named in a link, unlink or token-exchange request. Case-insensitive; anything else is a 400 (it used to be a 500). */
export class OAuthProviderDto {
  @ApiProperty({ enum: OAUTH_PROVIDERS })
  @Transform(lower)
  @IsIn([...OAUTH_PROVIDERS], { message: 'provider must be google or microsoft' })
  provider!: 'google' | 'microsoft';
}

export class OAuthTokenDto extends OAuthProviderDto {
  @ApiProperty({ description: 'Authorization code returned by the provider' })
  @IsString()
  @MaxLength(4096)
  code!: string;

  @ApiProperty({ description: 'State value issued with the authorization URL' })
  @IsString()
  @MaxLength(4096)
  state!: string;
}
