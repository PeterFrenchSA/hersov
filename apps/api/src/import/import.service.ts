import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ImportBatchStatus, ImportRowOutcome } from '@prisma/client';
import {
  importColumnMappingSchema,
  importResultsQuerySchema,
  type ImportBatchIdParamInput,
  type ImportColumnMappingInput,
  type ImportResultsQueryInput,
} from '@hersov/shared';
import { extname, join } from 'node:path';
import { open, mkdir, rename, copyFile, unlink } from 'node:fs/promises';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImportQueueService } from './import-queue.service';

const HEADER_DELIMITER_CANDIDATES = [',', ';', '|', '\t'] as const;
const DEFAULT_IMPORT_MAX_UPLOAD_MB = 50;

interface ErrorSampleEntry {
  rowIndex: number;
  message: string;
}

interface UploadBatchResult {
  batchId: string;
  headersDetected: string[];
  detectedCsvDelimiter: ',' | ';' | '|' | '\t';
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly importQueueService: ImportQueueService,
  ) {}

  getImportMaxUploadBytes(): number {
    const maxUploadMb = Number(process.env.IMPORT_MAX_UPLOAD_MB ?? DEFAULT_IMPORT_MAX_UPLOAD_MB);
    const safeMaxUploadMb = Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : DEFAULT_IMPORT_MAX_UPLOAD_MB;
    return Math.floor(safeMaxUploadMb * 1024 * 1024);
  }

  async createBatchFromUpload(
    file: Express.Multer.File,
    userId: string,
    ip?: string,
  ): Promise<UploadBatchResult> {
    if (!file?.path) {
      throw new BadRequestException('CSV file is required');
    }

    if (extname(file.originalname).toLowerCase() !== '.csv') {
      throw new BadRequestException('Only .csv files are supported');
    }

    const batchId = randomUUID();
    const importDir = this.getImportDirectory();
    const finalPath = join(importDir, `${batchId}.csv`);

    await mkdir(importDir, { recursive: true });
    await this.moveFile(file.path, finalPath);

    let headers: string[] = [];
    let delimiter: ',' | ';' | '|' | '\t' = ',';
    try {
      const parsed = await this.parseHeadersFromFile(finalPath);
      headers = parsed.headers;
      delimiter = parsed.delimiter;
    } catch (error) {
      await unlink(finalPath).catch(() => undefined);
      throw error;
    }

    await this.prisma.importBatch.create({
      data: {
        id: batchId,
        filename: file.originalname,
        originalHeadersJson: headers,
        status: ImportBatchStatus.QUEUED,
        createdByUserId: userId,
        totalRows: 0,
        processedRows: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        duplicateCount: 0,
        errorCount: 0,
        errorSampleJson: [],
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'import.upload',
      entityType: 'import_batch',
      entityId: batchId,
      ip,
      metaJson: {
        filename: file.originalname,
        headers,
      },
    });

    return {
      batchId,
      headersDetected: headers,
      detectedCsvDelimiter: delimiter,
    };
  }

  async saveMapping(
    params: ImportBatchIdParamInput,
    mappingInput: ImportColumnMappingInput,
    userId: string,
    ip?: string,
  ): Promise<{ batchId: string; status: string }> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: params.batchId } });
    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }

    if (batch.status === ImportBatchStatus.PROCESSING) {
      throw new BadRequestException('Cannot change mapping while batch is processing');
    }

    const parsedMapping = importColumnMappingSchema.parse(mappingInput);
    const headers = this.extractHeaders(batch.originalHeadersJson);

    for (const header of Object.values(parsedMapping.mapping)) {
      if (!header) {
        continue;
      }

      if (!headers.includes(header)) {
        throw new BadRequestException(`Mapped header \"${header}\" is not present in uploaded CSV headers`);
      }
    }

    await this.prisma.importBatch.update({
      where: { id: params.batchId },
      data: {
        columnMappingJson: parsedMapping as unknown as Prisma.InputJsonValue,
        status: ImportBatchStatus.QUEUED,
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'import.mapping_saved',
      entityType: 'import_batch',
      entityId: params.batchId,
      ip,
    });

    return {
      batchId: params.batchId,
      status: 'queued',
    };
  }

  async startBatch(
    params: ImportBatchIdParamInput,
    userId: string,
    ip?: string,
  ): Promise<{ batchId: string; status: string }> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: params.batchId } });
    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }

    if (!batch.columnMappingJson) {
      throw new BadRequestException('Column mapping must be saved before starting import');
    }

    try {
      importColumnMappingSchema.parse(batch.columnMappingJson);
    } catch {
      throw new BadRequestException('Column mapping is invalid. Save mapping again before starting import.');
    }

    if (batch.status === ImportBatchStatus.PROCESSING) {
      return { batchId: params.batchId, status: 'processing' };
    }

    if (batch.status === ImportBatchStatus.COMPLETED) {
      throw new BadRequestException('Import batch is already completed');
    }

    await this.prisma.importBatch.update({
      where: { id: params.batchId },
      data: {
        status: ImportBatchStatus.PROCESSING,
        startedAt: new Date(),
        finishedAt: null,
        totalRows: 0,
        processedRows: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        duplicateCount: 0,
        errorCount: 0,
        errorSampleJson: [],
      },
    });

    await this.importQueueService.enqueueImportBatch(params.batchId);

    await this.auditService.log({
      actorUserId: userId,
      action: 'import.started',
      entityType: 'import_batch',
      entityId: params.batchId,
      ip,
    });

    return {
      batchId: params.batchId,
      status: 'processing',
    };
  }

  async getStatus(params: ImportBatchIdParamInput): Promise<{
    batchId: string;
    status: string;
    totalRows: number;
    processedRows: number;
    insertedCount: number;
    updatedCount: number;
    skippedCount: number;
    duplicateCount: number;
    errorCount: number;
    percentComplete: number;
    startedAt: string | null;
    finishedAt: string | null;
  }> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: params.batchId } });
    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }

    const percentComplete = batch.totalRows > 0 ? Math.min(100, (batch.processedRows / batch.totalRows) * 100) : 0;

    return {
      batchId: batch.id,
      status: batch.status.toLowerCase(),
      totalRows: batch.totalRows,
      processedRows: batch.processedRows,
      insertedCount: batch.insertedCount,
      updatedCount: batch.updatedCount,
      skippedCount: batch.skippedCount,
      duplicateCount: batch.duplicateCount,
      errorCount: batch.errorCount,
      percentComplete: Number(percentComplete.toFixed(2)),
      startedAt: batch.startedAt ? batch.startedAt.toISOString() : null,
      finishedAt: batch.finishedAt ? batch.finishedAt.toISOString() : null,
    };
  }

  async getResults(params: ImportBatchIdParamInput, queryInput: ImportResultsQueryInput): Promise<{
    batchId: string;
    status: string;
    storageMode: 'rows' | 'summary';
    summary: {
      insertedCount: number;
      updatedCount: number;
      skippedCount: number;
      duplicateCount: number;
      errorCount: number;
    };
    pagination: { page: number; pageSize: number; total: number };
    data: Array<Record<string, unknown>>;
  }> {
    const query = importResultsQuerySchema.parse(queryInput);
    const batch = await this.prisma.importBatch.findUnique({ where: { id: params.batchId } });

    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }

    const summary = {
      insertedCount: batch.insertedCount,
      updatedCount: batch.updatedCount,
      skippedCount: batch.skippedCount,
      duplicateCount: batch.duplicateCount,
      errorCount: batch.errorCount,
    };

    const storeRawRows = this.shouldStoreRawRows();

    if (!storeRawRows) {
      const errorSamples = this.extractErrorSamples(batch.errorSampleJson);
      const synthesizedRows =
        query.outcome && query.outcome !== 'error'
          ? []
          : errorSamples.map((sample) => ({
              rowIndex: sample.rowIndex,
              outcome: 'error',
              errorMessage: sample.message,
            }));

      const total = query.outcome
        ? this.countByOutcome(summary, query.outcome)
        : errorSamples.length;

      const startIndex = (query.page - 1) * query.pageSize;
      const pagedRows = synthesizedRows.slice(startIndex, startIndex + query.pageSize);

      return {
        batchId: batch.id,
        status: batch.status.toLowerCase(),
        storageMode: 'summary',
        summary,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
        },
        data: pagedRows,
      };
    }

    const where: Prisma.ImportRowWhereInput = {
      batchId: params.batchId,
      outcome: query.outcome ? this.toImportRowOutcome(query.outcome) : undefined,
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.importRow.count({ where }),
      this.prisma.importRow.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { rowIndex: 'asc' },
      }),
    ]);

    return {
      batchId: batch.id,
      status: batch.status.toLowerCase(),
      storageMode: 'rows',
      summary,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
      data: rows.map((row) => ({
        id: row.id.toString(),
        rowIndex: row.rowIndex,
        outcome: row.outcome.toLowerCase(),
        contactId: row.contactId,
        errorMessage: row.errorMessage,
        rawJson: row.rawJson,
        normalizedJson: row.normalizedJson,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private toImportRowOutcome(outcome: ImportResultsQueryInput['outcome']): ImportRowOutcome | undefined {
    if (!outcome) {
      return undefined;
    }

    const mapping: Record<string, ImportRowOutcome> = {
      inserted: ImportRowOutcome.INSERTED,
      updated: ImportRowOutcome.UPDATED,
      skipped: ImportRowOutcome.SKIPPED,
      duplicate: ImportRowOutcome.DUPLICATE,
      error: ImportRowOutcome.ERROR,
    };

    return mapping[outcome];
  }

  private countByOutcome(
    summary: {
      insertedCount: number;
      updatedCount: number;
      skippedCount: number;
      duplicateCount: number;
      errorCount: number;
    },
    outcome: NonNullable<ImportResultsQueryInput['outcome']>,
  ): number {
    const mapping: Record<NonNullable<ImportResultsQueryInput['outcome']>, number> = {
      inserted: summary.insertedCount,
      updated: summary.updatedCount,
      skipped: summary.skippedCount,
      duplicate: summary.duplicateCount,
      error: summary.errorCount,
    };

    return mapping[outcome];
  }

  private extractHeaders(value: Prisma.JsonValue): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
  }

  private extractErrorSamples(value: Prisma.JsonValue | null): ErrorSampleEntry[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const samples: ErrorSampleEntry[] = [];
    for (const item of value) {
      if (typeof item !== 'object' || !item) {
        continue;
      }

      const rowIndex = Number((item as { rowIndex?: unknown }).rowIndex);
      const message = (item as { message?: unknown }).message;

      if (Number.isFinite(rowIndex) && typeof message === 'string') {
        samples.push({ rowIndex, message });
      }
    }

    return samples;
  }

  private shouldStoreRawRows(): boolean {
    return (process.env.IMPORT_STORE_RAW_ROWS ?? 'false').toLowerCase() === 'true';
  }

  private getImportDirectory(): string {
    return process.env.IMPORT_DATA_DIR ?? '/data/imports';
  }

  private async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      await rename(sourcePath, destinationPath);
    } catch {
      await copyFile(sourcePath, destinationPath);
      await unlink(sourcePath);
    }
  }

  private async parseHeadersFromFile(filePath: string): Promise<{ headers: string[]; delimiter: ',' | ';' | '|' | '\t' }> {
    const firstLine = await this.readHeaderLine(filePath);
    if (!firstLine.trim()) {
      throw new BadRequestException('Uploaded CSV is empty');
    }

    const delimiter = this.detectDelimiter(firstLine);

    const records = parseCsvSync(firstLine, {
      delimiter,
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
    }) as string[][];

    if (!records.length || !records[0].length) {
      throw new BadRequestException('Could not detect CSV headers');
    }

    const headers = records[0].map((header) => header.trim()).filter((header) => header.length > 0);

    if (headers.length === 0) {
      throw new BadRequestException('Could not detect CSV headers');
    }

    return {
      headers,
      delimiter,
    };
  }

  private async readHeaderLine(filePath: string): Promise<string> {
    const fileHandle = await open(filePath, 'r');
    const buffer = Buffer.alloc(256 * 1024);

    try {
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
      const content = buffer.toString('utf8', 0, bytesRead);
      const line = content.split(/\r?\n/, 1)[0] ?? '';
      return line.replace(/^\uFEFF/, '');
    } finally {
      await fileHandle.close();
    }
  }

  private detectDelimiter(headerLine: string): ',' | ';' | '|' | '\t' {
    let bestDelimiter: ',' | ';' | '|' | '\t' = ',';
    let bestScore = -1;

    for (const delimiter of HEADER_DELIMITER_CANDIDATES) {
      const score = this.countDelimiterOccurrences(headerLine, delimiter);
      if (score > bestScore) {
        bestScore = score;
        bestDelimiter = delimiter;
      }
    }

    return bestDelimiter;
  }

  private countDelimiterOccurrences(value: string, delimiter: string): number {
    let count = 0;
    let inQuotes = false;

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];

      if (char === '"') {
        if (inQuotes && value[index + 1] === '"') {
          index += 1;
          continue;
        }

        inQuotes = !inQuotes;
        continue;
      }

      if (!inQuotes && char === delimiter) {
        count += 1;
      }
    }

    return count;
  }
}
