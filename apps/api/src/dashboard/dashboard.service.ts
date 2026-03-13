import { Injectable } from '@nestjs/common';
import { ContactMethodType, ImportBatchStatus, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(): Promise<{
    totalContacts: number;
    missingEmail: number;
    missingLinkedin: number;
    missingLocation: number;
    pendingReviewItems: number;
    topConnectors: Array<{ contactId: string; fullName: string; connectorScore: number }>;
    recentImports: Array<{ id: string; filename: string; status: string; processedRows: number; createdAt: string }>;
    recentEnrichmentRuns: Array<{ id: string; status: string; updatedContacts: number; createdAt: string }>;
  }> {
    const [
      totalContacts,
      missingEmail,
      missingLinkedin,
      missingLocation,
      pendingReviewItems,
      topConnectors,
      recentImports,
      recentEnrichmentRuns,
    ] = await Promise.all([
      this.prisma.contact.count(),
      this.prisma.contact.count({
        where: {
          contactMethods: {
              none: {
              type: ContactMethodType.EMAIL,
            },
          },
        },
      }),
      this.prisma.contact.count({
        where: {
          contactMethods: {
              none: {
              type: ContactMethodType.LINKEDIN,
            },
          },
        },
      }),
      this.prisma.contact.count({
        where: {
          OR: [
            { locationCity: null },
            { locationCountry: null },
          ],
        },
      }),
      this.prisma.reviewQueue.count({
        where: {
          status: ReviewStatus.PENDING,
        },
      }),
      this.prisma.contactScore.findMany({
        orderBy: {
          connectorScore: 'desc',
        },
        take: 5,
        include: {
          contact: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
      }),
      this.prisma.importBatch.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 5,
      }),
      this.prisma.enrichmentRun.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 5,
      }),
    ]);

    return {
      totalContacts,
      missingEmail,
      missingLinkedin,
      missingLocation,
      pendingReviewItems,
      topConnectors: topConnectors.map((row) => ({
        contactId: row.contact.id,
        fullName: row.contact.fullName,
        connectorScore: row.connectorScore,
      })),
      recentImports: recentImports.map((row) => ({
        id: row.id,
        filename: row.filename,
        status: importBatchStatusToApi(row.status),
        processedRows: row.processedRows,
        createdAt: row.createdAt.toISOString(),
      })),
      recentEnrichmentRuns: recentEnrichmentRuns.map((row) => ({
        id: row.id,
        status: row.status.toLowerCase(),
        updatedContacts: row.updatedContacts,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}

function importBatchStatusToApi(value: ImportBatchStatus): string {
  return value.toLowerCase();
}
