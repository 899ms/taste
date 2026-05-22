import { NextRequest } from "next/server";

import { statusPayload } from "@/db/repository";
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
    return Response.json(await statusPayload(runId));
  } catch (error) {
    return errorResponse(error, 404);
  }
}
