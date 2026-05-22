import { NextRequest } from "next/server";
import { z } from "zod";

import { registerUploadedImage } from "@/db/repository";
import { routeParams, requireRunAccess } from "@/http/auth";
import { errorResponse } from "@/http/errors";

const completeSchema = z.object({
  uploadOrder: z.number().int().nonnegative(),
  basename: z.string().min(1),
  blobUrl: z.string().url(),
  downloadUrl: z.string().url().optional().nullable(),
  pathname: z.string().min(1),
  contentType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await routeParams(context);
  const access = await requireRunAccess(request, runId);
  if (!access.ok) return access.response;
  try {
    if (access.run.status !== "uploading") {
      return Response.json({ error: "Run is no longer accepting uploads" }, { status: 409 });
    }
    const body = completeSchema.parse(await request.json());
    const image = await registerUploadedImage({
      runId,
      uploadOrder: body.uploadOrder,
      basename: body.basename,
      blobUrl: body.blobUrl,
      downloadUrl: body.downloadUrl,
      pathname: body.pathname,
      contentType: body.contentType,
      bytes: body.bytes,
    });
    return Response.json({ imageId: image.id });
  } catch (error) {
    return errorResponse(error);
  }
}
