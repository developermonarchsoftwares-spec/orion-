import {
  Controller,
  Get,
  Query,
  Param,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { DiscoverService } from './discover.service';
import { DiscoverSearchQueryDto, DiscoverSuggestionsDto } from './dto/discover.dto';
import { Public } from '../../auth/decorators';
import { IJwtPayload } from '@orion/shared';

@ApiTags('Discover')
@Controller('discover')
export class DiscoverController {
  constructor(private readonly discoverService: DiscoverService) {}

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Discover businesses with full-text search, faceted filtering, and sorting' })
  @ApiResponse({ status: 200, description: 'Paginated business discovery results' })
  async search(
    @Query() query: DiscoverSearchQueryDto,
    @Req() req: Request,
  ) {
    const user = (req as unknown as { user?: IJwtPayload }).user;
    return this.discoverService.search(query, user?.sub);
  }

  @Public()
  @Get('businesses/:slug')
  @ApiOperation({ summary: 'Get business details (contact info locked until purchased)' })
  @ApiResponse({ status: 200, description: 'Business detail profile with masked/unmasked contacts' })
  @ApiResponse({ status: 404, description: 'Business not found' })
  async getBusinessBySlug(
    @Param('slug') slug: string,
    @Req() req: Request,
  ) {
    const user = (req as unknown as { user?: IJwtPayload }).user;
    return this.discoverService.getBusinessBySlug(slug, user?.sub);
  }

  @Public()
  @Get('businesses/:slug/related')
  @ApiOperation({ summary: 'Get related businesses in the same industry/region' })
  @ApiResponse({ status: 200, description: 'List of related businesses' })
  async getRelatedBusinesses(
    @Param('slug') slug: string,
    @Query('limit') limit?: number,
  ) {
    return this.discoverService.getRelatedBusinesses(slug, limit ? Number(limit) : 4);
  }

  @Public()
  @Get('suggestions')
  @ApiOperation({ summary: 'Get autocomplete search suggestions' })
  @ApiQuery({ name: 'q', required: false, description: 'Prefix query' })
  async getSuggestions(@Query() query: DiscoverSuggestionsDto) {
    return this.discoverService.getSuggestions(query.q);
  }
}
