import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SavedSearchesService } from './saved-searches.service';
import { CreateSavedSearchDto, UpdateSavedSearchDto } from './dto/saved-searches.dto';
import { CurrentUser } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IJwtPayload } from '@orion/shared';

@ApiTags('Saved Searches')
@Controller('saved-searches')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SavedSearchesController {
  constructor(private readonly savedSearchesService: SavedSearchesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save a search query with filters and alert options' })
  @ApiResponse({ status: 201, description: 'Saved search created' })
  async create(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: CreateSavedSearchDto,
  ) {
    return this.savedSearchesService.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all saved searches for the current user' })
  @ApiResponse({ status: 200, description: 'List of saved searches' })
  async findAll(@CurrentUser() user: IJwtPayload) {
    return this.savedSearchesService.findAll(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get saved search details' })
  @ApiResponse({ status: 200, description: 'Saved search' })
  async findById(
    @CurrentUser() user: IJwtPayload,
    @Param('id') id: string,
  ) {
    return this.savedSearchesService.findById(user.sub, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update saved search details or notification toggle' })
  @ApiResponse({ status: 200, description: 'Updated search' })
  async update(
    @CurrentUser() user: IJwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSavedSearchDto,
  ) {
    return this.savedSearchesService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a saved search' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  async delete(
    @CurrentUser() user: IJwtPayload,
    @Param('id') id: string,
  ) {
    return this.savedSearchesService.delete(user.sub, id);
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute a saved search and return matching businesses' })
  @ApiResponse({ status: 200, description: 'Search results' })
  async runSearch(
    @CurrentUser() user: IJwtPayload,
    @Param('id') id: string,
  ) {
    return this.savedSearchesService.runSearch(user.sub, id);
  }
}
