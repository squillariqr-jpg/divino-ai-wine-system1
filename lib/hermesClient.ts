export type HermesReplyInput = {
  message: string;
  segment?: string;
  userName?: string;
  subject?: string;
};

export async function getHermesReply(input: HermesReplyInput): Promise<string> {
  const baseUrl = process.env.HERMES_API_URL;
  const apiKey = process.env.HERMES_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("HERMES_API_URL or HERMES_API_KEY not configured");
  }

  const res = await fetch(`${baseUrl}/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      message: input.message,
      segment: input.segment ?? "",
      user_name: input.userName ?? "",
      subject: input.subject ?? "",
    }),
    signal: AbortSignal.timeout(50_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hermes API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { reply?: string; error?: string };
  if (!data.reply) {
    throw new Error(`Hermes returned no reply: ${JSON.stringify(data)}`);
  }

  return data.reply;
}
