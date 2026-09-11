import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { SavedSearchesRepository } from './saved-searches.repository';
import { CreateSavedSearchDto, UpdateSavedSearchDto } from './dto/saved-searches.dto';
import { DiscoverService } from '../discover/discover.service';
import { BusinessException } from '../../common/errors/business.exception';

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
      filters: dto.filters,
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
      filters: dto.filters !== undefined ? dto.filters : existing.filters,
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
    const filterQuery = (saved.filters as Record<string, any>) || {};
    return this.discoverService.search(filterQuery, userId);
  }
}
