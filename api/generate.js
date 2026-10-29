
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Only POST requests are supported."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel Environment Variables."
    });
  }

  const { appName, appType, features } = req.body || {};

  if (!appName || !appType || !features) {
    return res.status(400).json({
      error: "App name, app type and features are required."
    });
  }

  const prompt = `
You are an Android application development assistant.

Create a useful Android app project response for the following request.

App name: ${String(appName).slice(0, 100)}
App type: ${String(appType).slice(0, 100)}
Features: ${String(features).slice(0, 3000)}

Include:
1. Android project folder structure.
2. app/build.gradle configuration.
3. AndroidManifest.xml.
4. MainActivity source code.
5. Steps to build a debug APK using Android Studio or Gradle.

Use Java for the Android example.
Keep the answer concise but include usable code.
Do not claim an APK has already been built or attached.
`;

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            maxOutputTokens: 1024
          }
        }),
        signal: AbortSignal.timeout(45000)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", {
        status: response.status,
        message: data.error?.message
      });

      return res.status(502).json({
        error: "Gemini could not generate a response.",
        details:
          data.error?.message ||
          `Google API returned HTTP ${response.status}.`
      });
    }

    const output = (data.candidates || [])
      .flatMap(candidate => candidate.content?.parts || [])
      .map(part => part.text || "")
      .join("\n")
      .trim();

    if (!output) {
      return res.status(502).json({
        error: "Gemini returned no text.",
        details: data.promptFeedback?.blockReason ||
          "No text was found in the response."
      });
    }

    return res.status(200).json({
      status: "completed",
      output
    });
  } catch (error) {
    console.error("Generate API error:", error);

    return res.status(
      error.name === "TimeoutError" ? 504 : 500
    ).json({
      error: "Could not get a response from Gemini.",
      details:
        error.name === "TimeoutError"
          ? "The request took longer than 45 seconds."
          : error.message
    });
  }
}
