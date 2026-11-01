
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

const MAX_FILES = 80;
const MAX_PROJECT_SIZE = 2 * 1024 * 1024;
const DEFAULT_PACKAGE = "com.example.generatedapp";

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

  const packageName = getPackageName(
    body.packageName,
    safeAppName,
    safeFeatures
  );

  const prompt = `
You are an expert Android Java developer.

Create a complete, buildable Android Studio project.

APP NAME:
${safeAppName}

APP CATEGORY:
${safeAppType}

USER REQUIREMENTS:
${safeFeatures}

IMPORTANT PACKAGE NAME:
${packageName}

ANDROID REQUIREMENTS:

1. Use Java only. Never use Kotlin.
2. Use this exact package name: ${packageName}
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
13. Include app/src/main/java/${packageName.replace(/\./g, "/")}/MainActivity.java.
14. Include every required layout and resource.
15. Include a working launcher Activity.
16. All referenced resources must exist.
17. Never generate empty or placeholder files.
18. Do not include incomplete Gradle wrapper files.
19. Do not claim that the APK is already built.
20. Both namespace and applicationId must be exactly ${packageName}.
21. Every Java package declaration must match its directory.
22. Do not use com.example.generatedapp or any other package name.

JAVA RULES:

23. Check every Java file for syntax errors.
24. All braces and parentheses must be balanced.
25. All methods must be inside the correct class.
26. Never put statements outside methods.
27. Every click listener must have valid Java syntax.
28. Prefer standard anonymous listener classes.
29. Never generate stray }); statements.
30. Every import and referenced class must exist.
31. Java package declarations must match file paths.

RESOURCE RULES:

32. Every referenced resource must exist.
33. Resource filenames must use lowercase letters, numbers and underscores.
34. Never reference a missing drawable, mipmap, string, color or style.
35. Do not generate adaptive launcher icons.
36. Create a valid drawable/ic_launcher.xml launcher icon.
37. If no launcher icon is generated, omit icon references from the manifest.
38. Never reference @mipmap/ic_launcher_foreground.
39. Every XML file must be valid.
40. Never generate empty android:id values.
41. Use valid IDs such as @+id/main_button.

GRADLE RULES:

42. Use plugins DSL.
43. Root build.gradle must contain:
    id 'com.android.application' version '8.6.1' apply false
44. settings.gradle must contain pluginManagement.
45. Include google(), mavenCentral() and gradlePluginPortal() in pluginManagement.
46. Include dependencyResolutionManagement.
47. Use RepositoriesMode.FAIL_ON_PROJECT_REPOS.
48. Keep dependency repositories only in settings.gradle.
49. Never use allprojects repositories.
50. Never use project-level repositories.
51. Do not use old buildscript configuration.
52. app/build.gradle must contain namespace '${packageName}'.
53. app/build.gradle must contain applicationId '${packageName}'.
54. gradle.properties must contain:
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
      error: result.error || "Gemini generation failed.",
      details: result.details
    });
  }

  return validateProject(
    result.data,
    res,
    safeAppName,
    packageName
  );
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

  const appPackage = getPackageFromGradle(files) || DEFAULT_PACKAGE;

  const prompt = `
You are an expert Android Java and Gradle repair engineer.

Repair the existing Android project. Do not create an unrelated project.

BUILD ERROR:
${body.buildError.slice(-12000)}

EXISTING PROJECT FILES:
${JSON.stringify(files)}

IMPORTANT:
The existing Android package name is exactly:
${appPackage}

RULES:
1. Fix the actual build errors.
2. Preserve the original app purpose and features.
3. Use Java only.
4. Keep the exact existing package name ${appPackage}.
5. Keep namespace and applicationId equal to ${appPackage}.
6. Keep Android Gradle Plugin 8.6.1.
7. Keep compileSdk 35, minSdk 24 and targetSdk 35.
8. Fix Java syntax errors and missing imports.
9. Fix invalid Android XML and missing resources.
10. Fix manifest references.
11. Fix Gradle configuration only when necessary.
12. Do not add unnecessary dependencies.
13. Do not remove working app features to hide errors.
14. Return complete contents of every changed file.
15. Include new files only when required.
16. Do not return unchanged files.
17. If you cannot safely repair the project, return an empty files array.
18. Never change the package name.

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
    repaired.push({ path, content: file.content });
  }

  normalizeJavaFiles(repaired, appPackage);
  normalizePackageReferences(repaired, appPackage);
  normalizeGradlePackage(repaired, appPackage);

  for (const file of repaired.filter(
    item => item.path.endsWith(".java")
  )) {
    if (!checkJavaBraces(file.content)) {
      return res.status(422).json({
        error: "AI returned Java with unbalanced braces.",
        details: file.path
      });
    }
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


function validateProject(project, res, appName, packageName) {
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

  normalizeJavaFiles(files, packageName);
  normalizePackageReferences(files, packageName);
  normalizeGradlePackage(files, packageName);

  const required = [
    "settings.gradle",
    "build.gradle",
    "app/build.gradle",
    "app/src/main/AndroidManifest.xml",
    `app/src/main/java/${packageName.replace(/\./g, "/")}/MainActivity.java`
  ];

  const paths = new Set(files.map(file => file.path));
  const missing = required.filter(path => !paths.has(path));

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
      `app/src/main/java/${packageName.replace(/\./g, "/")}/MainActivity.java`
  );

  // FIXED: Correct Java package declaration validation.
  if (
    !new RegExp(
      `package\\s+${escapeRegex(packageName)}\\s*;`
    ).test(mainActivity.content)
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

  if (
    !app.includes(`namespace '${packageName}'`) &&
    !app.includes(`namespace "${packageName}"`)
  ) {
    return res.status(422).json({
      error: "App namespace does not match the unique package name."
    });
  }

  if (
    !app.includes(`applicationId '${packageName}'`) &&
    !app.includes(`applicationId "${packageName}"`)
  ) {
    return res.status(422).json({
      error: "Application ID does not match the unique package name."
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
    packageName,
    fileCount: files.length,
    files,
    message: "Android project generated and validated."
  });
}


function getPackageName(requestedPackage, appName, features) {
  const explicit = String(requestedPackage || "").trim();

  const featureMatch = String(features || "").match(
    /(?:package\s*name|application\s*id)\s*:\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)/i
  );

  let candidate = explicit || featureMatch?.[1] || "";

  if (candidate && isValidPackage(candidate)) {
    return candidate;
  }

  const slug = String(appName || "myapp")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 35) || "myapp";

  return `com.rkai.${slug}`;
}


function isValidPackage(value) {
  return (
    typeof value === "string" &&
    value.length <= 200 &&
    /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value)
  );
}


function normalizeJavaFiles(files, packageName) {
  const javaFiles = files.filter(file =>
    file.path.startsWith("app/src/main/java/") &&
    file.path.endsWith(".java")
  );

  const normalized = [];
  const otherFiles = files.filter(file =>
    !(
      file.path.startsWith("app/src/main/java/") &&
      file.path.endsWith(".java")
    )
  );

  const seen = new Set();

  for (const file of javaFiles) {
    let content = file.content;

    const match = content.match(
      /^\s*package\s+([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*;/m
    );

    let suffix = "";

    if (match) {
      const oldPackage = match[1];

      if (oldPackage === DEFAULT_PACKAGE) {
        suffix = "";
      } else if (oldPackage.startsWith(DEFAULT_PACKAGE + ".")) {
        suffix = oldPackage.slice(DEFAULT_PACKAGE.length);
      } else if (oldPackage.startsWith(packageName + ".")) {
        suffix = oldPackage.slice(packageName.length);
      }
    }

    const newPackage = packageName + suffix;

    if (match) {
      content = content.replace(
        /^\s*package\s+[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*\s*;/m,
        `package ${newPackage};`
      );
    } else {
      content = `package ${newPackage};\n\n${content}`;
    }

    content = content.replaceAll(
      DEFAULT_PACKAGE,
      packageName
    );

    const relativePackagePath = newPackage.replace(/\./g, "/");
    const filename = file.path.split("/").pop();
    const newPath =
      `app/src/main/java/${relativePackagePath}/${filename}`;

    if (seen.has(newPath)) {
      continue;
    }

    seen.add(newPath);
    normalized.push({ path: newPath, content });
  }

  files.splice(
    0,
    files.length,
    ...otherFiles,
    ...normalized
  );
}


function normalizePackageReferences(files, packageName) {
  for (const file of files) {
    if (
      file.path.endsWith(".java") ||
      file.path.endsWith(".xml") ||
      file.path.endsWith(".gradle") ||
      file.path.endsWith(".properties")
    ) {
      file.content = file.content.replaceAll(
        DEFAULT_PACKAGE,
        packageName
      );
    }
  }
}


function normalizeGradlePackage(files, packageName) {
  const file = files.find(
    item => item.path === "app/build.gradle"
  );

  if (!file) return;

  let content = file.content;

  if (/namespace\s+['"][^'"]+['"]/.test(content)) {
    content = content.replace(
      /namespace\s+['"][^'"]+['"]/,
      `namespace '${packageName}'`
    );
  }

  if (/applicationId\s+['"][^'"]+['"]/.test(content)) {
    content = content.replace(
      /applicationId\s+['"][^'"]+['"]/,
      `applicationId '${packageName}'`
    );
  }

  file.content = content;
}


function getPackageFromGradle(files) {
  const app = getContent(files, "app/build.gradle");

  const match = app.match(
    /applicationId\s+['"]([^'"]+)['"]/
  );

  if (match && isValidPackage(match[1])) {
    return match[1];
  }

  return null;
}


function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
