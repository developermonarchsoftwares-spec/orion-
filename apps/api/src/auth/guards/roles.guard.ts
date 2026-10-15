import { Inject, Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { UserRole, IJwtPayload } from '@orion/shared';
import { ROLES_KEY } from '../decorators';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import { users } from '../../database/schema';

/**
 * Role-protected routes are authorised against the PERSISTED role and status, not the role claim inside the token: a demoted,
 * suspended or deleted administrator loses access immediately instead of when the token expires, and a token can never grant a
 * role the account does not hold. Fails closed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: IJwtPayload }>();

    if (!user || !user.sub) {
      throw new ForbiddenException('Access denied: User role not present in security context');
    }

    let persisted: { role: string; status: string } | undefined;
    try {
      [persisted] = await this.db.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, user.sub)).limit(1);
    } catch {
      throw new ForbiddenException('Access denied: Unable to verify role');
    }
    if (!persisted || persisted.status !== 'ACTIVE') {
      throw new ForbiddenException('Access denied: Account is not active');
    }

    // SUPER_ADMIN has access to all roles
    if (persisted.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    if (!requiredRoles.includes(persisted.role as UserRole)) {
      throw new ForbiddenException(`Access denied: Required role(s) [${requiredRoles.join(', ')}]`);
    }

    return true;
  }
}
