
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

Generate a COMPLETE, BUILDABLE Android Studio project
for the user's requested legitimate Android application.

APP NAME:
${safeAppName}

APP CATEGORY:
${safeAppType}

USER REQUIREMENTS:
${safeFeatures}

ANDROID PROJECT RULES:

1. Support any legitimate Android app category.
2. Use Java for Android application code.
3. Use Android Gradle Plugin version 8.6.1.
4. Use compileSdk 35, minSdk 24 and targetSdk 35.
5. Use package name com.example.generatedapp.
6. Generate all files required by the requested features.
7. Do not restrict the project to a fixed number of files.
8. Generate Java, XML, drawable, menu, values,
   assets and resource files whenever required.
9. Include a working launcher Activity.
10. Include a complete AndroidManifest.xml.
11. Do not generate empty files or placeholder implementations.
12. All referenced files and resources must exist.
13. Keep package names, resource names and file paths consistent.
14. Do not claim that an APK has already been built.

CRITICAL GRADLE REPOSITORY RULES:

15. Generate a settings.gradle file that contains:
    pluginManagement repositories with google() and
    mavenCentral(), and dependencyResolutionManagement
    with repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    and repositories google() and mavenCentral().

16. Generate a root build.gradle file using the Gradle
    plugins DSL with Android Gradle Plugin 8.6.1,
    apply false.

17. NEVER generate this block in root build.gradle:
    allprojects { repositories { ... } }

18. NEVER generate project-level repositories blocks
    in root build.gradle or app/build.gradle.

19. Do not use buildscript or allprojects repository
    configuration. Use the plugins DSL.

20. All application dependency repositories must be
    declared centrally in settings.gradle.

21. Generate app/build.gradle with the Android application
    plugin and the correct namespace, applicationId,
    compileSdk, minSdk and targetSdk.

22. Ensure Gradle configuration is compatible with
    Java 17 and Gradle 8.7.

23. Do not mix old buildscript-based and new plugins DSL
    configurations.

24. Ensure settings.gradle, root build.gradle and
    app/build.gradle work together without repository conflicts.

25. Include Gradle wrapper files only if they can be
    generated completely and correctly. Do not create
    fake or empty wrapper files.

RECOMMENDED ROOT build.gradle FORMAT:

plugins {
    id 'com.android.application' version '8.6.1' apply false
}

RECOMMENDED settings.gradle FORMAT:

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Application Name"
include ':app'

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

OUTPUT REQUIREMENTS:

- The files array must contain every required project file.
- There is no fixed number of files.
- Every path must be relative to the project root.
- Every content field must contain the complete file.
- Escape JSON special characters correctly.
- Do not wrap JSON in Markdown code fences.
- Do not include explanations outside JSON.
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
          \`Google API returned HTTP \${response.status}.\`;

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
        .join("\\n")
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
        "build.gradle",
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

      // Validate centralized Gradle repository configuration.
      const rootGradle = cleanFiles.find(
        file => file.path === "build.gradle"
      ).content;

      const settingsGradle = cleanFiles.find(
        file => file.path === "settings.gradle"
      ).content;

      const appGradle = cleanFiles.find(
        file => file.path === "app/build.gradle"
      ).content;

      if (
        /allprojects\s*\{[\s\S]*?repositories\s*\{/i.test(rootGradle) ||
        /repositories\s*\{/i.test(appGradle)
      ) {
        return res.status(502).json({
          error: "Invalid Gradle repository configuration.",
          details:
            "Project-level repositories are forbidden. Put dependency repositories in settings.gradle only."
        });
      }

      if (
        !/dependencyResolutionManagement\s*\{/i.test(settingsGradle) ||
        !/FAIL_ON_PROJECT_REPOS/i.test(settingsGradle) ||
        !/repositories\s*\{/i.test(settingsGradle)
      ) {
        return res.status(502).json({
          error: "Invalid settings.gradle configuration.",
          details:
            "Centralized dependency repositories and FAIL_ON_PROJECT_REPOS are required."
        });
      }

      if (
        !/com\.android\.application/i.test(rootGradle) ||
        !/8\.6\.1/.test(rootGradle)
      ) {
        return res.status(502).json({
          error: "Invalid root build.gradle configuration.",
          details:
            "Android Gradle Plugin 8.6.1 must be declared in the root plugins block."
        });
      }

      return res.status(200).json({
        status: "completed",
        projectName: project.projectName || safeAppName,
        fileCount: cleanFiles.length,
        files: cleanFiles,
        message: "Android project files generated and Gradle configuration validated."
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
