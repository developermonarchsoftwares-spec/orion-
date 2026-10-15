import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { SavedSearchesRepository } from './saved-searches.repository';
import { CreateSavedSearchDto, UpdateSavedSearchDto } from './dto/saved-searches.dto';
import { DiscoverService } from '../discover/discover.service';
import { BusinessException } from '../../common/errors/business.exception';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DiscoverSearchQueryDto } from '../discover/dto/discover.dto';

/** A saved search is a handful of filters; anything near this size is not one. */
const MAX_FILTERS_JSON = 20_000;

/**
 * Saved filters are stored as free-form JSON and re-run later, so they get the same checks as a live search request (lengths, types,
 * ranges) when they are saved and again when they are run. Unknown keys are allowed (they are ignored by the search), so no
 * existing filter is dropped; a value that is wrong for a known filter is refused with the names of the offending fields.
 */
export function checkedSearchFilters(filters: unknown): DiscoverSearchQueryDto {
  const raw = filters && typeof filters === 'object' && !Array.isArray(filters) ? (filters as Record<string, unknown>) : {};
  if (JSON.stringify(raw).length > MAX_FILTERS_JSON) {
    throw new BusinessException('The saved filters are too large', 'INVALID_SAVED_FILTERS', HttpStatus.BAD_REQUEST);
  }
  const dto = plainToInstance(DiscoverSearchQueryDto, raw);
  const errors = validateSync(dto, { whitelist: false, forbidNonWhitelisted: false });
  if (errors.length) {
    throw new BusinessException('Some saved filters are not valid', 'INVALID_SAVED_FILTERS', HttpStatus.BAD_REQUEST, { fields: errors.map((e) => e.property) });
  }
  return dto;
}

@Injectable()
export class SavedSearchesService {
  private readonly logger = new Logger(SavedSearchesService.name);

  constructor(
    private readonly savedSearchesRepo: SavedSearchesRepository,
    private readonly discoverService: DiscoverService,
  ) {}

  async create(userId: string, dto: CreateSavedSearchDto) {
    return this.savedSearchesRepo.create({
      userId,
      name: dto.name.trim(),
      filters: (checkedSearchFilters(dto.filters), dto.filters),
      alertEnabled: dto.alertEnabled ?? false,
      alertFrequency: dto.alertFrequency ?? 'DAILY',
    });
  }

  async findAll(userId: string) {
    return this.savedSearchesRepo.findByUser(userId);
  }

  async findById(userId: string, id: string) {
    const search = await this.savedSearchesRepo.findById(id);
    if (!search || search.userId !== userId) {
      throw new BusinessException('Saved search not found', 'SEARCH_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    return search;
  }

  async update(userId: string, id: string, dto: UpdateSavedSearchDto) {
    const existing = await this.findById(userId, id);

    const updated = await this.savedSearchesRepo.updateById(existing.id, {
      name: dto.name !== undefined ? dto.name.trim() : existing.name,
      filters: dto.filters !== undefined ? (checkedSearchFilters(dto.filters), dto.filters) : existing.filters,
      alertEnabled: dto.alertEnabled !== undefined ? dto.alertEnabled : existing.alertEnabled,
      alertFrequency: dto.alertFrequency !== undefined ? dto.alertFrequency : existing.alertFrequency,
      updatedAt: new Date(),
    });

    return updated;
  }

  async delete(userId: string, id: string) {
    await this.findById(userId, id);
    await this.savedSearchesRepo.deleteById(id);
    return { success: true, message: 'Saved search deleted' };
  }

  async runSearch(userId: string, id: string) {
    const saved = await this.findById(userId, id);
    // the stored filters pass through the same validation as a live search before they are run
    return this.discoverService.search(checkedSearchFilters(saved.filters), userId);
  }
}
