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

  const {
    mode = "generate",
    appName,
    appType,
    features,
    files,
    buildError
  } = req.body || {};

  const isRepair = mode === "repair";

  if (isRepair) {
    const secret = process.env.BUILD_CALLBACK_SECRET;
    const suppliedSecret = req.headers["x-build-callback-secret"];

    if (!secret || suppliedSecret !== secret) {
      return res.status(401).json({
        error: "Unauthorized repair request."
      });
    }

    if (
      !Array.isArray(files) ||
      files.length === 0 ||
      typeof buildError !== "string"
    ) {
      return res.status(400).json({
        error: "Repair requires project files and build errors."
      });
    }

    if (files.length > 80) {
      return res.status(400).json({
        error: "Too many project files for repair."
      });
    }

    const repairFiles = files.filter(file =>
      file &&
      typeof file.path === "string" &&
      typeof file.content === "string" &&
      !file.path.startsWith("/") &&
      !file.path.split("/").includes("..") &&
      /^[a-zA-Z0-9_./-]+$/.test(file.path)
    );

    if (repairFiles.length !== files.length) {
      return res.status(400).json({
        error: "Invalid project file path detected."
      });
    }

    const totalSize = repairFiles.reduce(
      (sum, file) =>
        sum + Buffer.byteLength(file.content, "utf8"),
      0
    );

    if (totalSize > 2 * 1024 * 1024) {
      return res.status(413).json({
        error: "Project files are too large for automatic repair."
      });
    }

    const repairPrompt = `
You are an expert Android Java and Gradle build repair engineer.

A real Android project failed to build.

YOUR TASK:
Repair the existing project using the compiler errors.
Do not create a new unrelated project.

BUILD ERRORS:
${buildError.slice(0, 12000)}

EXISTING PROJECT FILES:
${JSON.stringify(repairFiles)}

IMPORTANT RULES:
1. Fix the actual compiler or Android resource errors.
2. Preserve the app's original purpose and features.
3. Use Java, not Kotlin.
4. Keep package names consistent.
5. Keep Android Gradle Plugin version 8.6.1.
6. Keep compileSdk 35, minSdk 24 and targetSdk 35.
7. Do not add unnecessary dependencies.
8. Do not use missing drawable, mipmap, string, color or style resources.
9. Every referenced resource must exist.
10. Fix Java syntax errors, missing imports and invalid methods.
11. Fix AndroidManifest.xml references.
12. Fix XML resource errors.
13. Never add empty or placeholder files.
14. Do not remove working app features to hide errors.
15. Keep settings.gradle, build.gradle and app/build.gradle compatible.
16. Do not add project-level repositories blocks.
17. Return complete content for every changed file.
18. Include new files only when genuinely required.
19. Do not return unchanged files.
20. If the error cannot be fixed safely, return an empty files array and explain why.

OUTPUT:
Return ONLY valid JSON:
{
  "files": [
    {
      "path": "relative/file/path",
      "content": "complete corrected file content"
    }
  ],
  "message": "Short repair summary"
}

No Markdown fences. No text outside JSON.
`;

    return await callGemini({
      apiKey,
      prompt: repairPrompt,
      res,
      mode: "repair"
    });
  }

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

Generate a COMPLETE, BUILDABLE Android Studio project.

APP NAME:
${safeAppName}

APP CATEGORY:
${safeAppType}

USER REQUIREMENTS:
${safeFeatures}

ANDROID RULES:
1. Use Java only.
2. Use Android Gradle Plugin 8.6.1.
3. Use compileSdk 35, minSdk 24 and targetSdk 35.
4. Use package name com.example.generatedapp.
5. Generate all required project files.
6. Include a working MainActivity.java.
7. Include a complete AndroidManifest.xml.
8. Include all required layouts, values and resources.
9. Never reference a resource that does not exist.
10. Do not create empty files or placeholders.
11. Keep Java package names and folder paths consistent.
12. Do not claim an APK has already been built.

LAUNCHER ICON RULES:
13. Create a valid launcher icon.
14. Use drawable resources for drawable files.
15. Use mipmap resources only for mipmap files.
16. Never reference @mipmap/ic_launcher_foreground.
17. If an adaptive icon is used, its foreground and background resources must exist.
18. If a launcher icon cannot be generated, remove the missing icon reference from the manifest.

GRADLE RULES:
19. settings.gradle must contain pluginManagement repositories:
    google(), mavenCentral(), gradlePluginPortal().
20. settings.gradle must contain dependencyResolutionManagement.
21. Use repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS).
22. Root build.gradle must use plugins DSL.
23. Use id 'com.android.application' version '8.6.1' apply false.
24. Do not use old buildscript configuration.
25. Do not create allprojects repositories blocks.
26. Do not create project-level repositories blocks.
27. app/build.gradle must contain namespace and applicationId.
28. Use Java 17.
29. gradle.properties must contain:
    android.useAndroidX=true
    android.enableJetifier=true
    org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
    org.gradle.parallel=true
30. Ensure Gradle files are compatible.

JAVA RULES:
31. Check all braces, parentheses and semicolons.
32. Check all imports.
33. Check every method is inside the correct class.
34. Do not put statements outside methods.
35. Check all click listeners and callbacks.
36. Ensure MainActivity compiles.

XML RULES:
37. Never generate empty android:id values.
38. Never generate android:id="@+id/".
39. Use valid lowercase resource IDs.
40. Check XML tags are correctly opened and closed.
41. Check all referenced resources exist.

OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "projectName": "${safeAppName}",
  "files": [
    {
      "path": "settings.gradle",
      "content": "complete file content"
    }
  ]
}

OUTPUT REQUIREMENTS:
- Include all required project files.
- Every path must be relative to project root.
- Every content field must contain the complete file.
- Escape JSON special characters correctly.
- Do not use Markdown code fences.
- Do not write explanations outside JSON.
`;

  return await callGemini({
    apiKey,
    prompt,
    res,
    mode: "generate"
  });
}


async function callGemini({ apiKey, prompt, res, mode }) {
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

      const data = await response.json();

      if (!response.ok) {
        const message =
          data.error?.message ||
          `Google API returned HTTP ${response.status}.`;

        if (
          retryableStatuses.includes(response.status) &&
          attempt < maxAttempts
        ) {
          await wait(attempt * 2000);
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
        if (attempt < maxAttempts) {
          await wait(attempt * 2000);
          continue;
        }

        return res.status(502).json({
          error: "Gemini returned no project data.",
          details:
            data.promptFeedback?.blockReason ||
            candidate?.finishReason ||
            "Empty response."
        });
      }

      if (candidate?.finishReason === "MAX_TOKENS") {
        if (attempt < maxAttempts) {
          await wait(attempt * 2000);
          continue;
        }

        return res.status(502).json({
          error: "AI project generation was incomplete.",
          details: "Gemini reached its output token limit."
        });
      }

      const project = parseJsonResponse(output);

      if (!project) {
        if (attempt < maxAttempts) {
          await wait(attempt * 2000);
          continue;
        }

        return res.status(502).json({
          error: "AI returned invalid project JSON.",
          details: "Automatic JSON retry attempts were exhausted."
        });
      }

      if (mode === "repair") {
        return validateRepair(project, res);
      }

      return validateProject(project, res);

    } catch (error) {
      console.error("Gemini request error:", {
        mode,
        attempt,
        name: error.name,
        message: error.message
      });

      const timedOut =
        error.name === "TimeoutError" ||
        error.name === "AbortError";

      if (attempt < maxAttempts) {
        await wait(attempt * 2000);
        continue;
      }

      return res.status(timedOut ? 504 : 502).json({
        error: timedOut
          ? "Gemini request timed out."
          : "Could not get a response from Gemini.",
        details: error.message
      });
    }
  }

  return res.status(502).json({
    error: "All Gemini attempts failed."
  });
}


function parseJsonResponse(output) {
  const cleaned = output
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(
      cleaned.slice(firstBrace, lastBrace + 1)
    );
  } catch {
    return null;
  }
}


function validateRepair(project, res) {
  if (!project || !Array.isArray(project.files)) {
    return res.status(502).json({
      error: "AI returned an invalid repair response."
    });
  }

  if (project.files.length === 0) {
    return res.status(422).json({
      error: "AI could not safely repair this build.",
      details: project.message || "No corrected files were returned."
    });
  }

  if (project.files.length > 80) {
    return res.status(502).json({
      error: "Too many repaired files were returned."
    });
  }

  const seen = new Set();
  const cleanFiles = [];

  for (const file of project.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    ) {
      return res.status(502).json({
        error: "Invalid repaired file."
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
        error: "Unsafe repaired file path.",
        details: path
      });
    }

    if (seen.has(path)) {
      return res.status(502).json({
        error: "Duplicate repaired file path.",
        details: path
      });
    }

    seen.add(path);

    if (
      path.startsWith("app/src/main/res/") &&
      path.endsWith(".xml")
    ) {
      const invalidId =
        /\bandroid:id\s*=\s*(["'])\s*(?:@(?:\+)?id\/)?\s*\1/;

      if (invalidId.test(file.content)) {
        return res.status(422).json({
          error: "Repair returned an invalid Android XML ID.",
          details: path
        });
      }
    }

    cleanFiles.push({ path, content: file.content });
  }

  return res.status(200).json({
    status: "repaired",
    files: cleanFiles,
    message: project.message || "Project repair completed."
  });
}


function validateProject(project, res) {
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
  const seen = new Set();

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

    if (seen.has(path)) {
      return res.status(502).json({
        error: "Duplicate project file was detected.",
        details: path
      });
    }

    seen.add(path);

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

      const invalidId =
        /\bandroid:id\s*=\s*(["'])\s*(?:@(?:\+)?id\/)?\s*\1/;

      if (invalidId.test(content)) {
        return res.status(422).json({
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
    "app/src/main/AndroidManifest.xml"
  ];

  const missing = requiredFiles.filter(
    path => !seen.has(path)
  );

  if (missing.length > 0) {
    return res.status(422).json({
      error: "The Android project is missing required files.",
      missingFiles: missing
    });
  }

  ensureGradleProperties(cleanFiles);

  fixLauncherReferences(cleanFiles);

  const rootGradle = getFile(cleanFiles, "build.gradle");
  const settingsGradle = getFile(cleanFiles, "settings.gradle");
  const appGradle = getFile(cleanFiles, "app/build.gradle");

  if (
    /allprojects\s*\{[\s\S]*?repositories\s*\{/i.test(rootGradle) ||
    /^\s*repositories\s*\{/im.test(rootGradle) ||
    /^\s*repositories\s*\{/im.test(appGradle)
  ) {
    return res.status(422).json({
      error: "Invalid Gradle repository configuration."
    });
  }

  if (
    !/pluginManagement\s*\{/i.test(settingsGradle) ||
    !/dependencyResolutionManagement\s*\{/i.test(settingsGradle) ||
    !/FAIL_ON_PROJECT_REPOS/i.test(settingsGradle)
  ) {
    return res.status(422).json({
      error: "Invalid settings.gradle configuration."
    });
  }

  if (
    !/com\.android\.application/i.test(rootGradle) ||
    !/8\.6\.1/i.test(rootGradle) ||
    !/apply\s+false/i.test(rootGradle)
  ) {
    return res.status(422).json({
      error: "Invalid root build.gradle configuration."
    });
  }

  if (
    !/com\.android\.application/i.test(appGradle) ||
    !/namespace\s+/i.test(appGradle) ||
    !/applicationId\s+/i.test(appGradle)
  ) {
    return res.status(422).json({
      error: "Invalid app/build.gradle configuration."
    });
  }

  const manifest = getFile(
    cleanFiles,
    "app/src/main/AndroidManifest.xml"
  );

  if (!/<manifest[\s>]/i.test(manifest)) {
    return res.status(422).json({
      error: "AndroidManifest.xml is invalid."
    });
  }

  const totalSize = cleanFiles.reduce(
    (sum, file) =>
      sum + Buffer.byteLength(file.content, "utf8"),
    0
  );

  if (totalSize > 2 * 1024 * 1024) {
    return res.status(413).json({
      error: "The generated project is too large."
    });
  }

  return res.status(200).json({
    status: "completed",
    projectName: project.projectName || "Android App",
    fileCount: cleanFiles.length,
    files: cleanFiles,
    message: "Android project generated and validated."
  });
}


function ensureGradleProperties(files) {
  const path = "gradle.properties";

  let file = files.find(item => item.path === path);

  const required = {
    "android.useAndroidX": "true",
    "android.enableJetifier": "true",
    "org.gradle.jvmargs": "-Xmx2048m -Dfile.encoding=UTF-8",
    "org.gradle.parallel": "true"
  };

  const lines = (file?.content || "")
    .split(/\r?\n/)
    .filter(line => line.trim());

  for (const [key, value] of Object.entries(required)) {
    const index = lines.findIndex(line =>
      line.trim().startsWith(key + "=")
    );

    if (index >= 0) {
      lines[index] = `${key}=${value}`;
    } else {
      lines.push(`${key}=${value}`);
    }
  }

  const content = lines.join("\n") + "\n";

  if (file) {
    file.content = content;
  } else {
    files.push({ path, content });
  }
}


function fixLauncherReferences(files) {
  const manifest = files.find(
    file =>
      file.path === "app/src/main/AndroidManifest.xml"
  );

  if (!manifest) return;

  const exists = path =>
    files.some(file => file.path === path);

  const foregroundPath =
    "app/src/main/res/drawable/ic_launcher_foreground.xml";

  if (exists(foregroundPath)) {
    for (const file of files) {
      if (
        file.path.startsWith("app/src/main/res/") &&
        file.path.endsWith(".xml")
      ) {
        file.content = file.content.replace(
          /@mipmap\/ic_launcher_foreground\b/g,
          "@drawable/ic_launcher_foreground"
        );
      }
    }
  }

  const iconExists = name =>
    files.some(file => {
      const match = file.path.match(
        /^app\/src\/main\/res\/(mipmap[^/]+)\/([^/]+)$/
      );

      return Boolean(
        match &&
        match[2].replace(/\.(xml|png|webp|jpg)$/i, "") === name
      );
    });

  if (!iconExists("ic_launcher")) {
    manifest.content = manifest.content.replace(
      /\s+android:icon\s*=\s*["']@mipmap\/ic_launcher["']/g,
      ""
    );
  }

  if (!iconExists("ic_launcher_round")) {
    manifest.content = manifest.content.replace(
      /\s+android:roundIcon\s*=\s*["']@mipmap\/ic_launcher_round["']/g,
      ""
    );
  }
}


function getFile(files, path) {
  return files.find(file => file.path === path)?.content || "";
}


function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
