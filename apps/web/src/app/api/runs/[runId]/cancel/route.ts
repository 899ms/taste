import { NextRequest } from "next/server";

import { cancelRun } from "@/db/repository";
import { requireRunAccess, routeParams } from "@/http/auth";
import { errorResponse } from "@/http/errors";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await routeParams(context);
  const access = await requireRunAccess(request, runId);
  if (!access.ok) return access.response;
  try {
    const run = await cancelRun(runId);
    return Response.json({ ok: true, runId: run.id, status: run.status });
  } catch (error) {
    return errorResponse(error);
  }
}
