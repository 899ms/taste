import { NextRequest } from "next/server";

import { listRunEvents } from "@/db/repository";
import { routeParams, requireRunAccess } from "@/http/auth";
import { errorResponse } from "@/http/errors";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await routeParams(context);
  const access = await requireRunAccess(request, runId);
  if (!access.ok) return access.response;
  try {
    const after = Number(request.nextUrl.searchParams.get("after") ?? "0");
    const events = await listRunEvents(runId, Number.isFinite(after) ? after : 0);
    return Response.json({ events });
  } catch (error) {
    return errorResponse(error);
  }
}
