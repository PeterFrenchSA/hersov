import { Injectable } from '@nestjs/common';

export interface OpenAiToolCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

export interface OpenAiStreamResult {
  responseId?: string;
  outputText: string;
  toolCalls: OpenAiToolCall[];
  usage?: Record<string, unknown>;
}

export interface OpenAiStreamOptions {
  model: string;
  input: unknown;
  tools?: unknown[];
  previousResponseId?: string;
  onTextDelta?: (delta: string) => void;
}

interface EmbeddingsApiResponse {
  data?: Array<{ embedding?: number[] }>;
}

@Injectable()
export class OpenAiService {
  getEmbeddingModel(): string {
    return process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  }

  getChatModel(): string {
    return process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-4.1-mini';
  }

  async createEmbedding(text: string): Promise<{ vector: number[]; model: string }> {
    const apiKey = this.getApiKey();
    const model = this.getEmbeddingModel();

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Embeddings API request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const payload = (await response.json()) as EmbeddingsApiResponse;
    const vector = payload.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('Embeddings API returned an empty vector');
    }

    return {
      vector,
      model,
    };
  }

  async streamResponse(options: OpenAiStreamOptions): Promise<OpenAiStreamResult> {
    const apiKey = this.getApiKey();

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        input: options.input,
        tools: options.tools,
        previous_response_id: options.previousResponseId,
        stream: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Responses API request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const toolCalls: OpenAiToolCall[] = [];
    let outputText = '';
    let responseId: string | undefined;
    let usage: Record<string, unknown> | undefined;

    await this.consumeSse(response, (event) => {
      if (!event || typeof event !== 'object') {
        return;
      }

      const typedEvent = event as Record<string, unknown>;
      const eventType = typedEvent.type;

      if (eventType === 'response.output_text.delta') {
        const delta = typedEvent.delta;
        if (typeof delta === 'string') {
          outputText += delta;
          options.onTextDelta?.(delta);
        }
        return;
      }

      if (eventType === 'response.output_item.done') {
        const item = typedEvent.item;
        const toolCall = this.extractToolCall(item);
        if (toolCall) {
          toolCalls.push(toolCall);
          return;
        }

        if (!outputText) {
          outputText = this.extractTextFromOutputItem(item) ?? outputText;
        }
        return;
      }

      if (eventType === 'response.completed') {
        const responseObject = typedEvent.response as Record<string, unknown> | undefined;
        responseId = typeof responseObject?.id === 'string' ? responseObject.id : responseId;

        if (!outputText) {
          outputText = this.extractTextFromResponse(responseObject) ?? outputText;
        }

        const outputArray = Array.isArray(responseObject?.output)
          ? (responseObject?.output as unknown[])
          : [];

        for (const item of outputArray) {
          const toolCall = this.extractToolCall(item);
          if (toolCall && !toolCalls.some((existing) => existing.callId === toolCall.callId)) {
            toolCalls.push(toolCall);
          }
        }

        const usageValue = responseObject?.usage;
        if (usageValue && typeof usageValue === 'object') {
          usage = usageValue as Record<string, unknown>;
        }
        return;
      }

      if (eventType === 'response.failed') {
        const error = typedEvent.error as Record<string, unknown> | undefined;
        const message = typeof error?.message === 'string' ? error.message : 'Responses API failed';
        throw new Error(message);
      }
    });

    return {
      responseId,
      outputText,
      toolCalls,
      usage,
    };
  }

  private getApiKey(): string {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    return apiKey;
  }

  private async consumeSse(response: Response, onEvent: (event: unknown) => void): Promise<void> {
    const body = response.body;
    if (!body) {
      throw new Error('Missing Responses API stream body');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let blockBreakIndex = buffer.indexOf('\n\n');
      while (blockBreakIndex >= 0) {
        const rawBlock = buffer.slice(0, blockBreakIndex);
        buffer = buffer.slice(blockBreakIndex + 2);
        this.parseSseBlock(rawBlock, onEvent);
        blockBreakIndex = buffer.indexOf('\n\n');
      }
    }

    if (buffer.trim().length > 0) {
      this.parseSseBlock(buffer, onEvent);
    }
  }

  private parseSseBlock(rawBlock: string, onEvent: (event: unknown) => void): void {
    const lines = rawBlock.split(/\r?\n/);
    let dataPayload = '';

    for (const line of lines) {
      if (!line.startsWith('data:')) {
        continue;
      }

      const value = line.slice(5).trimStart();
      if (value === '[DONE]') {
        return;
      }

      dataPayload += value;
    }

    if (!dataPayload) {
      return;
    }

    const parsed = JSON.parse(dataPayload) as unknown;
    onEvent(parsed);
  }

  private extractToolCall(item: unknown): OpenAiToolCall | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const record = item as Record<string, unknown>;
    const type = record.type;
    if (type !== 'function_call' && type !== 'tool_call') {
      return null;
    }

    const callIdCandidate = record.call_id;
    const nameCandidate = record.name;
    const argsCandidate = record.arguments;

    if (typeof callIdCandidate !== 'string' || typeof nameCandidate !== 'string') {
      return null;
    }

    return {
      callId: callIdCandidate,
      name: nameCandidate,
      argumentsJson: typeof argsCandidate === 'string' ? argsCandidate : '{}',
    };
  }

  private extractTextFromResponse(responseObject: Record<string, unknown> | undefined): string | null {
    if (!responseObject) {
      return null;
    }

    const outputText = responseObject.output_text;
    if (typeof outputText === 'string' && outputText.length > 0) {
      return outputText;
    }

    const outputArray = Array.isArray(responseObject.output)
      ? (responseObject.output as unknown[])
      : [];

    for (const item of outputArray) {
      const extracted = this.extractTextFromOutputItem(item);
      if (extracted) {
        return extracted;
      }
    }

    return null;
  }

  private extractTextFromOutputItem(item: unknown): string | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const record = item as Record<string, unknown>;
    const content = record.content;
    if (!Array.isArray(content)) {
      return null;
    }

    const chunks: string[] = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }

      const partRecord = part as Record<string, unknown>;
      const text = partRecord.text;
      if (typeof text === 'string' && text.length > 0) {
        chunks.push(text);
      }
    }

    if (chunks.length === 0) {
      return null;
    }

    return chunks.join('');
  }
}
