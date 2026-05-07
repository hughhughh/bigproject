import { NextResponse } from "next/server";

const GEMINI_MODEL = "gemini-2.5-flash";

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "GEMINI_API_KEY missing" },
      { status: 400 },
    );
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: 'Return JSON only: {"ok":true,"message":"gemini test works"}',
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: "Gemini API request failed", detail: await res.text() },
      { status: 502 },
    );
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return NextResponse.json({ ok: true, model: GEMINI_MODEL, text, raw: json });
}
