
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

const MAX_FILES = 80;
const MAX_PROJECT_SIZE = 2 * 1024 * 1024;

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

  const body = req.body || {};
  const mode = body.mode || "generate";

  if (mode === "repair") {
    return handleRepair(req, res, apiKey, body);
  }

  if (mode !== "generate") {
    return res.status(400).json({
      error: "Invalid request mode."
    });
  }

  const { appName, appType, features } = body;

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

Create a complete, buildable Android Studio project.

APP NAME:
${safeAppName}

APP CATEGORY:
${safeAppType}

USER REQUIREMENTS:
${safeFeatures}

ANDROID REQUIREMENTS:

1. Use Java only. Never use Kotlin.
2. Package name: com.example.generatedapp.
3. Android Gradle Plugin version 8.6.1.
4. compileSdk 35.
5. minSdk 24.
6. targetSdk 35.
7. Java 17.
8. Include settings.gradle.
9. Include root build.gradle.
10. Include app/build.gradle.
11. Include gradle.properties.
12. Include app/src/main/AndroidManifest.xml.
13. Include app/src/main/java/com/example/generatedapp/MainActivity.java.
14. Include every required layout and resource.
15. Include a working launcher Activity.
16. All referenced resources must exist.
17. Never generate empty or placeholder files.
18. Do not include incomplete Gradle wrapper files.
19. Do not claim that the APK is already built.

JAVA RULES:

20. Check every Java file for syntax errors.
21. All braces and parentheses must be balanced.
22. All methods must be inside the correct class.
23. Never put statements outside methods.
24. Every click listener must have valid Java syntax.
25. Prefer standard anonymous listener classes.
26. Never generate stray }); statements.
27. Every import and referenced class must exist.
28. Java package declarations must match file paths.

RESOURCE RULES:

29. Every referenced resource must exist.
30. Resource filenames must use lowercase letters, numbers and underscores.
31. Never reference a missing drawable, mipmap, string, color or style.
32. Do not generate adaptive launcher icons.
33. Create a valid drawable/ic_launcher.xml launcher icon.
34. If no launcher icon is generated, omit icon references from the manifest.
35. Never reference @mipmap/ic_launcher_foreground.
36. Every XML file must be valid.
37. Never generate empty android:id values.
38. Use valid IDs such as @+id/main_button.

GRADLE RULES:

39. Use plugins DSL.
40. Root build.gradle must contain:
    id 'com.android.application' version '8.6.1' apply false
41. settings.gradle must contain pluginManagement.
42. Include google(), mavenCentral() and gradlePluginPortal() in pluginManagement.
43. Include dependencyResolutionManagement.
44. Use RepositoriesMode.FAIL_ON_PROJECT_REPOS.
45. Keep dependency repositories only in settings.gradle.
46. Never use allprojects repositories.
47. Never use project-level repositories.
48. Do not use old buildscript configuration.
49. app/build.gradle must contain namespace and applicationId.
50. gradle.properties must contain:
    android.useAndroidX=true
    android.enableJetifier=true
    org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
    org.gradle.parallel=true

FINAL CHECK:
Review all Java, XML, manifest and Gradle files.
Fix detected errors before returning the project.

RETURN ONLY VALID JSON:
{
  "projectName": "Application Name",
  "files": [
    {
      "path": "settings.gradle",
      "content": "complete file content"
    }
  ]
}

No Markdown fences.
No explanation outside JSON.
Every file must contain complete content.
Every path must be relative to the project root.
`;

  const result = await callGemini(apiKey, prompt);

  if (!result.ok) {
    return res.status(502).json({
      error: result.error,
      details: result.details
    });
  }

  return validateProject(result.data, res, safeAppName);
}


async function handleRepair(req, res, apiKey, body) {
  const secret = process.env.BUILD_CALLBACK_SECRET;
  const suppliedSecret = req.headers["x-build-callback-secret"];

  if (!secret || suppliedSecret !== secret) {
    return res.status(401).json({
      error: "Unauthorized repair request."
    });
  }

  if (
    !Array.isArray(body.files) ||
    body.files.length === 0 ||
    typeof body.buildError !== "string"
  ) {
    return res.status(400).json({
      error: "Repair requires project files and build errors."
    });
  }

  if (body.files.length > MAX_FILES) {
    return res.status(400).json({
      error: "Too many project files."
    });
  }

  const files = [];
  const seen = new Set();

  for (const file of body.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    ) {
      return res.status(400).json({
        error: "Invalid repair file."
      });
    }

    const path = safePath(file.path);

    if (!path || seen.has(path)) {
      return res.status(400).json({
        error: "Invalid or duplicate repair file path."
      });
    }

    seen.add(path);
    files.push({ path, content: file.content });
  }

  const totalSize = files.reduce(
    (sum, file) =>
      sum + Buffer.byteLength(file.content, "utf8"),
    0
  );

  if (totalSize > MAX_PROJECT_SIZE) {
    return res.status(413).json({
      error: "Project files are too large for repair."
    });
  }

  const prompt = `
You are an expert Android Java and Gradle repair engineer.

Repair the existing Android project. Do not create an unrelated project.

BUILD ERROR:
${body.buildError.slice(-12000)}

EXISTING PROJECT FILES:
${JSON.stringify(files)}

RULES:
1. Fix the actual build errors.
2. Preserve the original app purpose and features.
3. Use Java only.
4. Keep package name com.example.generatedapp.
5. Keep Android Gradle Plugin 8.6.1.
6. Keep compileSdk 35, minSdk 24 and targetSdk 35.
7. Fix Java syntax errors and missing imports.
8. Fix invalid Android XML and missing resources.
9. Fix manifest references.
10. Fix Gradle configuration only when necessary.
11. Do not add unnecessary dependencies.
12. Do not remove working app features to hide errors.
13. Return complete contents of every changed file.
14. Include new files only when required.
15. Do not return unchanged files.
16. If you cannot safely repair the project, return an empty files array.

RETURN ONLY JSON:
{
  "files": [
    {
      "path": "relative/file/path",
      "content": "complete corrected content"
    }
  ],
  "message": "Short repair summary"
}

No Markdown fences or extra text.
`;

  const result = await callGemini(apiKey, prompt);

  if (!result.ok) {
    return res.status(502).json({
      error: "AI repair request failed.",
      details: result.details
    });
  }

  const project = result.data;

  if (
    !project ||
    !Array.isArray(project.files) ||
    project.files.length === 0
  ) {
    return res.status(422).json({
      error: "AI could not repair the project.",
      details: project?.message || "No repaired files returned."
    });
  }

  if (project.files.length > MAX_FILES) {
    return res.status(422).json({
      error: "Too many repaired files returned."
    });
  }

  const repaired = [];
  const repairedPaths = new Set();

  for (const file of project.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    ) {
      return res.status(422).json({
        error: "AI returned an invalid repaired file."
      });
    }

    const path = safePath(file.path);

    if (!path || repairedPaths.has(path)) {
      return res.status(422).json({
        error: "Invalid or duplicate repaired file path."
      });
    }

    repairedPaths.add(path);

    if (
      path.endsWith(".java") &&
      !checkJavaBraces(file.content)
    ) {
      return res.status(422).json({
        error: "AI returned Java with unbalanced braces.",
        details: path
      });
    }

    repaired.push({ path, content: file.content });
  }

  const repairedSize = repaired.reduce(
    (sum, file) =>
      sum + Buffer.byteLength(file.content, "utf8"),
    0
  );

  if (repairedSize > MAX_PROJECT_SIZE) {
    return res.status(413).json({
      error: "Repaired files are too large."
    });
  }

  return res.status(200).json({
    status: "repaired",
    files: repaired,
    message: project.message || "AI repair completed."
  });
}


async function callGemini(apiKey, prompt) {
  const retryable = [429, 500, 502, 503, 504];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(GEMINI_URL, {
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
      });

      const data = await response.json();

      if (!response.ok) {
        const message =
          data.error?.message ||
          `Google API HTTP ${response.status}`;

        if (retryable.includes(response.status) && attempt < 3) {
          await wait(attempt * 2000);
          continue;
        }

        return { ok: false, details: message };
      }

      const candidate = data.candidates?.[0];
      const output = (data.candidates || [])
        .flatMap(item => item.content?.parts || [])
        .map(part => part.text || "")
        .join("\n")
        .trim();

      if (!output) {
        return {
          ok: false,
          error: "Gemini returned no project data.",
          details:
            data.promptFeedback?.blockReason ||
            candidate?.finishReason ||
            "Empty response."
        };
      }

      if (candidate?.finishReason === "MAX_TOKENS") {
        return {
          ok: false,
          details: "Gemini output reached its token limit."
        };
      }

      const parsed = parseJson(output);

      if (!parsed) {
        return {
          ok: false,
          details: "Gemini response was not valid complete JSON."
        };
      }

      return { ok: true, data: parsed };

    } catch (error) {
      if (attempt < 3) {
        await wait(attempt * 2000);
        continue;
      }

      return {
        ok: false,
        details: error.message
      };
    }
  }

  return {
    ok: false,
    details: "All Gemini attempts failed."
  };
}


function parseJson(output) {
  const cleaned = output
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const start = cleaned.indexOf("{");

  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;

      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}


function validateProject(project, res, appName) {
  if (
    !project ||
    !Array.isArray(project.files) ||
    project.files.length === 0
  ) {
    return res.status(502).json({
      error: "No project files were returned."
    });
  }

  if (project.files.length > MAX_FILES) {
    return res.status(502).json({
      error: "Too many project files were returned."
    });
  }

  const files = [];
  const seen = new Set();

  for (const file of project.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    ) {
      return res.status(502).json({
        error: "Invalid project file."
      });
    }

    const path = safePath(file.path);

    if (!path || seen.has(path)) {
      return res.status(502).json({
        error: "Unsafe or duplicate project path.",
        details: file.path
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

      if (
        /\bandroid:id\s*=\s*(["'])\s*(?:@(?:\+)?id\/)?\s*\1/.test(content)
      ) {
        return res.status(422).json({
          error: "Invalid empty Android XML ID.",
          details: path
        });
      }
    }

    files.push({ path, content });
  }

  const required = [
    "settings.gradle",
    "build.gradle",
    "app/build.gradle",
    "app/src/main/AndroidManifest.xml",
    "app/src/main/java/com/example/generatedapp/MainActivity.java"
  ];

  const missing = required.filter(path => !seen.has(path));

  if (missing.length) {
    return res.status(422).json({
      error: "Required Android files are missing.",
      missingFiles: missing
    });
  }

  ensureGradleProperties(files);

  const mainActivity = files.find(
    file =>
      file.path ===
      "app/src/main/java/com/example/generatedapp/MainActivity.java"
  );

  if (
    !/package\s+com\.example\.generatedapp\s*;/.test(
      mainActivity.content
    )
  ) {
    return res.status(422).json({
      error: "MainActivity package declaration is incorrect."
    });
  }

  for (const file of files.filter(
    item => item.path.endsWith(".java")
  )) {
    if (!checkJavaBraces(file.content)) {
      return res.status(422).json({
        error: "Java structure validation failed.",
        details: file.path
      });
    }
  }

  const settings = getContent(files, "settings.gradle");
  const root = getContent(files, "build.gradle");
  const app = getContent(files, "app/build.gradle");

  if (
    !/pluginManagement\s*\{/.test(settings) ||
    !/dependencyResolutionManagement\s*\{/.test(settings) ||
    !/FAIL_ON_PROJECT_REPOS/.test(settings)
  ) {
    return res.status(422).json({
      error: "Invalid settings.gradle configuration."
    });
  }

  if (
    !/com\.android\.application/.test(root) ||
    !/8\.6\.1/.test(root) ||
    !/apply\s+false/.test(root)
  ) {
    return res.status(422).json({
      error: "Invalid root build.gradle configuration."
    });
  }

  if (
    !/com\.android\.application/.test(app) ||
    !/namespace\s+/.test(app) ||
    !/applicationId\s+/.test(app)
  ) {
    return res.status(422).json({
      error: "Invalid app/build.gradle configuration."
    });
  }

  if (
    /allprojects\s*\{[\s\S]*?repositories\s*\{/i.test(root) ||
    /^\s*repositories\s*\{/im.test(root) ||
    /^\s*repositories\s*\{/im.test(app)
  ) {
    return res.status(422).json({
      error: "Project-level repositories are not allowed."
    });
  }

  const totalSize = files.reduce(
    (sum, file) =>
      sum + Buffer.byteLength(file.content, "utf8"),
    0
  );

  if (totalSize > MAX_PROJECT_SIZE) {
    return res.status(413).json({
      error: "Generated project is too large."
    });
  }

  return res.status(200).json({
    status: "completed",
    projectName: project.projectName || appName,
    fileCount: files.length,
    files,
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


function safePath(value) {
  const path = value.replace(/\\/g, "/").trim();

  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").includes("..") ||
    !/^[a-zA-Z0-9_./-]+$/.test(path)
  ) {
    return null;
  }

  return path;
}


function getContent(files, path) {
  return files.find(file => file.path === path)?.content || "";
}


function checkJavaBraces(source) {
  let depth = 0;
  let string = false;
  let character = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (c === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (c === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (string || character) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (string && c === '"') {
        string = false;
      } else if (character && c === "'") {
        character = false;
      }
      continue;
    }

    if (c === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }

    if (c === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }

    if (c === '"') string = true;
    else if (c === "'") character = true;
    else if (c === "{") depth++;
    else if (c === "}") depth--;

    if (depth < 0) return false;
  }

  return (
    depth === 0 &&
    !string &&
    !character &&
    !blockComment
  );
}


function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
