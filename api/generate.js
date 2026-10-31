
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
You are an expert Android Java developer.

Create a COMPLETE, BUILDABLE Android Studio project.

APP NAME:
${safeAppName}

APP CATEGORY:
${safeAppType}

USER REQUIREMENTS:
${safeFeatures}

ANDROID PROJECT REQUIREMENTS:

1. Use Java only. Do not use Kotlin.
2. Use package name com.example.generatedapp.
3. Use Android Gradle Plugin 8.6.1.
4. Use compileSdk 35.
5. Use minSdk 24.
6. Use targetSdk 35.
7. Use Java 17.
8. Generate every file required by the requested app.
9. Include a working MainActivity.java.
10. Include a complete AndroidManifest.xml.
11. Include settings.gradle.
12. Include root build.gradle.
13. Include app/build.gradle.
14. Include gradle.properties.
15. Include all required layouts, values, drawables and other resources.
16. Do not create empty files.
17. Do not use placeholder code.
18. Do not claim that the APK has already been built.

JAVA CODE RULES:

19. Every Java class must have correctly balanced braces.
20. Every method must be completely inside its class.
21. Never place statements outside a method or class.
22. Do not generate stray closing braces.
23. Do not generate stray }); statements.
24. Every addOnClickListener must have valid Java syntax.
25. Prefer standard Android Java anonymous listener classes instead of complicated lambda expressions.
26. Every referenced Java class must exist.
27. Every imported class must be available.
28. Use valid Android APIs.
29. Do not invent methods or resource IDs.
30. Check MainActivity.java carefully before returning JSON.
31. Check all Java files for syntax errors.
32. Keep Java package declarations consistent with file paths.

ANDROID RESOURCE RULES:

33. Every referenced layout, drawable, string, color and style must exist.
34. Resource filenames must use lowercase letters, numbers and underscores.
35. Never reference a missing resource.
36. Do not generate adaptive launcher icons.
37. Do not reference ic_launcher_foreground.
38. If generating a launcher icon, create a valid drawable XML named ic_launcher.xml.
39. If no valid launcher icon is generated, omit icon references from the manifest.
40. Never use @mipmap/ic_launcher unless that resource actually exists.
41. Never use @mipmap/ic_launcher_foreground.
42. Check all XML files for valid syntax.

XML ID RULES:

43. Never generate android:id="".
44. Never generate android:id="@+id/".
45. Every generated ID must be valid.
46. Use IDs such as @+id/main_button.
47. Do not reference IDs that do not exist.

GRADLE RULES:

48. Use plugins DSL in root build.gradle.
49. Root build.gradle must use:
    id 'com.android.application' version '8.6.1' apply false
50. settings.gradle must contain pluginManagement.
51. Include google(), mavenCentral() and gradlePluginPortal() in pluginManagement.
52. Include dependencyResolutionManagement.
53. Use RepositoriesMode.FAIL_ON_PROJECT_REPOS.
54. Put dependency repositories only in settings.gradle.
55. Never use allprojects repositories.
56. Never use project-level repositories.
57. Do not use old buildscript configuration.
58. app/build.gradle must include namespace and applicationId.
59. Include all dependencies required by the app.
60. gradle.properties must contain:
    android.useAndroidX=true
    android.enableJetifier=true
    org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
    org.gradle.parallel=true

FINAL SELF-CHECK:

Before returning the project:
- Review every Java file.
- Review MainActivity.java line by line.
- Check all opening and closing braces.
- Check all listener syntax.
- Check every XML resource reference.
- Check manifest activity declarations.
- Check Gradle plugin versions.
- Check that all required files exist.
- Fix detected errors before returning the result.

OUTPUT FORMAT:

Return ONLY valid JSON.

{
  "projectName": "Application Name",
  "files": [
    {
      "path": "settings.gradle",
      "content": "complete file content"
    }
  ]
}

OUTPUT RULES:

- Include every required project file.
- Every path must be relative to the project root.
- Every content field must contain complete file contents.
- Escape JSON characters correctly.
- Do not use Markdown code fences.
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
              temperature: 0.1,
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
          details: "Gemini reached its output token limit."
        });
      }

      let project;

      try {
        const cleanedOutput = output
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        project = JSON.parse(cleanedOutput);
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
            error: "Duplicate project file was detected.",
            details: path
          });
        }

        seenPaths.add(path);

        let content = file.content;

        if (
          path.startsWith("app/src/main/res/") &&
          path.endsWith(".xml")
        ) {
          content = content.replace(
            /\s+android:id\s*=\s*(["'])\s*\1/g,
            ""
          );

          content = content.replace(
            /\s+android:id\s*=\s*(["'])@(?:\+)?id\/\s*\1/g,
            ""
          );

          const invalidIdPattern =
            /\bandroid:id\s*=\s*(["'])\s*(?:@(?:\+)?id\/)?\s*\1/;

          if (invalidIdPattern.test(content)) {
            return res.status(502).json({
              error: "Invalid empty Android XML ID detected.",
              details: path
            });
          }
        }

        cleanFiles.push({ path, content });
      }

      const requiredFiles = [
        "settings.gradle",
        "build.gradle",
        "app/build.gradle",
        "app/src/main/AndroidManifest.xml",
        "gradle.properties",
        "app/src/main/java/com/example/generatedapp/MainActivity.java"
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

      const gradlePropertiesPath = "gradle.properties";

      let gradlePropertiesFile = cleanFiles.find(
        file => file.path === gradlePropertiesPath
      );

      let propertyLines = gradlePropertiesFile.content
        .split(/\r?\n/)
        .filter(line => line.trim() !== "");

      const requiredProperties = {
        "android.useAndroidX": "true",
        "android.enableJetifier": "true",
        "org.gradle.jvmargs": "-Xmx2048m -Dfile.encoding=UTF-8",
        "org.gradle.parallel": "true"
      };

      for (const [key, value] of Object.entries(requiredProperties)) {
        const index = propertyLines.findIndex(line =>
          line.trim().startsWith(key + "=")
        );

        if (index >= 0) {
          propertyLines[index] = `${key}=${value}`;
        } else {
          propertyLines.push(`${key}=${value}`);
        }
      }

      gradlePropertiesFile.content =
        propertyLines.join("\n") + "\n";

      // Check Java package declaration.
      const mainActivity = cleanFiles.find(
        file =>
          file.path ===
          "app/src/main/java/com/example/generatedapp/MainActivity.java"
      );

      if (
        !/package\s+com\.example\.generatedapp\s*;/.test(
          mainActivity.content
        )
      ) {
        return res.status(502).json({
          error: "MainActivity Java package is incorrect."
        });
      }

      // Basic Java structure checks.
      for (const file of cleanFiles.filter(
        item => item.path.endsWith(".java")
      )) {
        let balance = 0;
        let inString = false;
        let inChar = false;
        let escaped = false;
        let inLineComment = false;
        let inBlockComment = false;

        const source = file.content;

        for (let i = 0; i < source.length; i++) {
          const char = source[i];
          const next = source[i + 1];

          if (inLineComment) {
            if (char === "\n") inLineComment = false;
            continue;
          }

          if (inBlockComment) {
            if (char === "*" && next === "/") {
              inBlockComment = false;
              i++;
            }
            continue;
          }

          if (inString || inChar) {
            if (escaped) {
              escaped = false;
              continue;
            }

            if (char === "\\") {
              escaped = true;
              continue;
            }

            if (inString && char === '"') inString = false;
            if (inChar && char === "'") inChar = false;
            continue;
          }

          if (char === "/" && next === "/") {
            inLineComment = true;
            i++;
            continue;
          }

          if (char === "/" && next === "*") {
            inBlockComment = true;
            i++;
            continue;
          }

          if (char === '"') {
            inString = true;
            continue;
          }

          if (char === "'") {
            inChar = true;
            continue;
          }

          if (char === "{") balance++;
          if (char === "}") balance--;

          if (balance < 0) break;
        }

        if (balance !== 0 || inString || inChar || inBlockComment) {
          return res.status(502).json({
            error: "Java source structure validation failed.",
            details: file.path
          });
        }

        if (/\b(?:TODO|FIXME)\b/.test(source)) {
          return res.status(502).json({
            error: "Incomplete Java code was detected.",
            details: file.path
          });
        }
      }

      // Fix launcher icon references.
      const manifestFile = cleanFiles.find(
        file =>
          file.path === "app/src/main/AndroidManifest.xml"
      );

      const hasDrawableIcon = cleanFiles.some(
        file =>
          file.path ===
          "app/src/main/res/drawable/ic_launcher.xml"
      );

      const hasMipmapIcon = cleanFiles.some(
        file =>
          /^app\/src\/main\/res\/mipmap[^/]*\/ic_launcher\.(xml|png|webp|jpg)$/i
            .test(file.path)
      );

      if (!hasDrawableIcon && !hasMipmapIcon) {
        manifestFile.content = manifestFile.content.replace(
          /\s+android:icon\s*=\s*["'][^"']+["']/g,
          ""
        );
      } else if (hasDrawableIcon) {
        manifestFile.content = manifestFile.content.replace(
          /android:icon\s*=\s*["']@mipmap\/ic_launcher["']/g,
          'android:icon="@drawable/ic_launcher"'
        );
      }

      // Validate Gradle configuration.
      const rootGradle = cleanFiles.find(
        file => file.path === "build.gradle"
      ).content;

      const settingsGradle = cleanFiles.find(
        file => file.path === "settings.gradle"
      ).content;

      const appGradle = cleanFiles.find(
        file => file.path === "app/build.gradle"
      ).content;

      const finalProperties = gradlePropertiesFile.content;

      if (
        /allprojects\s*\{[\s\S]*?repositories\s*\{/i.test(rootGradle) ||
        /^\s*repositories\s*\{/im.test(rootGradle) ||
        /^\s*repositories\s*\{/im.test(appGradle)
      ) {
        return res.status(502).json({
          error: "Invalid Gradle repository configuration."
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
        !/com\.android\.application/i.test(rootGradle) ||
        !/8\.6\.1/.test(rootGradle) ||
        !/apply\s+false/i.test(rootGradle)
      ) {
        return res.status(502).json({
          error: "Invalid root build.gradle configuration."
        });
      }

      if (
        !/com\.android\.application/i.test(appGradle) ||
        !/namespace\s+/.test(appGradle) ||
        !/applicationId\s+/.test(appGradle)
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
          error: "The generated project is too large."
        });
      }

      return res.status(200).json({
        status: "completed",
        projectName: project.projectName || safeAppName,
        fileCount: cleanFiles.length,
        files: cleanFiles,
        message:
          "Android project generated and basic validation completed."
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
