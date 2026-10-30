
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
11. Do not generate empty files or placeholders.
12. All referenced files and resources must exist.
13. Keep package names, resource names and paths consistent.
14. Do not claim that an APK has already been built.

LAUNCHER ICON RULES:

15. Generate valid launcher icon resources.
16. If launcher icon resources are unavailable,
    do not reference missing @mipmap/ic_launcher
    or @mipmap/ic_launcher_round resources.
17. All manifest icon references must point to existing resources.

CRITICAL GRADLE RULES:

18. Generate settings.gradle with pluginManagement repositories
    containing google(), mavenCentral() and gradlePluginPortal().

19. Generate dependencyResolutionManagement with:
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories containing google() and mavenCentral().

20. Generate root build.gradle using plugins DSL:
    id 'com.android.application' version '8.6.1' apply false

21. NEVER generate allprojects repositories blocks.
22. NEVER generate project-level repositories blocks.
23. Do not use old buildscript configuration.
24. Generate app/build.gradle with Android application plugin,
    namespace, applicationId, compileSdk, minSdk and targetSdk.

25. Generate gradle.properties containing:
    android.useAndroidX=true
    android.enableJetifier=true
    org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
    org.gradle.parallel=true

26. Use Java 17 and Gradle 8.7 or newer.
27. Do not mix old buildscript and plugins DSL.
28. Ensure all Gradle files work together.
29. Include Gradle wrapper files only if complete.
30. Generate all dependencies required by app features.
31. Check all generated resources and Java classes.

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
    },
    {
      "path": "gradle.properties",
      "content": "complete file content"
    }
  ]
}

OUTPUT REQUIREMENTS:

- Include every required project file.
- There is no fixed number of files.
- Every path must be relative to the project root.
- Every content field must contain the complete file.
- Escape JSON special characters correctly.
- Do not wrap JSON in Markdown code fences.
- Do not include explanations outside JSON.
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
      } catch {
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
          details: "The output token limit was reached."
        });
      }

      let project;

      try {
        project = JSON.parse(output);
      } catch {
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
          error: "The project contains too many files."
        });
      }

      const cleanFiles = [];
      const seenPaths = new Set();

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
          path.split("/").includes("..") ||
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

        cleanFiles.push({
          path,
          content: file.content
        });
      }

      const gradlePropertiesPath = "gradle.properties";

      let gradlePropertiesFile = cleanFiles.find(
        file => file.path === gradlePropertiesPath
      );

      let propertiesContent = gradlePropertiesFile
        ? gradlePropertiesFile.content
        : "";

      const requiredProperties = {
        "android.useAndroidX": "true",
        "android.enableJetifier": "true",
        "org.gradle.jvmargs": "-Xmx2048m -Dfile.encoding=UTF-8",
        "org.gradle.parallel": "true"
      };

      const propertyLines = propertiesContent
        .split(/\r?\n/)
        .filter(line => line.trim() !== "");

      for (const [key, value] of Object.entries(requiredProperties)) {
        const index = propertyLines.findIndex(line =>
          line.trim().replace(/^#\s*/, "").startsWith(key + "=")
        );

        if (index >= 0) {
          propertyLines[index] = `${key}=${value}`;
        } else {
          propertyLines.push(`${key}=${value}`);
        }
      }

      propertiesContent = propertyLines.join("\n") + "\n";

      if (gradlePropertiesFile) {
        gradlePropertiesFile.content = propertiesContent;
      } else {
        gradlePropertiesFile = {
          path: gradlePropertiesPath,
          content: propertiesContent
        };
        cleanFiles.push(gradlePropertiesFile);
        seenPaths.add(gradlePropertiesPath);
      }

      const requiredFiles = [
        "settings.gradle",
        "build.gradle",
        "app/build.gradle",
        "app/src/main/AndroidManifest.xml",
        "gradle.properties"
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

      // Fix missing launcher icon resources.
      const manifestFile = cleanFiles.find(
        file =>
          file.path === "app/src/main/AndroidManifest.xml"
      );

      const hasLauncherIcon = name => {
        const allowedExtensions = [".xml", ".png", ".webp", ".jpg"];

        return cleanFiles.some(file => {
          const prefix = "app/src/main/res/";
          if (!file.path.startsWith(prefix)) return false;

          const relativePath = file.path.slice(prefix.length);
          const parts = relativePath.split("/");

          if (parts.length !== 2) return false;
          if (!parts[0].startsWith("mipmap")) return false;

          return allowedExtensions.some(extension =>
            parts[1].toLowerCase() ===
            (name + extension).toLowerCase()
          );
        });
      };

      if (manifestFile) {
        if (!hasLauncherIcon("ic_launcher")) {
          manifestFile.content =
            manifestFile.content.replace(
              /\s+android:icon\s*=\s*["']@mipmap\/ic_launcher["']/g,
              ""
            );
        }

        if (!hasLauncherIcon("ic_launcher_round")) {
          manifestFile.content =
            manifestFile.content.replace(
              /\s+android:roundIcon\s*=\s*["']@mipmap\/ic_launcher_round["']/g,
              ""
            );
        }
      }

      const rootGradle = cleanFiles.find(
        file => file.path === "build.gradle"
      ).content;

      const settingsGradle = cleanFiles.find(
        file => file.path === "settings.gradle"
      ).content;

      const appGradle = cleanFiles.find(
        file => file.path === "app/build.gradle"
      ).content;

      const finalProperties = cleanFiles.find(
        file => file.path === "gradle.properties"
      ).content;

      if (
        /allprojects\s*\{[\s\S]*?repositories\s*\{/i.test(rootGradle) ||
        /^\s*repositories\s*\{/im.test(rootGradle) ||
        /^\s*repositories\s*\{/im.test(appGradle)
      ) {
        return res.status(502).json({
          error: "Invalid Gradle repository configuration.",
          details:
            "Project-level repositories are forbidden. Use settings.gradle only."
        });
      }

      if (
        !/pluginManagement\s*\{/i.test(settingsGradle) ||
        !/dependencyResolutionManagement\s*\{/i.test(settingsGradle) ||
        !/FAIL_ON_PROJECT_REPOS/i.test(settingsGradle) ||
        !/repositories\s*\{/i.test(settingsGradle)
      ) {
        return res.status(502).json({
          error: "Invalid settings.gradle configuration."
        });
      }

      if (
        !/plugins\s*\{[\s\S]*?com\.android\.application[\s\S]*?8\.6\.1[\s\S]*?apply\s+false/i.test(rootGradle)
      ) {
        return res.status(502).json({
          error: "Invalid root build.gradle configuration."
        });
      }

      if (
        !/com\.android\.application/i.test(appGradle) ||
        !/namespace\s+/i.test(appGradle) ||
        !/applicationId\s+/i.test(appGradle)
      ) {
        return res.status(502).json({
          error: "Invalid app/build.gradle configuration."
        });
      }

      if (
        !/android\.useAndroidX\s*=\s*true/i.test(finalProperties) ||
        !/android\.enableJetifier\s*=\s*true/i.test(finalProperties)
      ) {
        return res.status(502).json({
          error: "AndroidX configuration is missing."
        });
      }

      const totalSize = cleanFiles.reduce(
        (sum, file) =>
          sum + new TextEncoder().encode(file.content).length,
        0
      );

      if (totalSize > 2 * 1024 * 1024) {
        return res.status(502).json({
          error: "The generated project is too large.",
          details: "The current size limit is 2 MB."
        });
      }

      return res.status(200).json({
        status: "completed",
        projectName: project.projectName || safeAppName,
        fileCount: cleanFiles.length,
        files: cleanFiles,
        message:
          "Android project files generated and Gradle configuration validated."
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
