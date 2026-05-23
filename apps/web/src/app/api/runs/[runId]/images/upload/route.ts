import { put } from "@vercel/blob";
import { NextRequest } from "next/server";
import { z } from "zod";

import { ACCEPTED_IMAGE_TYPES, env } from "@/config";
import { registerUploadedImage } from "@/db/repository";
import { routeParams, requireRunAccess } from "@/http/auth";
import { errorResponse } from "@/http/errors";
import { assertSameOrigin, enforceRateLimit } from "@/http/security";
import { uploadPathname } from "@/uploads/path";

const SERVER_UPLOAD_BYTES_CAP = 4 * 1024 * 1024;

const uploadOrderSchema = z.coerce.number().int().nonnegative();

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await routeParams(context);
  try {
    await assertSameOrigin(request);
    await enforceRateLimit(request, { bucket: "images:server_upload", limit: 1000, windowSeconds: 15 * 60 });
    const access = await requireRunAccess(request, runId);
    if (!access.ok) return access.response;
    if (access.run.status !== "uploading") {
      return Response.json({ error: "Run is no longer accepting uploads" }, { status: 409 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Upload file is required" }, { status: 400 });
    }
    const uploadOrder = uploadOrderSchema.parse(form.get("uploadOrder"));

    if (file.size > SERVER_UPLOAD_BYTES_CAP) {
      return Response.json(
        { error: `Image exceeds server upload limit of ${SERVER_UPLOAD_BYTES_CAP} bytes` },
        { status: 413 },
      );
    }
    if (file.size > env().MAX_IMAGE_BYTES) {
      return Response.json({ error: `Image exceeds ${env().MAX_IMAGE_BYTES} bytes` }, { status: 400 });
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      return Response.json({ error: `Unsupported image type: ${file.type}` }, { status: 400 });
    }
    if (uploadOrder >= access.run.maxImages) {
      return Response.json({ error: `Run cannot exceed ${access.run.maxImages} images` }, { status: 400 });
    }
    if (access.run.expectedImageCount !== null && uploadOrder >= access.run.expectedImageCount) {
      return Response.json({ error: `Run expects ${access.run.expectedImageCount} images` }, { status: 400 });
    }

    const blob = await put(uploadPathname(runId, uploadOrder, file.name), file, {
      access: "private",
      addRandomSuffix: true,
      contentType: file.type,
    });
    const image = await registerUploadedImage({
      runId,
      uploadOrder,
      basename: file.name,
      blobUrl: blob.url,
      downloadUrl: blob.downloadUrl,
      pathname: blob.pathname,
      contentType: blob.contentType ?? file.type,
      bytes: file.size,
    });
    return Response.json({ imageId: image.id });
  } catch (error) {
    return errorResponse(error);
  }
}
