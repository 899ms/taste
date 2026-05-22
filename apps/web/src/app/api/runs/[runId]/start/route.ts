import { NextRequest } from "next/server";

import { analysisModels, env } from "@/config";
import {
  appendRunEvent,
  listImages,
  updateRunStatus,
} from "@/db/repository";
import { errorResponse } from "@/http/errors";
import { requireRunAccess, routeParams } from "@/http/auth";
import { inngest } from "@/inngest/client";

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await routeParams(context);
  const access = await requireRunAccess(request, runId);
  if (!access.ok) return access.response;
  try {
    if (access.run.status !== "uploading") {
      return Response.json({ error: `Run cannot be started from ${access.run.status}` }, { status: 409 });
    }
    const images = await listImages(runId);
    if (images.length === 0) {
      return Response.json({ error: "Upload at least one image before starting" }, { status: 400 });
    }
    if (images.length > env().MAX_IMAGES_PER_RUN) {
      return Response.json({ error: `Run cannot exceed ${env().MAX_IMAGES_PER_RUN} images` }, { status: 400 });
    }
    await updateRunStatus(runId, "queued", {
      currentStep: "Queued",
      progressPercent: 1,
    });
    await appendRunEvent(runId, "run.queued", `Queued run with ${images.length} images`, {
      images: images.length,
      analysisModels: analysisModels(),
    });
    await inngest.send({ name: "taste/run.started", data: { runId } });
    return Response.json({ ok: true, runId, status: "queued" });
  } catch (error) {
    return errorResponse(error);
  }
}
