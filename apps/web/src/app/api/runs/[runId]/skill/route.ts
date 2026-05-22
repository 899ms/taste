import { NextRequest } from "next/server";

import { getArtifact } from "@/db/repository";
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
    const skill = await getArtifact({ runId, type: "skill" });
    if (!skill?.content) {
      return Response.json({ error: "Skill is not ready" }, { status: 404 });
    }
    return new Response(skill.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="taste-${runId}-SKILL.md"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
