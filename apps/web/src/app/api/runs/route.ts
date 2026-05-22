import { NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/config";
import { createRun } from "@/db/repository";
import { errorResponse } from "@/http/errors";

const createRunSchema = z.object({
  aiGatewayToken: z.string().optional(),
  expectedImageCount: z.number().int().positive().max(100).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = createRunSchema.parse(await request.json());
    if (
      body.expectedImageCount !== undefined &&
      body.expectedImageCount > env().MAX_IMAGES_PER_RUN
    ) {
      return Response.json(
        { error: `expectedImageCount cannot exceed ${env().MAX_IMAGES_PER_RUN}` },
        { status: 400 },
      );
    }
    const { run, runSecret } = await createRun({
      aiGatewayToken: body.aiGatewayToken?.trim() || undefined,
      ...(body.expectedImageCount === undefined ? {} : { expectedImageCount: body.expectedImageCount }),
    });
    return Response.json({
      runId: run.id,
      runSecret,
      maxImages: run.maxImages,
      maxImageBytes: env().MAX_IMAGE_BYTES,
      acceptedTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
