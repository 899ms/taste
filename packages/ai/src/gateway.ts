import { createGateway } from "@ai-sdk/gateway";
import { generateText } from "ai";

import type { ImageInput, TextGenerationResult } from "./types";

export async function generateGatewayText(input: {
  aiGatewayToken?: string | undefined;
  model: string;
  prompt: string;
  maxOutputTokens: number;
}): Promise<TextGenerationResult> {
  const gateway = createGateway(input.aiGatewayToken ? { apiKey: input.aiGatewayToken } : undefined);
  const result = await withGatewayRetries(() =>
    generateText({
      model: gateway(input.model),
      prompt: input.prompt,
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: 2,
      timeout: { totalMs: 180_000 },
    }),
  );
  return toTextGenerationResult(input.model, result);
}

export async function generateGatewayVisionText(input: {
  aiGatewayToken?: string | undefined;
  model: string;
  prompt: string;
  image: ImageInput;
  maxOutputTokens: number;
}): Promise<TextGenerationResult> {
  const gateway = createGateway(input.aiGatewayToken ? { apiKey: input.aiGatewayToken } : undefined);
  const result = await withGatewayRetries(() =>
    generateText({
      model: gateway(input.model),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            {
              type: "image",
              image: input.image.bytes,
              mediaType: input.image.mediaType,
            },
          ],
        },
      ],
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: 2,
      timeout: { totalMs: 180_000 },
    }),
  );
  return toTextGenerationResult(input.model, result);
}

async function withGatewayRetries<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}

function toTextGenerationResult(
  fallbackModel: string,
  result: Awaited<ReturnType<typeof generateText>>,
): TextGenerationResult {
  const usage = result.totalUsage ?? result.usage;
  return {
    text: result.text.trim(),
    model: result.response?.modelId ?? fallbackModel,
    usage: {
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
    },
  };
}
