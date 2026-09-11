import {
  Controller,
  Get,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { DiscoverService } from '../discover/discover.service';
import { Public } from '../../auth/decorators';
import { IJwtPayload } from '@orion/shared';

@ApiTags('Businesses')
@Controller('businesses')
export class BusinessController {
  constructor(private readonly discoverService: DiscoverService) {}

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get business details by ID or slug with masked/unmasked contact details' })
  @ApiResponse({ status: 200, description: 'Business detail profile' })
  @ApiResponse({ status: 404, description: 'Business not found' })
  async getBusinessById(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const user = (req as unknown as { user?: IJwtPayload }).user;
    return this.discoverService.getBusinessBySlug(id, user?.sub);
  }

  @Public()
  @Get(':id/related')
  @ApiOperation({ summary: 'Get related businesses by ID or slug' })
  @ApiResponse({ status: 200, description: 'Related businesses list' })
  async getRelatedBusinesses(
    @Param('id') id: string,
    @Query('limit') limit?: number,
  ) {
    return this.discoverService.getRelatedBusinesses(id, limit ? Number(limit) : 4);
  }
}
