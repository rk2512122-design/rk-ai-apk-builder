
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Only POST requests are allowed."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel."
    });
  }

  try {
    const { appName, appType, features } = req.body || {};

    if (
      typeof appName !== "string" ||
      typeof appType !== "string" ||
      typeof features !== "string" ||
      !appName.trim() ||
      !appType.trim() ||
      !features.trim()
    ) {
      return res.status(400).json({
        error: "Please enter the app name, type and features."
      });
    }

    const prompt = `
Create an original Android app project plan and source code.

App name: ${appName.trim()}
App type: ${appType.trim()}
Requested features: ${features.trim()}

Write original content. Do not reproduce copyrighted text
or third-party source code.

Include:
1. Android project structure.
2. Main source code files.
3. Gradle configuration.
4. Steps to build the project and generate an APK.

Be concise and practical. Do not claim an APK was built.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash",
          input: prompt,
          generation_config: {
            thinking_level: "low",
            max_output_tokens: 2048
          }
        }),
        signal: AbortSignal.timeout(25000)
      }
    );

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "Gemini returned an unreadable response."
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        error:
          data.error?.message ||
          `Gemini API returned HTTP ${response.status}.`
      });
    }

    const result =
      data.output_text ||
      (Array.isArray(data.steps)
        ? data.steps
            .filter(step => step.type === "model_output")
            .flatMap(step => step.content || [])
            .filter(item => item.type === "text")
            .map(item => item.text || "")
            .filter(Boolean)
            .join("\n")
        : "");

    if (!result) {
      return res.status(502).json({
        error: "Gemini returned no text. Please try again."
      });
    }

    return res.status(200).json({ result });

  } catch (error) {
    console.error("Generate API error:", error);

    if (error.name === "TimeoutError" ||
        error.name === "AbortError") {
      return res.status(504).json({
        error: "Gemini timed out. Please try again."
      });
    }

    return res.status(500).json({
      error: error.message || "Unexpected server error."
    });
  }
}
