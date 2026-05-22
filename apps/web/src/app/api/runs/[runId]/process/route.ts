import { NextRequest } from "next/server";

import { routeParams, requireRunAccess } from "@/http/auth";
import { errorResponse } from "@/http/errors";
import { processRun } from "@/pipeline/run";

export const maxDuration = 800;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await routeParams(context);
  const access = await requireRunAccess(request, runId);
  if (!access.ok) return access.response;
  try {
    await processRun(runId);
    return Response.json({ ok: true, runId });
  } catch (error) {
    return errorResponse(error);
  }
}
