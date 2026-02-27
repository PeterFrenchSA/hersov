import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from '../common/password.util';

async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();

  if (!email || !password) {
    console.log('Bootstrap skipped: BOOTSTRAP_ADMIN_EMAIL or BOOTSTRAP_ADMIN_PASSWORD not set.');
    return;
  }

  const prisma = new PrismaClient();

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log('Bootstrap skipped: admin user already exists.');
      return;
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: Role.Admin,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'auth.bootstrap_admin',
        entityType: 'user',
        entityId: user.id,
      },
    });

    console.log(`Bootstrap complete: created admin user ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Bootstrap failed', error);
  process.exit(1);
});
