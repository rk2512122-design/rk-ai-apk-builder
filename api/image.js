const IMAGE_MODEL = "gemini-3.1-flash-image";
const MAX_PROMPT_LENGTH = 2000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Only POST requests are supported." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Image generation is not configured on the server." });
  }

  const prompt = String(req.body?.prompt || req.body?.description || "").trim();
  if (!prompt) {
    return res.status(400).json({ error: "Please describe the image you want." });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(413).json({ error: "Image description is too long. Keep it under 2000 characters." });
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Generate one high-quality image based on this description. Return an actual image, not only a text prompt: " + prompt }] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
          }
        }),
        signal: AbortSignal.timeout(120000)
      }
    );

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const detail = data.error?.message || `Google image API returned HTTP ${upstream.status}`;
      console.error("Image generation provider error:", upstream.status, detail);
      return res.status(upstream.status === 429 ? 429 : 502).json({
        error: upstream.status === 429
          ? "Image generation is busy. Please try again shortly."
          : "The image service could not generate this image. Please try again later."
      });
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(part => part.inlineData?.data);
    if (!imagePart) {
      const textReply = parts.map(part => part.text || "").filter(Boolean).join("\n").slice(0, 500);
      console.error("Image model returned no image:", textReply || data.candidates?.[0]?.finishReason);
      return res.status(502).json({
        error: "The AI did not return an image. Please try a clearer description.",
        details: textReply || undefined
      });
    }

    const mimeType = imagePart.inlineData.mimeType || "image/png";
    if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
      return res.status(502).json({ error: "The image service returned an unsupported image format." });
    }

    return res.status(200).json({
      status: "completed",
      mimeType,
      imageBase64: imagePart.inlineData.data,
      text: parts.map(part => part.text || "").filter(Boolean).join("\n")
    });
  } catch (error) {
    console.error("Image generation endpoint error:", error);
    return res.status(504).json({ error: "Image generation timed out or the AI service could not be reached. Please retry." });
  }
}
