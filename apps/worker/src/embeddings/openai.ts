interface EmbeddingsApiResponse {
  data?: Array<{ embedding?: number[] }>;
}

export function getEmbeddingModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
}

export async function createEmbeddingVector(text: string): Promise<{ vector: number[]; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for embeddings jobs');
  }

  const model = getEmbeddingModel();

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
