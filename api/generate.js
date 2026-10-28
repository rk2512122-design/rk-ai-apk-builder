export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Only POST requests are allowed."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel Environment Variables."
    });
  }

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
      error: "Please enter the app name, app type, and features."
    });
  }

  const prompt = `
Create an original Android app project plan and basic source code.

App name: ${appName.trim()}
App type: ${appType.trim()}
Required features: ${features.trim()}

Requirements:
- Use original content only.
- Do not copy copyrighted apps or source code.
- Give a concise project plan.
- Include basic Android source code where appropriate.
- Explain how to build the project.
- Do not claim an APK has been built unless it actually has.
- Keep the response concise.
`;

  try {
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
            max_output_tokens: 1024
          }
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    const responseText = await response.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: { message: responseText } };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.error?.message ||
          `Gemini API request failed (${response.status}).`
      });
    }

    let output = data.output_text || "";

    if (!output && Array.isArray(data.steps)) {
      output = data.steps
        .filter((step) => step.type === "model_output")
        .flatMap((step) => step.content || [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
    }

    if (!output) {
      return res.status(502).json({
        error: "Gemini returned no text. Please try a shorter request."
      });
    }

    return res.status(200).json({
      success: true,
      result: output,
      output: output
    });
  } catch (error) {
    console.error("Gemini API error:", error);

    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError"
    ) {
      return res.status(504).json({
        error: "Gemini timed out. Please try again."
      });
    }

    return res.status(500).json({
      error: "Unable to connect to Gemini. Please try again."
    });
  }
}
