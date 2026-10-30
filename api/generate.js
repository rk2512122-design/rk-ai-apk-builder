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
  const safeAppType = String(appType).trim().slice(0, 150);
  const safeFeatures = String(features).trim().slice(0, 5000);

  const prompt = `
You are a professional Android application development AI.

Your task is to generate a COMPLETE Android Studio project
based on the user's app idea.

APP NAME:
${safeAppName}

APP CATEGORY:
${safeAppType}

USER REQUIREMENTS:
${safeFeatures}

IMPORTANT PROJECT RULES:

1. Support ANY legitimate Android app category.
2. Understand the requested features before creating files.
3. Use Java for Android application code.
4. Use Android Gradle Plugin 8.6.1.
5. Use Gradle-compatible project configuration.
6. Use compileSdk 35, minSdk 24 and targetSdk 35.
7. Use package name com.example.generatedapp.
8. Use standard Android SDK components where possible.
9. Avoid unnecessary external libraries.
10. Generate every file required by the requested application.
11. Do NOT restrict the project to 10 files.
12. Generate additional Java, XML, drawable, menu,
    values, assets and resource files whenever required.
13. Include all required Gradle configuration files.
14. Include AndroidManifest.xml.
15. Include a working launcher Activity.
16. Implement the requested features as completely as possible.
17. Do not create empty files or placeholder code.
18. Do not refer to files that you have not generated.
19. Keep all file paths consistent.
20. Do not claim that an APK has already been built.

FILE OUTPUT FORMAT:

Return ONLY valid JSON.

Use exactly this structure:

{
  "projectName": "Application Name",
  "files": [
    {
      "path": "settings.gradle",
      "content": "complete file content"
    },
    {
      "path": "build.gradle",
      "content": "complete file content"
    },
    {
      "path": "app/build.gradle",
      "content": "complete file content"
    }
  ]
}

IMPORTANT:
- The files array must contain ALL required project files.
- There is no fixed number of files.
- Every path must be relative to the project root.
- Every content field must contain the complete file.
- Escape JSON special characters correctly.
- Do not wrap the JSON in Markdown code fences.
- Do not include explanations outside the JSON.
- Do not omit required files.
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
              maxOutputTokens: 16384,
              responseMimeType: "application/json"
            }
          }),
          signal: AbortSignal.timeout(60000)
        }
      );

      let data;

      try {
        data = await response.json();
      } catch (error) {
        return res.status(502).json({
          error: "Gemini returned an unreadable response."
        });
      }

      if (!response.ok) {
        const message =
          data.error?.message ||
          `Google API returned HTTP ${response.status}.`;

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
          error: "Gemini could not generate the project.",
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
          error: "Gemini returned no project data.",
          details:
            data.promptFeedback?.blockReason ||
            candidate?.finishReason ||
            "Empty response."
        });
      }

      if (candidate?.finishReason === "MAX_TOKENS") {
        return res.status(502).json({
          error: "AI project generation was incomplete.",
          details: "The output token limit was reached. Please try again."
        });
      }

      let project;

      try {
        project = JSON.parse(output);
      } catch (error) {
        return res.status(502).json({
          error: "AI returned invalid project JSON.",
          details: "Please generate the project again."
        });
      }

      if (
        !project ||
        !Array.isArray(project.files) ||
        project.files.length === 0
      ) {
        return res.status(502).json({
          error: "No project files were returned."
        });
      }

      if (project.files.length > 80) {
        return res.status(502).json({
          error: "The project contains too many files.",
          details: "The current safety limit is 80 files."
        });
      }

      const cleanFiles = [];
      const seenPaths = new Set();
      let totalSize = 0;

      for (const file of project.files) {
        if (
          !file ||
          typeof file.path !== "string" ||
          typeof file.content !== "string"
        ) {
          return res.status(502).json({
            error: "An invalid project file was returned."
          });
        }

        const path = file.path.replace(/\\/g, "/").trim();

        if (
          !path ||
          path.startsWith("/") ||
          path.includes("..") ||
          !/^[a-zA-Z0-9_./-]+$/.test(path)
        ) {
          return res.status(502).json({
            error: "An unsafe project file path was detected.",
            details: path
          });
        }

        if (seenPaths.has(path)) {
          return res.status(502).json({
            error: "Duplicate project file detected.",
            details: path
          });
        }

        seenPaths.add(path);

        totalSize += new TextEncoder().encode(file.content).length;

        if (totalSize > 2 * 1024 * 1024) {
          return res.status(502).json({
            error: "The generated project is too large.",
            details: "The current size limit is 2 MB."
          });
        }

        cleanFiles.push({
          path,
          content: file.content
        });
      }

      const requiredFiles = [
        "settings.gradle",
        "app/build.gradle",
        "app/src/main/AndroidManifest.xml"
      ];

      const missingFiles = requiredFiles.filter(
        path => !seenPaths.has(path)
      );

      if (missingFiles.length > 0) {
        return res.status(502).json({
          error: "The Android project is missing required files.",
          missingFiles
        });
      }

      return res.status(200).json({
        status: "completed",
        projectName: project.projectName || safeAppName,
        fileCount: cleanFiles.length,
        files: cleanFiles,
        message: "Android project files generated successfully."
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
    error: "All Gemini retry attempts failed."
  });
}
