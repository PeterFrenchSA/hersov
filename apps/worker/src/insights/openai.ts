import {
  contactInsightsExtractionSchema,
  type ContactInsightsExtraction,
} from '@hersov/shared';

export interface InsightsExtractionInput {
  fullName: string;
  companyName: string | null;
  currentTitle: string | null;
  locationCity: string | null;
  locationCountry: string | null;
  notesRaw: string;
}

export interface InsightsExtractionResult {
  output: ContactInsightsExtraction;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

interface ResponsesApiPayload {
  output_text?: string;
  output?: unknown[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export function getInsightsModel(): string {
  return process.env.OPENAI_INSIGHTS_MODEL?.trim() || 'gpt-4.1-mini';
}

export async function extractInsightsWithModel(input: InsightsExtractionInput): Promise<InsightsExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for insights extraction');
  }

  const model = getInsightsModel();
  const prompt = [
    'Extract structured CRM intelligence from provided notes.',
    'Return JSON only. Do not add markdown or commentary.',
    'Use conservative inference; only include supported by note text.',
    'Confidence values must be between 0 and 1.',
  ].join(' ');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: prompt,
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify(input),
            },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Insights Responses API request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as ResponsesApiPayload;
  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error('Insights model returned empty output');
  }

  const parsed = parseStructuredJson(outputText);
  const output = contactInsightsExtractionSchema.parse(parsed);

  return {
    output,
    model,
    tokensIn: payload.usage?.input_tokens,
    tokensOut: payload.usage?.output_tokens,
  };
}

function extractOutputText(payload: ResponsesApiPayload): string {
  if (typeof payload.output_text === 'string' && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return '';
  }

  const chunks: string[] = [];
  for (const item of payload.output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }

      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim().length > 0) {
        chunks.push(text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function parseStructuredJson(text: string): unknown {
  const direct = safeJsonParse(text);
  if (direct !== null) {
    return direct;
  }

  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const parsedFenced = safeJsonParse(fencedMatch[1]);
    if (parsedFenced !== null) {
      return parsedFenced;
    }
  }

  throw new Error('Insights model output is not valid JSON');
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
