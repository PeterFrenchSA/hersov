import 'express-session';
import type { AppRole } from '@hersov/shared';

declare module 'express-session' {
  interface SessionData {
    user?: {
      id: string;
      email: string;
      role: AppRole;
    };
  }
}
