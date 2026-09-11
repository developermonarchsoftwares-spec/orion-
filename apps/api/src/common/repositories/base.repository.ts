import { Inject, Injectable } from '@nestjs/common';
import { SQL, eq, count } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import { IPaginationMeta } from '@orion/shared';

export interface IFindManyOptions {
  limit?: number;
  offset?: number;
  where?: SQL;
  orderBy?: SQL | SQL[];
}

export interface IPaginatedResult<T> {
  items: T[];
  pagination: IPaginationMeta;
}

@Injectable()
export abstract class BaseRepository<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TTable extends PgTable<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TSelect = any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TInsert = any,
> {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    protected readonly db: DrizzleDb,
    protected readonly table: TTable,
  ) {}

  async findById(id: string): Promise<TSelect | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const idColumn = (this.table as any).id;
    if (!idColumn) {
      throw new Error(`Table does not have an 'id' column`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any = await (this.db as any)
      .select()
      .from(this.table)
      .where(eq(idColumn, id))
      .limit(1);

    return (rows[0] as TSelect) || null;
  }

  async findMany(options: IFindManyOptions = {}): Promise<TSelect[]> {
    const { limit = 20, offset = 0, where, orderBy } = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = (this.db as any).select().from(this.table);

    if (where) {
      query = query.where(where);
    }

    if (orderBy) {
      const orderArgs = Array.isArray(orderBy) ? orderBy : [orderBy];
      query = query.orderBy(...orderArgs);
    }

    query = query.limit(limit).offset(offset);

    const rows = await query;
    return rows as TSelect[];
  }

  async findPaginated(
    page = 1,
    limit = 20,
    where?: SQL,
    orderBy?: SQL | SQL[],
  ): Promise<IPaginatedResult<TSelect>> {
    const offset = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let countQuery: any = (this.db as any).select({ total: count() }).from(this.table);
    if (where) {
      countQuery = countQuery.where(where);
    }

    const [totalResult] = await countQuery;
    const totalItems = Number(totalResult?.total || 0);
    const totalPages = Math.ceil(totalItems / limit) || 1;

    const items = await this.findMany({
      limit,
      offset,
      where,
      orderBy,
    });

    return {
      items,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async create(data: TInsert): Promise<TSelect> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any = await (this.db as any).insert(this.table).values(data).returning();
    return rows[0] as TSelect;
  }

  async createMany(data: TInsert[]): Promise<TSelect[]> {
    if (data.length === 0) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any = await (this.db as any).insert(this.table).values(data).returning();
    return rows as TSelect[];
  }

  async updateById(id: string, data: Partial<TInsert>): Promise<TSelect | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const idColumn = (this.table as any).id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any = await (this.db as any)
      .update(this.table)
      .set(data)
      .where(eq(idColumn, id))
      .returning();

    return (rows[0] as TSelect) || null;
  }

  async deleteById(id: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const idColumn = (this.table as any).id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await (this.db as any)
      .delete(this.table)
      .where(eq(idColumn, id));

    return (result.rowCount ?? 0) > 0;
  }
}
