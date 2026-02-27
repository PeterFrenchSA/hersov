import { Injectable, NotFoundException } from '@nestjs/common';
import type { ContactPatchInput, ContactsQueryInput } from '@hersov/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ContactsQueryInput): Promise<{
    data: unknown[];
    pagination: { page: number; pageSize: number; total: number };
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const q = query.q?.trim();

    const where = q
      ? {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' as const } },
            { firstName: { contains: q, mode: 'insensitive' as const } },
            { lastName: { contains: q, mode: 'insensitive' as const } },
            { currentCompany: { is: { name: { contains: q, mode: 'insensitive' as const } } } },
          ],
        }
      : undefined;

    const [total, contacts] = await this.prisma.$transaction([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
        include: {
          currentCompany: true,
          contactMethods: true,
        },
      }),
    ]);

    return {
      data: contacts,
      pagination: {
        page,
        pageSize,
        total,
      },
    };
  }

  async getById(id: string): Promise<unknown> {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: {
        currentCompany: true,
        contactMethods: true,
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    return contact;
  }

  async update(
    id: string,
    payload: ContactPatchInput,
    actorUserId: string,
    ip?: string,
  ): Promise<unknown> {
    const existing = await this.prisma.contact.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Contact not found');
    }

    const updated = await this.prisma.contact.update({
      where: { id },
      data: {
        firstName: payload.firstName,
        lastName: payload.lastName,
        fullName: payload.fullName,
        notesRaw: payload.notesRaw,
        locationCity: payload.locationCity,
        locationCountry: payload.locationCountry,
        currentTitle: payload.currentTitle,
        currentCompanyId: payload.currentCompanyId,
      },
      include: {
        currentCompany: true,
        contactMethods: true,
      },
    });

    await this.auditService.log({
      actorUserId,
      action: 'contacts.update',
      entityType: 'contact',
      entityId: id,
      ip,
      metaJson: {
        updatedFields: Object.keys(payload),
      },
    });

    return updated;
  }
}
