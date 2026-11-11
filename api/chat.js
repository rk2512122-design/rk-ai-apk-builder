const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

const MAX_HISTORY_MESSAGES = 24;
const MAX_MESSAGE_LENGTH = 8000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Only POST requests are supported." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "AI service is not configured on the server." });
  }

  const body = req.body || {};
  const message = String(
    body.message || body.prompt || body.text ||
    (Array.isArray(body.messages) ? body.messages[body.messages.length - 1]?.content || body.messages[body.messages.length - 1]?.text : "") ||
    ""
  ).trim();

  if (!message) {
    return res.status(400).json({ error: "A non-empty message is required." });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(413).json({ error: "Message is too long." });
  }

  const rawHistory = Array.isArray(body.history)
    ? body.history
    : Array.isArray(body.messages)
      ? body.messages.slice(0, -1)
      : [];

  const history = rawHistory.slice(-MAX_HISTORY_MESSAGES).map(item => {
    const roleValue = String(item?.role || item?.sender || "user").toLowerCase();
    const role = ["assistant", "model", "ai"].includes(roleValue) ? "model" : "user";
    const text = String(item?.content || item?.text || item?.message || "").trim().slice(0, MAX_MESSAGE_LENGTH);
    return text ? { role, parts: [{ text }] } : null;
  }).filter(Boolean);

  const contents = [
    ...history,
    { role: "user", parts: [{ text: message }] }
  ];

  try {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are RK AI Chatbot, a helpful conversational assistant. Reply naturally in the same language as the user's latest message. Support Hindi and English. Be accurate, clear, and friendly."
          }]
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048
        }
      }),
      signal: AbortSignal.timeout(45000)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.error?.message || `Gemini API returned HTTP ${response.status}`;
      console.error("Chat Gemini request failed:", response.status, detail);
      return res.status(response.status === 429 ? 429 : 502).json({
        error: response.status === 429
          ? "AI service is busy. Please try again shortly."
          : "AI service could not process the message."
      });
    }

    const answer = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("\n")
      .trim();

    if (!answer) {
      console.error("Chat Gemini returned no text:", data.promptFeedback || data.candidates?.[0]?.finishReason);
      return res.status(502).json({ error: "AI returned an empty response. Please try again." });
    }

    return res.status(200).json({ reply: answer, response: answer, answer });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    return res.status(504).json({ error: "Could not reach the AI service. Please try again." });
  }
}
