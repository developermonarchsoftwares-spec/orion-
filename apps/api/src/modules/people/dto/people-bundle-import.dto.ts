import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** Body of POST /admin/people/import/bundle[/validate]: the Pipeline's split-export ZIP, base64 encoded. */
export class PeopleBundleImportDto {
  @ApiProperty({ description: 'The People Pipeline split-export ZIP (manifest.json + parts), base64 encoded' })
  @IsString() // the size is checked by the service (413 BUNDLE_TOO_LARGE); the route's body limit bounds the request itself
  content!: string;

  @ApiPropertyOptional({ description: 'Validate and resolve every part without writing People data', default: false })
  @IsOptional()
  @Transform(({ obj }) => obj.dryRun) // only a real boolean is accepted, as for a single file
  @IsBoolean()
  dryRun?: boolean;
}
