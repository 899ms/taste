import { NextRequest } from "next/server";
import { z } from "zod";

import { statusPayload, updateRunSkillName } from "@/db/repository";
import { routeParams, requireRunAccess } from "@/http/auth";
import { errorResponse } from "@/http/errors";
import { assertSameOrigin, enforceRateLimit } from "@/http/security";

const patchRunSchema = z.object({
  skillName: z.string().max(80).nullable(),
});

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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await routeParams(context);
  try {
    await assertSameOrigin(request);
    await enforceRateLimit(request, {
      bucket: "runs:update",
      limit: 240,
      windowSeconds: 60 * 60,
    });
    const access = await requireRunAccess(request, runId);
    if (!access.ok) return access.response;
    const body = patchRunSchema.parse(await request.json());
    const updated = await updateRunSkillName(runId, body.skillName);
    if (!updated) {
      return Response.json(
        { error: `Run cannot be updated from ${access.run.status}` },
        { status: 409 },
      );
    }
    return Response.json({ ok: true, skillName: updated.skillName });
  } catch (error) {
    return errorResponse(error);
  }
}
