import { SetMetadata } from '@nestjs/common';
import type { AppRole } from '@hersov/shared';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
