import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SavedLeadsService } from './saved-leads.service';
import {
  SaveLeadDto,
  UpdateSavedLeadDto,
  BulkSaveLeadsDto,
  BulkDeleteLeadsDto,
  QuerySavedLeadsDto,
} from './dto/saved-leads.dto';
import { CurrentUser } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IJwtPayload } from '@orion/shared';

@ApiTags('Saved Leads')
@Controller('saved-leads')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SavedLeadsController {
  constructor(private readonly savedLeadsService: SavedLeadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save a business to pipeline / leads' })
  @ApiResponse({ status: 201, description: 'Lead saved successfully' })
  async saveLead(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: SaveLeadDto,
  ) {
    return this.savedLeadsService.saveLead(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List saved leads with filtering by stage, tags, or search' })
  @ApiResponse({ status: 200, description: 'Paginated saved leads' })
  async getSavedLeads(
    @CurrentUser() user: IJwtPayload,
    @Query() query: QuerySavedLeadsDto,
  ) {
    return this.savedLeadsService.getSavedLeads(user.sub, query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update tags, notes, or stage of a saved lead' })
  @ApiResponse({ status: 200, description: 'Lead updated' })
  async updateSavedLead(
    @CurrentUser() user: IJwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSavedLeadDto,
  ) {
    return this.savedLeadsService.updateSavedLead(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a lead by ID or business ID' })
  @ApiResponse({ status: 200, description: 'Lead removed' })
  async removeLead(
    @CurrentUser() user: IJwtPayload,
    @Param('id') id: string,
  ) {
    return this.savedLeadsService.removeLead(user.sub, id);
  }

  @Post('bulk-save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk save multiple businesses' })
  @ApiResponse({ status: 200, description: 'Businesses saved' })
  async bulkSave(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: BulkSaveLeadsDto,
  ) {
    return this.savedLeadsService.bulkSave(user.sub, dto);
  }

  @Post('bulk-delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk remove multiple saved leads' })
  @ApiResponse({ status: 200, description: 'Leads removed' })
  async bulkDelete(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: BulkDeleteLeadsDto,
  ) {
    return this.savedLeadsService.bulkDelete(user.sub, dto);
  }
}
