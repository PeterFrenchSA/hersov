import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  contactPatchSchema,
  contactsQuerySchema,
  idParamSchema,
  type ContactPatchInput,
  type ContactsQueryInput,
  type IdParamInput,
} from '@hersov/shared';
import type { Request } from 'express';
import { SessionAuthGuard } from '../common/session-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser } from '../common/current-user.decorator';
import { ContactsService } from './contacts.service';

@Controller('contacts')
@UseGuards(SessionAuthGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(contactsQuerySchema)) query: ContactsQueryInput) {
    return this.contactsService.list(query);
  }

  @Get(':id')
  async getById(@Param(new ZodValidationPipe(idParamSchema)) params: IdParamInput) {
    return this.contactsService.getById(params.id);
  }

  @Get(':id/insights')
  async getInsights(@Param(new ZodValidationPipe(idParamSchema)) params: IdParamInput) {
    return this.contactsService.getInsights(params.id);
  }

  @Get(':id/network')
  async getNetwork(@Param(new ZodValidationPipe(idParamSchema)) params: IdParamInput) {
    return this.contactsService.getNetwork(params.id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'Analyst')
  async update(
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParamInput,
    @Body(new ZodValidationPipe(contactPatchSchema)) body: ContactPatchInput,
    @CurrentUser() user?: { id: string },
    @Req() request?: Request,
  ) {
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.contactsService.update(params.id, body, user.id, request?.ip);
  }
}
