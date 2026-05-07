import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/auth";
import { applyCalendarOps } from "@/lib/calendar/applyOps";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const completed =
    typeof body === "object" && body !== null && "completed" in body
      ? Boolean((body as { completed: unknown }).completed)
      : undefined;
  if (completed === undefined) {
    return NextResponse.json({ error: "completed boolean required" }, { status: 400 });
  }

  const result = await applyCalendarOps(session.user.id, [
    { op: "setOccurrenceComplete", occurrenceId: id, completed },
  ]);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const result = await applyCalendarOps(session.user.id, [{ op: "deleteOccurrence", occurrenceId: id }]);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
