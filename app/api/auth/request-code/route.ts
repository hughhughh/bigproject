import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getDb } from "@/lib/mongodb";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function deliverCodeEmail(email: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const appName = process.env.APP_NAME ?? "Study Planner";

  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[auth] Login code for ${email}: ${code}`);
      console.info(
        "[auth] RESEND_API_KEY/RESEND_FROM_EMAIL not set; using terminal-only fallback.",
      );
    }
    return;
  }

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from,
    to: email,
    subject: `${appName} sign-in code`,
    text: `Your ${appName} sign-in code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your <strong>${appName}</strong> sign-in code is <strong style="font-size:20px">${code}</strong>.</p><p>This code expires in 10 minutes.</p>`,
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email =
    typeof body === "object" && body !== null && "email" in body
      ? String((body as { email: unknown }).email).trim().toLowerCase()
      : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const db = await getDb();
  await db.collection("login_codes").updateOne(
    { email },
    { $set: { email, code, expiresAt } },
    { upsert: true },
  );

  await deliverCodeEmail(email, code);

  return NextResponse.json({ ok: true });
}
