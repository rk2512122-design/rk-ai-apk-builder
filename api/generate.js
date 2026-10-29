
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

  if (
    !appName || !String(appName).trim() ||
    !appType || !String(appType).trim() ||
    !features || !String(features).trim()
  ) {
    return res.status(400).json({
      error: "App name, app type and features are required."
    });
  }

  const prompt = `
You are an Android application development assistant.

Create a useful Android app project response for this request.

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
Include usable code.
Do not claim an APK has already been built or attached.
`;

  const maxAttempts = 3;
  const retryableStatuses = [408, 429, 500, 502, 503, 504];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
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
          signal: AbortSignal.timeout(30000)
        }
      );

      let data;

      try {
        data = await response.json();
      } catch (parseError) {
        console.error("Gemini response JSON error:", {
          attempt,
          message: parseError.message
        });

        return res.status(502).json({
          error: "Gemini returned an unreadable response.",
          details: "Could not parse Google's response."
        });
      }

      if (!response.ok) {
        const message =
          data.error?.message ||
          `Google API returned HTTP ${response.status}.`;

        console.error("Gemini API error:", {
          attempt,
          status: response.status,
          message
        });

        if (
          retryableStatuses.includes(response.status) &&
          attempt < maxAttempts
        ) {
          await new Promise(resolve =>
            setTimeout(resolve, attempt * 1000)
          );
          continue;
        }

        return res.status(502).json({
          error: "Gemini could not generate a response.",
          details: message
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
          details:
            data.promptFeedback?.blockReason ||
            "No text was found in the response."
        });
      }

      return res.status(200).json({
        status: "completed",
        output
      });

    } catch (error) {
      console.error("Generate API error:", {
        attempt,
        name: error.name,
        message: error.message
      });

      const timedOut =
        error.name === "TimeoutError" ||
        error.name === "AbortError";

      return res.status(timedOut ? 504 : 500).json({
        error: timedOut
          ? "Gemini request timed out."
          : "Could not get a response from Gemini.",
        details: error.message
      });
    }
  }

  return res.status(502).json({
    error: "Gemini could not generate a response.",
    details: "All retry attempts failed."
  });
}
