
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
    !String(appName || "").trim() ||
    !String(appType || "").trim() ||
    !String(features || "").trim()
  ) {
    return res.status(400).json({
      error: "App name, app type and features are required."
    });
  }

  const safeAppName = String(appName).trim().slice(0, 100);
  const safeAppType = String(appType).trim().slice(0, 100);
  const safeFeatures = String(features).trim().slice(0, 2500);

  const prompt = `
You are a professional Android Java project generator.

Generate a COMPLETE, compact, buildable Android Studio project.

APP DETAILS
Name: ${safeAppName}
Type: ${safeAppType}
Requested features: ${safeFeatures}

TECHNICAL REQUIREMENTS
- Use Java, not Kotlin.
- Use Android Gradle Plugin 8.6.1.
- Use Gradle 8.7.
- Use compileSdk 35, minSdk 24, targetSdk 35.
- Package and namespace: com.example.generatedapp
- Use Android SDK and standard Android widgets only.
- Avoid external libraries unless absolutely necessary.
- Do not use AppCompat, Material Components or ConstraintLayout.
- MainActivity must extend android.app.Activity.
- The app must have a working launcher activity.
- Use simple, compatible Android XML layouts.
- All Java and XML files must be complete and syntactically valid.
- Use consistent package names, resource names and IDs.
- Do not use placeholders, ellipses or comments such as "add code here".
- Do not omit any required file.
- Keep the project small and the implementation concise.

OUTPUT FORMAT
Return these files in exactly this order.
For each file, print its full relative path as a heading,
then provide the complete contents in a fenced code block.

1. settings.gradle
2. build.gradle
3. gradle.properties
4. app/build.gradle
5. app/src/main/AndroidManifest.xml
6. app/src/main/java/com/example/generatedapp/MainActivity.java
7. app/src/main/res/layout/activity_main.xml
8. app/src/main/res/values/strings.xml
9. app/src/main/res/values/colors.xml
10. app/src/main/res/values/styles.xml

BUILD REQUIREMENTS
- settings.gradle must configure Google and Maven Central repositories.
- Root build.gradle must declare the Android application plugin version.
- app/build.gradle must use the application plugin.
- Manifest must declare MainActivity with MAIN and LAUNCHER intent filters.
- Do not reference missing icons, themes, files or resources.
- MainActivity must load activity_main.xml and implement the requested features.
- The layout must provide a usable interface for the app.
- Resource references must match the resource files.
- Do not claim that an APK has already been built.

FINAL CHECK
Before answering, verify that all 10 files are present,
each code block is complete, and Java/XML braces and tags are closed.

Return the files and code only. Avoid lengthy explanations.
`;

  const maxAttempts = 3;
  const retryableStatuses = [429, 500, 502, 503, 504];

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
              temperature: 0.2,
              maxOutputTokens: 8192
            }
          }),
          signal: AbortSignal.timeout(60000)
        }
      );

      let data;

      try {
        data = await response.json();
      } catch (error) {
        console.error("Gemini JSON parsing error:", {
          attempt,
          message: error.message
        });

        return res.status(502).json({
          error: "Gemini returned an unreadable response.",
          details: error.message
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
            setTimeout(resolve, attempt * 1500)
          );
          continue;
        }

        return res.status(502).json({
          error: "Gemini could not generate a response.",
          details: message
        });
      }

      const candidate = data.candidates?.[0];

      const output = (data.candidates || [])
        .flatMap(item => item.content?.parts || [])
        .map(part => part.text || "")
        .join("\n")
        .trim();

      if (!output) {
        return res.status(502).json({
          error: "Gemini returned no text.",
          details:
            data.promptFeedback?.blockReason ||
            candidate?.finishReason ||
            "No text was found in the response."
        });
      }

      const wasTruncated =
        candidate?.finishReason === "MAX_TOKENS";

      const finalOutput = wasTruncated
        ? output +
          "\n\nWARNING: The model reached its output token limit. " +
          "The project may be incomplete. Do not build until all files are complete."
        : output;

      return res.status(200).json({
        status: wasTruncated ? "incomplete" : "completed",
        output: finalOutput,
        warning: wasTruncated
          ? "The output token limit was reached."
          : null
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

      if (attempt < maxAttempts && !timedOut) {
        await new Promise(resolve =>
          setTimeout(resolve, attempt * 1500)
        );
        continue;
      }

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
