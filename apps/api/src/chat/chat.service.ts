import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ChatMessageRole, type Prisma } from '@prisma/client';
import type { Response } from 'express';
import type {
  AppRole,
  ChatRequestInput,
  ChatThreadsQueryInput,
} from '@hersov/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OpenAiService } from '../ai/openai.service';
import { ChatToolsService } from './chat-tools.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly openAiService: OpenAiService,
    private readonly chatToolsService: ChatToolsService,
  ) {}

  async listThreads(
    userId: string,
    query: ChatThreadsQueryInput,
  ): Promise<{
    data: Array<{
      id: string;
      title: string | null;
      createdAt: string;
      updatedAt: string;
      lastMessagePreview: string | null;
    }>;
    pagination: { page: number; pageSize: number; total: number };
  }> {
    const [total, threads] = await this.prisma.$transaction([
      this.prisma.chatThread.count({ where: { userId } }),
      this.prisma.chatThread.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    return {
      data: threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        lastMessagePreview: thread.messages[0]?.contentText?.slice(0, 160) ?? null,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
    };
  }

  async getThreadMessages(userId: string, threadId: string): Promise<{
    thread: { id: string; title: string | null; createdAt: string; updatedAt: string };
    messages: Array<{
      id: string;
      role: string;
      contentText: string;
      toolName: string | null;
      createdAt: string;
    }>;
  }> {
    const thread = await this.prisma.chatThread.findFirst({
      where: {
        id: threadId,
        userId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!thread) {
      throw new NotFoundException('Chat thread not found');
    }

    return {
      thread: {
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      },
      messages: thread.messages.map((message) => ({
        id: message.id,
        role: message.role.toLowerCase(),
        contentText: message.contentText,
        toolName: message.toolName,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }

  async streamChat(
    input: {
      payload: ChatRequestInput;
      actor: { id: string; role: AppRole };
      ip?: string;
    },
    response: Response,
  ): Promise<void> {
    if (!input.actor?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const maxInputLength = getChatMaxInputLength();
    const message = input.payload.message.trim();
    if (message.length > maxInputLength) {
      throw new Error(`Message exceeds max length (${maxInputLength})`);
    }

    const thread = await this.resolveThread({
      actorUserId: input.actor.id,
      threadId: input.payload.threadId,
      titleSeed: message,
    });

    await this.prisma.chatMessage.create({
      data: {
        threadId: thread.id,
        role: ChatMessageRole.USER,
        contentText: message,
      },
    });

    await this.prisma.chatThread.update({
      where: { id: thread.id },
      data: {
        updatedAt: new Date(),
      },
    });

    await this.auditService.log({
      actorUserId: input.actor.id,
      action: 'chat.started',
      entityType: 'chat_thread',
      entityId: thread.id,
      ip: input.ip,
      metaJson: {
        hasThreadId: Boolean(input.payload.threadId),
      },
    });

    this.writeSseHeaders(response);
    this.sendSseEvent(response, 'thread', {
      threadId: thread.id,
    });

    if (looksLikeMassExtractionRequest(message)) {
      const refusal = 'Bulk extraction requests are not available in chat. Use the export workflow.';
      this.sendSseEvent(response, 'delta', { text: refusal });
      await this.persistAssistantMessage(thread.id, refusal);
      this.sendSseEvent(response, 'done', { threadId: thread.id });
      response.end();
      return;
    }

    const tools = this.chatToolsService.getToolDefinitions();
    const maxToolCalls = getChatMaxToolCalls();
    const sensitiveRequestAllowed = looksLikeSensitiveDataRequest(message);

    let finalAssistantText = '';
    let previousResponseId: string | undefined;
    let usage: Record<string, unknown> | undefined;
    let toolCallsUsed = 0;
    const toolExecutions: Array<{ name: string; rows: number }> = [];
    let loopInput: unknown = [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: buildSystemPrompt(),
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: message,
          },
        ],
      },
    ];

    try {
      while (true) {
        let streamedText = '';

        const result = await this.openAiService.streamResponse({
          model: this.openAiService.getChatModel(),
          input: loopInput,
          tools,
          previousResponseId,
          onTextDelta: (delta) => {
            streamedText += delta;
            finalAssistantText += delta;
            this.sendSseEvent(response, 'delta', { text: delta });
          },
        });

        previousResponseId = result.responseId ?? previousResponseId;
        usage = result.usage;

        if (result.toolCalls.length === 0) {
          if (!streamedText) {
            const finalText = result.outputText || 'No response generated.';
            finalAssistantText += finalText;
            this.sendSseEvent(response, 'delta', { text: finalText });
          }
          break;
        }

        toolCallsUsed += result.toolCalls.length;
        if (toolCallsUsed > maxToolCalls) {
          throw new Error('Tool call limit exceeded for this chat request.');
        }

        const toolOutputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = [];

        for (const toolCall of result.toolCalls) {
          this.sendSseEvent(response, 'tool', {
            name: toolCall.name,
            status: 'running',
          });

          const execution = await this.chatToolsService.executeTool(toolCall.name, toolCall.argumentsJson, {
            userRole: input.actor.role,
            sensitiveRequestAllowed,
          });

          toolExecutions.push({
            name: execution.name,
            rows: execution.rows,
          });

          await this.prisma.chatMessage.create({
            data: {
              threadId: thread.id,
              role: ChatMessageRole.TOOL,
              contentText: JSON.stringify(execution.output).slice(0, 4000),
              toolName: execution.name,
              toolJson: execution.output as Prisma.InputJsonValue,
            },
          });

          this.sendSseEvent(response, 'tool', {
            name: execution.name,
            status: 'completed',
            rows: execution.rows,
          });

          toolOutputs.push({
            type: 'function_call_output',
            call_id: toolCall.callId,
            output: JSON.stringify(execution.output),
          });
        }

        loopInput = toolOutputs;
      }

      await this.persistAssistantMessage(thread.id, finalAssistantText || 'No response generated.');

      await this.auditService.log({
        actorUserId: input.actor.id,
        action: 'chat.tools_executed',
        entityType: 'chat_thread',
        entityId: thread.id,
        ip: input.ip,
        metaJson: {
          count: toolExecutions.length,
          tools: toolExecutions,
        },
      });

      await this.auditService.log({
        actorUserId: input.actor.id,
        action: 'chat.completed',
        entityType: 'chat_thread',
        entityId: thread.id,
        ip: input.ip,
        metaJson: {
          toolCallsUsed,
          usage,
        },
      });

      this.sendSseEvent(response, 'done', {
        threadId: thread.id,
      });
      response.end();
    } catch (error) {
      console.error('Chat streaming failed', error);
      this.sendSseEvent(response, 'error', {
        message: (error as Error).message,
      });
      response.end();
    }
  }

  private async resolveThread(input: {
    actorUserId: string;
    threadId?: string;
    titleSeed: string;
  }): Promise<{ id: string; title: string | null }> {
    if (input.threadId) {
      const existing = await this.prisma.chatThread.findFirst({
        where: {
          id: input.threadId,
          userId: input.actorUserId,
        },
      });

      if (!existing) {
        throw new NotFoundException('Chat thread not found');
      }

      return {
        id: existing.id,
        title: existing.title,
      };
    }

    const created = await this.prisma.chatThread.create({
      data: {
        userId: input.actorUserId,
        title: summarizeTitle(input.titleSeed),
      },
    });

    return {
      id: created.id,
      title: created.title,
    };
  }

  private async persistAssistantMessage(threadId: string, contentText: string): Promise<void> {
    await this.prisma.chatMessage.create({
      data: {
        threadId,
        role: ChatMessageRole.ASSISTANT,
        contentText,
      },
    });

    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: {
        updatedAt: new Date(),
      },
    });
  }

  private writeSseHeaders(response: Response): void {
    response.status(200);
    response.setHeader('content-type', 'text/event-stream');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('connection', 'keep-alive');
    response.flushHeaders?.();
  }

  private sendSseEvent(response: Response, eventName: string, payload: Record<string, unknown>): void {
    response.write(`event: ${eventName}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

function getChatMaxToolCalls(): number {
  const parsed = Number(process.env.CHAT_MAX_TOOL_CALLS ?? 6);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 6;
  }

  return Math.min(20, Math.floor(parsed));
}

function getChatMaxInputLength(): number {
  const parsed = Number(process.env.CHAT_MAX_INPUT_CHARS ?? 4000);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 4000;
  }

  return Math.min(12000, Math.floor(parsed));
}

function summarizeTitle(message: string): string {
  const clean = message.trim().replace(/\s+/g, ' ');
  if (clean.length <= 80) {
    return clean;
  }

  return `${clean.slice(0, 77)}...`;
}

function looksLikeMassExtractionRequest(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('all contacts')
    || lowered.includes('every contact')
    || lowered.includes('export')
    || lowered.includes('full database')
    || lowered.includes('all emails')
    || lowered.includes('all phone')
  );
}

function looksLikeSensitiveDataRequest(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('email')
    || lowered.includes('phone')
    || lowered.includes('contact method')
    || lowered.includes('linkedin')
  );
}

function buildSystemPrompt(): string {
  return [
    'You are a CRM assistant for an internal contacts app.',
    'Use tools for factual CRM queries; do not invent contact records.',
    'Keep answers concise and grounded in tool outputs.',
    'For any referenced contact, include a link path in the format /contacts/{contactId}.',
    'If the user requests bulk export or mass extraction, refuse and direct them to export workflows.',
  ].join(' ');
}
