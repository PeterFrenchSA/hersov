import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { EnrichmentRunStatus } from '@prisma/client';
import {
  createEnrichmentRunSchema,
  enrichmentProviderCatalog,
  enrichmentRunsQuerySchema,
  enrichmentRunResultsQuerySchema,
  type CreateEnrichmentRunInput,
  type EnrichmentProviderName,
  type EnrichmentProviderStatus,
  type EnrichmentRunIdParamInput,
  type EnrichmentRunResultsQueryInput,
  type EnrichmentRunsQueryInput,
} from '@hersov/shared';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImportQueueService } from '../import/import-queue.service';

export interface RunCounters {
  totalTargets: number;
  processedTargets: number;
  updatedContacts: number;
  skippedContacts: number;
  errorCount: number;
}

@Injectable()
export class EnrichmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly queueService: ImportQueueService,
  ) {}

  getProviderStatuses(): EnrichmentProviderStatus[] {
    return (Object.keys(enrichmentProviderCatalog) as EnrichmentProviderName[]).map((providerName) => {
      const metadata = enrichmentProviderCatalog[providerName];
      const envVar = metadata.envVar;
      const configured = envVar ? Boolean(process.env[envVar]?.trim()) : true;
      const enabled = providerName === 'mock' ? true : configured;

      const providerUpper = providerName.toUpperCase();
      const rpm = this.parsePositiveInt(
        process.env[`ENRICHMENT_PROVIDER_${providerUpper}_RPM`],
        metadata.defaultRpm,
      );
      const concurrency = this.parsePositiveInt(
        process.env[`ENRICHMENT_PROVIDER_${providerUpper}_CONCURRENCY`],
        metadata.defaultConcurrency,
      );

      return {
        name: providerName,
        label: metadata.label,
        configured,
        enabled,
        envVar,
        supportsFields: metadata.supportsFields,
        rateLimit: {
          rpm,
          concurrency,
        },
      };
    });
  }

  async createRun(
    input: CreateEnrichmentRunInput,
    actorUserId: string,
    ip?: string,
  ): Promise<{ id: string; status: string }> {
    const parsedInput = createEnrichmentRunSchema.parse(input);
    const providerStatuses = this.getProviderStatuses();

    const unavailableProvider = parsedInput.providers.find((providerName) => {
      const status = providerStatuses.find((item) => item.name === providerName);
      return !status || !status.enabled;
    });

    if (unavailableProvider) {
      throw new BadRequestException(`Provider ${unavailableProvider} is not configured/enabled`);
    }

    const runId = randomUUID();

    await this.prisma.enrichmentRun.create({
      data: {
        id: runId,
        status: EnrichmentRunStatus.QUEUED,
        createdByUserId: actorUserId,
        configJson: parsedInput as unknown as Prisma.InputJsonValue,
        statsJson: {
          providers: parsedInput.providers,
          mergePolicy: parsedInput.mergePolicy,
          dryRun: parsedInput.dryRun,
        },
        totalTargets: 0,
        processedTargets: 0,
        updatedContacts: 0,
        skippedContacts: 0,
        errorCount: 0,
      },
    });

    await this.queueService.enqueueEnrichmentRun(runId);

    await this.auditService.log({
      actorUserId,
      action: 'enrichment.run_created',
      entityType: 'enrichment_run',
      entityId: runId,
      ip,
      metaJson: {
        providers: parsedInput.providers,
        mergePolicy: parsedInput.mergePolicy,
        dryRun: parsedInput.dryRun,
      },
    });

    return {
      id: runId,
      status: 'queued',
    };
  }

  async listRuns(queryInput: EnrichmentRunsQueryInput): Promise<{
    data: Array<{
      id: string;
      status: string;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      providers: string[];
      mergePolicy: string;
      dryRun: boolean;
      counters: RunCounters;
    }>;
    pagination: { page: number; pageSize: number; total: number };
  }> {
    const query = enrichmentRunsQuerySchema.parse(queryInput);

    const where: Prisma.EnrichmentRunWhereInput = {
      status: query.status ? this.toRunStatus(query.status) : undefined,
    };

    const [total, runs] = await this.prisma.$transaction([
      this.prisma.enrichmentRun.count({ where }),
      this.prisma.enrichmentRun.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: runs.map((run) => {
        const config = this.parseRunConfig(run.configJson);

        return {
          id: run.id,
          status: run.status.toLowerCase(),
          createdAt: run.createdAt.toISOString(),
          startedAt: run.startedAt ? run.startedAt.toISOString() : null,
          finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
          providers: config?.providers ?? [],
          mergePolicy: config?.mergePolicy ?? 'fill_missing_only',
          dryRun: config?.dryRun ?? false,
          counters: {
            totalTargets: run.totalTargets,
            processedTargets: run.processedTargets,
            updatedContacts: run.updatedContacts,
            skippedContacts: run.skippedContacts,
            errorCount: run.errorCount,
          },
        };
      }),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
    };
  }

  async getRun(params: EnrichmentRunIdParamInput): Promise<{
    id: string;
    status: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    config: CreateEnrichmentRunInput | null;
    counters: RunCounters;
    errorSamples: Array<{ rowIndex: number; message: string }>;
  }> {
    const run = await this.prisma.enrichmentRun.findUnique({
      where: { id: params.id },
    });

    if (!run) {
      throw new NotFoundException('Enrichment run not found');
    }

    const config = this.parseRunConfig(run.configJson);

    return {
      id: run.id,
      status: run.status.toLowerCase(),
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt ? run.startedAt.toISOString() : null,
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      config,
      counters: {
        totalTargets: run.totalTargets,
        processedTargets: run.processedTargets,
        updatedContacts: run.updatedContacts,
        skippedContacts: run.skippedContacts,
        errorCount: run.errorCount,
      },
      errorSamples: this.extractErrorSamples(run.errorSampleJson),
    };
  }

  async getRunResults(
    params: EnrichmentRunIdParamInput,
    queryInput: EnrichmentRunResultsQueryInput,
  ): Promise<{
    data: Array<{
      id: string;
      contactId: string;
      contactName: string | null;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      confidence: number | null;
      provider: string;
      providerRef: string | null;
      evidenceUrl: string | null;
      createdAt: string;
    }>;
    pagination: { page: number; pageSize: number; total: number };
  }> {
    const query = enrichmentRunResultsQuerySchema.parse(queryInput);

    const run = await this.prisma.enrichmentRun.findUnique({ where: { id: params.id } });
    if (!run) {
      throw new NotFoundException('Enrichment run not found');
    }

    const where: Prisma.EnrichmentResultWhereInput = {
      runId: params.id,
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.enrichmentResult.count({ where }),
      this.prisma.enrichmentResult.findMany({
        where,
        include: {
          contact: {
            select: {
              fullName: true,
            },
          },
        },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        contactId: row.contactId,
        contactName: row.contact.fullName,
        field: row.field,
        oldValue: row.oldValue,
        newValue: row.newValue,
        confidence: row.confidence,
        provider: row.provider,
        providerRef: row.providerRef,
        evidenceUrl: row.evidenceUrl,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
    };
  }

  async cancelRun(
    params: EnrichmentRunIdParamInput,
    actorUserId: string,
    ip?: string,
  ): Promise<{ id: string; status: string }> {
    const run = await this.prisma.enrichmentRun.findUnique({ where: { id: params.id } });
    if (!run) {
      throw new NotFoundException('Enrichment run not found');
    }

    if (run.status !== EnrichmentRunStatus.QUEUED && run.status !== EnrichmentRunStatus.PROCESSING) {
      return {
        id: run.id,
        status: run.status.toLowerCase(),
      };
    }

    const updated = await this.prisma.enrichmentRun.update({
      where: { id: params.id },
      data: {
        status: EnrichmentRunStatus.CANCELED,
        finishedAt: new Date(),
      },
    });

    await this.auditService.log({
      actorUserId,
      action: 'enrichment.run_canceled',
      entityType: 'enrichment_run',
      entityId: run.id,
      ip,
    });

    return {
      id: updated.id,
      status: updated.status.toLowerCase(),
    };
  }

  private parseRunConfig(value: Prisma.JsonValue | null): CreateEnrichmentRunInput | null {
    const parsed = createEnrichmentRunSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private toRunStatus(status: EnrichmentRunsQueryInput['status']): EnrichmentRunStatus | undefined {
    if (!status) {
      return undefined;
    }

    const statusMap: Record<Exclude<EnrichmentRunsQueryInput['status'], undefined>, EnrichmentRunStatus> = {
      queued: EnrichmentRunStatus.QUEUED,
      processing: EnrichmentRunStatus.PROCESSING,
      completed: EnrichmentRunStatus.COMPLETED,
      failed: EnrichmentRunStatus.FAILED,
      canceled: EnrichmentRunStatus.CANCELED,
    };

    return statusMap[status];
  }

  private extractErrorSamples(value: Prisma.JsonValue | null): Array<{ rowIndex: number; message: string }> {
    if (!Array.isArray(value)) {
      return [];
    }

    const output: Array<{ rowIndex: number; message: string }> = [];

    for (const entry of value) {
      if (typeof entry !== 'object' || !entry) {
        continue;
      }

      const rowIndex = Number((entry as { rowIndex?: unknown }).rowIndex);
      const message = (entry as { message?: unknown }).message;

      if (Number.isFinite(rowIndex) && typeof message === 'string') {
        output.push({ rowIndex, message });
      }
    }

    return output;
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return Math.floor(parsed);
  }
}
