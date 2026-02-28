import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Request } from 'express';
import {
  importBatchIdParamSchema,
  importColumnMappingSchema,
  importResultsQuerySchema,
  type ImportBatchIdParamInput,
  type ImportColumnMappingInput,
  type ImportResultsQueryInput,
} from '@hersov/shared';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ImportService } from './import.service';

const DEFAULT_IMPORT_MAX_UPLOAD_MB = 50;

function getImportUploadDir(): string {
  return process.env.IMPORT_DATA_DIR ?? '/data/imports';
}

function getImportMaxUploadBytes(): number {
  const maxUploadMb = Number(process.env.IMPORT_MAX_UPLOAD_MB ?? DEFAULT_IMPORT_MAX_UPLOAD_MB);
  const safeMaxUploadMb = Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : DEFAULT_IMPORT_MAX_UPLOAD_MB;
  return Math.floor(safeMaxUploadMb * 1024 * 1024);
}

@Controller('import')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('Admin', 'Analyst')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('csv')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_request, _file, callback) => {
          const uploadDir = getImportUploadDir();
          mkdirSync(uploadDir, { recursive: true });
          callback(null, uploadDir);
        },
        filename: (_request, file, callback) => {
          const extension = extname(file.originalname).toLowerCase() || '.csv';
          callback(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
        },
      }),
      limits: {
        fileSize: getImportMaxUploadBytes(),
      },
      fileFilter: (_request, file, callback) => {
        const extension = extname(file.originalname).toLowerCase();
        const allowedMimeTypes = [
          'text/csv',
          'application/csv',
          'application/vnd.ms-excel',
          'application/octet-stream',
        ];
        const mimeAllowed = allowedMimeTypes.includes((file.mimetype ?? '').toLowerCase());

        if (extension !== '.csv') {
          callback(new BadRequestException('Only .csv files are supported'), false);
          return;
        }

        if (!mimeAllowed) {
          callback(new BadRequestException('Invalid CSV content type'), false);
          return;
        }

        callback(null, true);
      },
    }),
  )
  async uploadCsv(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({
          maxSize: getImportMaxUploadBytes(),
          message: `File exceeds ${Math.floor(getImportMaxUploadBytes() / (1024 * 1024))}MB upload limit`,
        })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ batchId: string; headersDetected: string[]; detectedCsvDelimiter: string }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const result = await this.importService.createBatchFromUpload(file, user.id, request?.ip);

    return {
      batchId: result.batchId,
      headersDetected: result.headersDetected,
      detectedCsvDelimiter: result.detectedCsvDelimiter,
    };
  }

  @Post(':batchId/mapping')
  async saveMapping(
    @Param(new ZodValidationPipe(importBatchIdParamSchema)) params: ImportBatchIdParamInput,
    @Body(new ZodValidationPipe(importColumnMappingSchema)) body: ImportColumnMappingInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ batchId: string; status: string }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.importService.saveMapping(params, body, user.id, request?.ip);
  }

  @Post(':batchId/start')
  async startImport(
    @Param(new ZodValidationPipe(importBatchIdParamSchema)) params: ImportBatchIdParamInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ): Promise<{ batchId: string; status: string }> {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.importService.startBatch(params, user.id, request?.ip);
  }

  @Get(':batchId/status')
  async getImportStatus(
    @Param(new ZodValidationPipe(importBatchIdParamSchema)) params: ImportBatchIdParamInput,
  ): Promise<{
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
    return this.importService.getStatus(params);
  }

  @Get(':batchId/results')
  async getImportResults(
    @Param(new ZodValidationPipe(importBatchIdParamSchema)) params: ImportBatchIdParamInput,
    @Query(new ZodValidationPipe(importResultsQuerySchema)) query: ImportResultsQueryInput,
  ): Promise<{
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
    return this.importService.getResults(params, query);
  }
}
