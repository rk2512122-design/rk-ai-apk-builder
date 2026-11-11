
const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite"
];
const MAX_FILES = 80;
const MAX_PROJECT_SIZE = 2 * 1024 * 1024;
const DEFAULT_PACKAGE = "com.example.generatedapp";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Only POST requests are supported." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel Environment Variables."
    });
  }

  const body = req.body || {};
  const mode = body.mode || "generate";

  if (mode === "repair") return handleRepair(req, res, apiKey, body);
  if (mode !== "generate") {
    return res.status(400).json({ error: "Invalid request mode." });
  }

  // Accept a single natural-language idea as the primary user input.
  const idea = String(body.idea || body.prompt || "").trim();
  const rawFeatures = String(body.features || idea || "").trim();
  const inferredName = deriveAppName(idea || rawFeatures);
  const inferredType = inferAppType(idea || rawFeatures);
  const isRkSmartAssistant = /rk\s*ai\s*smart\s*assistant|rksmartassistant/i.test(String(body.appName || "") + " " + idea + " " + rawFeatures);
  const appName = isRkSmartAssistant ? "RK AI Smart Assistant 2026" : String(body.appName || inferredName).trim();
  const appType = String(body.appType || inferredType).trim();
  const features = rawFeatures;

  if (!features) {
    return res.status(400).json({
      error: "Please describe your app idea."
    });
  }

  const safeAppName = appName.slice(0, 100);
  const safeAppType = appType.slice(0, 150);
  const safeFeatures = features.slice(0, 5000);

  // Keep package identity deterministic for the same app name across generations.
  // Different app names receive different package names; later builds of the same
  // app must keep the same appName to remain update-compatible.
  const packageName = isRkSmartAssistant
    ? "com.rkai.rksmartassistant"
    : getPackageName(body.packageName, safeAppName, safeFeatures);

  const isChatApp = /chatbot|chat bot|ai chat|chat app|messaging|smart assistant|ai assistant|चैट|बातचीत/i.test(safeAppName + " " + safeAppType + " " + safeFeatures);
  const chatInstructions = isChatApp ? `

 SPECIAL AI CHATBOT INTEGRATION — MANDATORY:
 1. Call the secure backend endpoint https://rk-ai-apk-builder.vercel.app/api/chat using HTTPS POST.
 2. Send Content-Type application/json and JSON body { "message": latestUserMessage, "history": [ { "role": "user" or "assistant", "content": "..." } ] }.
 3. Parse response JSON field "reply", with "response" or "answer" as fallback, and show the actual backend response in the assistant bubble.
 4. Never call Gemini directly from Android. Never include any API key, token or secret in the APK.
 5. Add android.permission.INTERNET to AndroidManifest.xml.
 6. Use network requests off the main UI thread, with connection/read timeouts, and update views on the main thread.
 7. Show a loading state. For non-2xx responses, invalid JSON, timeout or no internet, show a useful error and allow retry.
 8. Send recent conversation history in chronological order; use role "user" for user messages and "assistant" for assistant replies.
 9. Never use simulated or hard-coded AI replies. Every assistant answer must come from the backend.
 10. The welcome greeting may be local but must not be presented as an AI-generated answer.
 11. CHAT HISTORY PERSISTENCE IS REQUIRED: save every successfully displayed user message and assistant reply locally on the Android device using SharedPreferences (JSON) or SQLite. Do not rely only on in-memory ArrayList data.
 12. On every app launch, load the saved conversation before showing the chat screen, then render the messages in their original chronological order. If there is no saved conversation, show the welcome greeting.
 13. Save the updated history immediately after each user message and after each successful assistant reply. Also save when the app is paused or closed as a safety measure.
 14. Store both message role (user/assistant) and full text. Do not save loading indicators, temporary errors or the welcome greeting as conversation history.
 15. The New Chat action must start a fresh visible conversation without deleting the previous conversation unless the user explicitly chooses Clear Chat. The Clear Chat action must ask for confirmation, then clear the saved conversation as well as the screen.
 16. Ensure persistence survives navigating Back, force-closing the app and reopening the app, and device restart. Do not claim cloud sync; this is local device storage.
 17. Handle malformed or empty saved JSON safely by starting with an empty conversation without crashing.
 18. When sending history to the backend, use the currently active conversation in chronological order and do not send messages from a different chat.
 19. MULTIPLE SAVED CONVERSATIONS ARE REQUIRED, similar to a chat-history sidebar in a modern AI chat app. Do not implement only one global message list.
 20. Store a collection of conversations locally. Each conversation must have a unique stable ID, a title, created/updated timestamps, and its own ordered list of user/assistant messages. Use SQLite/Room or a robust SharedPreferences JSON structure.
 21. Add an accessible Chat History entry point in the app toolbar (for example, a menu button) that opens a navigation drawer or history screen listing saved conversations, newest updated first. Each row must show a short title derived from the first meaningful user message (never show "New Conversation" when a user message exists) and a useful date/time if space allows.
 22. Tapping a history row must open that exact conversation and render its messages in chronological order. The user must be able to continue that conversation; save each new message to that conversation's ID.
 23. New Chat must create a new, separate empty conversation and make it active. It must not overwrite, merge with, or delete any previous conversation.
 24. On a fresh app launch, show a clean new-chat screen by default, while keeping all previous conversations accessible from Chat History. Do not automatically reopen the last conversation on the main screen.
 25. Provide a way to delete an individual conversation from the history list with a confirmation dialog. Clear Chat should clearly explain whether it clears only the active conversation; do not silently delete all saved conversations.
 26. Persist conversation titles and timestamps and update the title from the first meaningful user message. Handle long titles safely with ellipsizing.
 27. Keep the active conversation ID and selected history item consistent through screen rotation, app pause/resume, process death and app restart.
 28. If no conversations exist, show a helpful empty history state. If saved data is malformed, recover safely without crashing or destroying other valid conversations.
 29. Add clear navigation between the chat screen and history screen/drawer, with a back action returning to the current chat. The history UI must be usable on small Android phones.
 30. Do not claim cloud sync or account-based sync; all history is local to this device unless a real secure sync backend is implemented.
` : "";
  const prompt = `
You are a senior Android product designer and expert Android Java engineer.
Create a complete, polished, production-style Android Studio project. This must be a genuinely functional app, not a UI mockup.

APP NAME:
${safeAppName}

APP CATEGORY:
${safeAppType}

USER REQUIREMENTS (THE USER'S NATURAL-LANGUAGE APP IDEA):
${safeFeatures}

RK AI SMART ASSISTANT PROJECT LOCK — APPLY WHEN THIS IS THE RK AI SMART ASSISTANT:
- The exact package is com.rkai.rksmartassistant. Do not invent, shorten, or replace it with another package.
- Return a complete app, not a sample screen. At least 15 meaningful files are expected for this app.
- MainActivity must implement real POST requests to https://rk-ai-apk-builder.vercel.app/api/chat and https://rk-ai-apk-builder.vercel.app/api/image.
- Image mode must decode imageBase64 from the image endpoint and display the returned Bitmap. Do not merely write an image prompt.
- Implement multiple locally persisted conversations (SQLite or SharedPreferences JSON), each with a stable ID, title, timestamps and ordered messages. History must list, open, continue and delete individual conversations.
- New Chat must create a new conversation without deleting previous chats. Clear Chat must clear only the active conversation after confirmation.
- The keyboard must leave the composer and typed text visible. Use adjustResize and a bottom-pinned composer.
- Include separate Java classes/resources as needed; do not compress the whole app into one trivial MainActivity.
- Required implementation evidence: Java source must contain both API endpoint paths, persistent storage code, and actual history selection/deletion handlers.
- Include required layouts, values, drawables, manifest, Gradle files and all referenced resources. No missing resources or placeholder controls.

UNIVERSAL IDEA-TO-APP RULES — APPLY TO EVERY APP CATEGORY:
1. Treat the user's idea as the product brief. Infer the app's purpose, target users, main user journey, screens, navigation, data model, and sensible supporting features without requiring the user to provide technical specifications.
2. Build the app that the user actually described. Do not force every idea into a chatbot, dashboard, notes app, or generic template.
3. Convert each requested capability into a real working feature. Every visible button, menu, form, tab, setting, and navigation item must work. Do not add decorative controls or pretend functionality.
4. Make sensible product decisions when details are missing: choose a clean, accessible design, simple navigation, safe defaults, useful empty states, and mobile-first layouts. Do not block generation merely because optional details are unspecified.
5. For complex ideas, implement a coherent first version with the most important requested workflow working end-to-end. Do not omit requested core features silently.
6. Persist user-created data locally when appropriate. Use appropriate Android storage and explain in the app UI when data is local-only.
7. For features needing internet, add secure backend integration only when a real configured endpoint exists. Never put API keys, passwords, tokens, or private secrets in the APK.
8. Never fake online services, AI, image generation, payments, maps, login, cloud sync, messaging, or live data. If a real provider or backend is not configured, do not claim that feature works; provide a clear unavailable/configuration state rather than simulated results.
9. For AI chat, image generation, speech, or other AI features, use a secure server endpoint and parse its real response. Keep secrets on the server. If no suitable endpoint exists, state this limitation clearly in the generated app rather than inventing successful results.
   IMAGE GENERATION — REQUIRED REAL IMPLEMENTATION:
   a. A secure server endpoint is configured at https://rk-ai-apk-builder.vercel.app/api/image. The Android app must POST JSON {"prompt":"the user's image description"} with Content-Type application/json. Never put GEMINI_API_KEY in the APK.
   b. Parse JSON response fields status, mimeType, imageBase64, and text. On status 200 and a valid imageBase64, decode Base64 into a Bitmap and show the actual generated image in the conversation.
   c. Use background-thread networking (ExecutorService or equivalent), connection/read timeouts, and update the UI on the main thread. Show progress while generating and disable duplicate sends.
   d. Provide save-to-gallery using MediaStore on supported Android versions, plus share and retry actions. Request only permissions actually required; do not request broad storage access on modern Android.
   e. If the server returns an error, times out, or returns no image, show the real error with a retry action. Never substitute a text prompt or fake image and never show success unless image bytes were received and decoded.
   f. The camera/image mode button must visibly switch the composer into image-description mode and the Send button must call /api/image. Switching back must restore chat mode and call /api/chat.
   g. Add INTERNET permission and verify that image mode works on mobile data as well as Wi-Fi.
   h. If the provider/model is unavailable or rejects the request, display a clear unavailable message; do not silently fall back to text-only chat.
10. Add input validation, loading and error states, retry actions, and helpful feedback for network-dependent features.
11. Do not create unnecessary features unrelated to the user's idea. Keep the app focused, polished, and easy for a non-technical user.
12. Before returning files, verify that the requested primary user journey can be completed using the generated screens and controls, and that referenced resources, permissions, and dependencies are present.

${chatInstructions}

EXACT ANDROID PACKAGE:
${packageName}

PRODUCT DESIGN AND USER EXPERIENCE:
1. Design a premium, modern Android app that looks like a professionally published app.
2. Use a consistent design system: coordinated colors, typography, spacing, corner radii, icons and component styles.
3. Choose a visual style appropriate to the app category. Do not blindly use the same dashboard design for every app.
4. Use a polished home screen with clear visual hierarchy, useful cards and well-designed actions where appropriate.
5. Use readable text sizes, strong contrast and comfortable touch targets (normally at least 48dp).
6. Avoid cramped layouts, excessive empty space, generic placeholder cards and unnecessary decoration.
7. Do not place important text or controls underneath the status bar, camera cutout or system navigation bar.
   For a chat app specifically, use a stable top app bar: place the app title and history/menu action on the left, and image/new-chat/clear actions in a properly spaced horizontal action area or overflow menu. Never overlap the clock/status icons, app title, or toolbar actions. Use compact icon buttons with content descriptions and minimum 48dp touch targets.
8. Support edge-to-edge and system insets correctly. Apply WindowInsets to the root content so status-bar and navigation-bar areas are respected. Do not simply add arbitrary top margins.
9. Make layouts responsive on small and large Android phones, portrait and landscape where practical. Avoid fixed screen coordinates and oversized fixed heights.
10. Use dp for dimensions and sp for text. Use ConstraintLayout, LinearLayout, FrameLayout or other standard Android layouts appropriately.
11. Long titles, large numbers and narrow screens must not overlap or get clipped. Allow wrapping, scrolling or ellipsizing where appropriate.
12. Keep bottom navigation and floating buttons clear of the system navigation area and gesture area.
13. FORMS AND KEYBOARD — STRICT CHAT INPUT REQUIREMENTS:
   a. Chat screen must use a layout that resizes when the soft keyboard opens: set windowSoftInputMode="adjustResize" on the launcher Activity (or implement correct WindowInsets/IME insets for edge-to-edge).
   b. The message composer must remain fully visible directly above the keyboard while typing. It must never be hidden behind the keyboard or system navigation bar.
   c. Put the message list in a weighted/0dp-height scrolling container and pin the composer to the bottom of the app content; do not position it with fixed screen coordinates or overlay it behind the IME.
   d. When the keyboard opens, resize the message area and keep the composer/input field and send button visible. The user must see every character as it is typed without dismissing the keyboard.
   e. Ensure the EditText has a visible background, sufficient contrast, text color, hint color, cursor, padding and minimum height. Do not make it transparent or cover it with another view.
   f. After sending, clear the input only after capturing the text; keep the latest message visible and scroll the conversation to the bottom.
   g. Test the screen at a small phone size with the keyboard open, with multi-line text and Hindi/English input.
14. Dialogs and bottom sheets must fit on small screens, scroll when needed and keep buttons visible.
15. Provide helpful empty states, validation messages, loading states and success/error feedback.
16. All buttons, tabs, search fields, settings and other visible controls must perform their stated action.
17. Do not add fake charts, fake buttons, hard-coded claims or non-functional controls.
18. Use sensible sample data only when clearly labelled as sample data. Prefer a clean empty state for user-created data.
19. Persist user-created data locally using SharedPreferences, SQLite or Room only when suitable. Do not add unnecessary dependencies.
20. Make accessibility reasonable: content descriptions for meaningful icons, clear labels and adequate contrast.

PROFESSIONAL LAUNCHER ICON — REQUIRED:
21. Create a unique, professional launcher icon concept based on the app name, category and purpose.
22. The icon must look like a polished app-store icon: simple, memorable, balanced, high contrast and recognizable at small sizes.
23. Do not use a generic letter, random symbol, emoji, plain text logo or the same icon for every app.
24. Create the icon as a valid Android VectorDrawable at:
    app/src/main/res/drawable/ic_launcher.xml
25. The VectorDrawable must use valid XML, a sensible viewport (for example 108 x 108), valid pathData and deliberate foreground/background shapes.
26. Set the application manifest android:icon to @drawable/ic_launcher. Do not reference missing mipmap resources.
27. Do not create adaptive launcher icons or reference ic_launcher_foreground. Use the single valid VectorDrawable specified above.
28. The launcher icon must be included in the returned files and must not be empty.
29. Also create a matching in-app visual identity where appropriate, but do not place a huge logo in the dashboard.

ANDROID PROJECT REQUIREMENTS:
30. Use Java only. Never use Kotlin.
31. Use exact package name ${packageName}.
32. Android Gradle Plugin version 8.6.1.
33. compileSdk 35, minSdk 24, targetSdk 35.
34. Java 17.
35. Include settings.gradle, root build.gradle, app/build.gradle and gradle.properties.
36. Include app/src/main/AndroidManifest.xml.
37. Include app/src/main/java/${packageName.replace(/\./g, "/")}/MainActivity.java.
38. Include every required Java, layout, drawable, values and other resource file.
39. Include a working launcher Activity.
40. All referenced resources must exist. Never generate empty or placeholder files.
41. Do not include incomplete Gradle wrapper files.
42. Do not claim the APK is already built.
43. Both namespace and applicationId must be exactly ${packageName}.
44. Every Java package declaration must match its directory.
45. Do not use com.example.generatedapp or any other package name.

JAVA RULES:
46. Check every Java file for syntax errors.
47. All braces and parentheses must be balanced.
48. All methods must be inside the correct class.
49. Never put statements outside methods.
50. Every click listener must have valid Java syntax.
51. Prefer standard anonymous listener classes where appropriate.
52. Never generate stray }); statements.
53. Every import and referenced class must exist.
54. Java package declarations must match file paths.

RESOURCE RULES:
55. Every referenced resource must exist.
56. Resource filenames must use lowercase letters, numbers and underscores.
57. Never reference a missing drawable, mipmap, string, color or style.
58. Create valid XML for all layouts, drawables, colors, strings and styles.
59. Never generate empty android:id values. Use valid IDs such as @+id/main_button.
60. Do not reference resources that were not returned in the files array.

GRADLE RULES:
61. Use plugins DSL.
62. Root build.gradle must contain:
    id 'com.android.application' version '8.6.1' apply false
63. settings.gradle must contain pluginManagement.
64. Include google(), mavenCentral() and gradlePluginPortal() in pluginManagement.
65. Include dependencyResolutionManagement.
66. Use RepositoriesMode.FAIL_ON_PROJECT_REPOS.
67. Keep dependency repositories only in settings.gradle.
68. Never use allprojects repositories or project-level repositories.
69. Do not use old buildscript configuration.
70. app/build.gradle must contain namespace '${packageName}'.
71. app/build.gradle must contain applicationId '${packageName}'.
72. gradle.properties must contain:
    android.useAndroidX=true
    android.enableJetifier=true
    org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
    org.gradle.parallel=true

FINAL QUALITY CHECK:
73. Review every screen for status bar overlap, navigation bar overlap, clipped text and overlapping controls.
74. Review every button and form for working behavior.
75. Review Java, XML, manifest and Gradle files for errors.
76. Confirm the launcher icon exists, is valid VectorDrawable XML and is referenced correctly.
77. Fix detected errors before returning the project.

ABSOLUTE REQUIRED FILE PATHS — THESE MUST ALL BE INCLUDED EXACTLY:
- settings.gradle
- build.gradle
- app/build.gradle
- gradle.properties
- app/src/main/AndroidManifest.xml
- app/src/main/java/com/rkai/rksmartassistant/MainActivity.java
- app/src/main/res/drawable/ic_launcher.xml

For RK AI Smart Assistant, MainActivity.java MUST be at the exact path above and declare package com.rkai.rksmartassistant;. Do not rename it or put it in another folder. Do not omit any path in this list. Include all referenced layout, drawable, values, menu and other resources as additional files. Before returning JSON, compare the files array against this exact list and add any missing file with complete valid content.

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

  return validateProject(result.data, res, safeAppName, packageName);
}


async function handleRepair(req, res, apiKey, body) {
  const secret = process.env.BUILD_CALLBACK_SECRET;
  const suppliedSecret = req.headers["x-build-callback-secret"];

  if (!secret || suppliedSecret !== secret) {
    return res.status(401).json({ error: "Unauthorized repair request." });
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
    return res.status(400).json({ error: "Too many project files." });
  }

  const files = [];
  const seen = new Set();

  for (const file of body.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    ) {
      return res.status(400).json({ error: "Invalid repair file." });
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
    (sum, file) => sum + Buffer.byteLength(file.content, "utf8"),
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
The existing Android package name is exactly ${appPackage}.

RULES:
1. Fix the actual build errors and preserve the app purpose and working features.
2. Use Java only. Keep the exact package name ${appPackage}.
3. Keep namespace and applicationId equal to ${appPackage}.
4. Keep Android Gradle Plugin 8.6.1, compileSdk 35, minSdk 24 and targetSdk 35.
5. Fix Java syntax errors, imports, XML, manifest and Gradle configuration.
6. Do not add unnecessary dependencies or remove working features to hide errors.
7. Preserve the professional UI, responsive layouts, system insets and keyboard handling.
8. Preserve the valid professional launcher icon at drawable/ic_launcher.xml. Repair it if it caused the error.
9. Return complete contents of every changed file. Include new files only when required.
10. Do not return unchanged files.
11. If you cannot safely repair the project, return an empty files array.
12. Never change the package name.

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
    return res.status(422).json({ error: "Too many repaired files returned." });
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

  for (const file of repaired.filter(item => item.path.endsWith(".java"))) {
    if (!checkJavaBraces(file.content)) {
      return res.status(422).json({
        error: "AI returned Java with unbalanced braces.",
        details: file.path
      });
    }
  }

  const repairedSize = repaired.reduce(
    (sum, file) => sum + Buffer.byteLength(file.content, "utf8"),
    0
  );

  if (repairedSize > MAX_PROJECT_SIZE) {
    return res.status(413).json({ error: "Repaired files are too large." });
  }

  return res.status(200).json({
    status: "repaired",
    files: repaired,
    message: project.message || "AI repair completed."
  });
}


async function callGemini(apiKey, prompt) {
  const retryable = [408, 429, 500, 502, 503, 504];
  let lastDetails = "All available Gemini models are temporarily unavailable.";

  // Try current stable models in order. A busy or unavailable model should
  // not prevent the project from being generated by another supported model.
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    let currentPrompt = prompt;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: currentPrompt }]
              }
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 32768,
              responseMimeType: "application/json"
            }
          }),
          signal: AbortSignal.timeout(120000)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const message = data.error?.message || `Google API HTTP ${response.status}`;
          lastDetails = `${model}: ${message}`;

          if (retryable.includes(response.status) && attempt < 2) {
            await wait(1500);
            continue;
          }

          // Move to the next model on rate limits, capacity errors,
          // unavailable models, or model-specific request restrictions.
          if (retryable.includes(response.status) || [400, 404].includes(response.status)) {
            break;
          }
          return { ok: false, details: lastDetails };
        }

        const candidate = data.candidates?.[0];
        const output = (data.candidates || [])
          .flatMap(item => item.content?.parts || [])
          .map(part => part.text || "")
          .join("\n")
          .trim();

        if (!output) {
          lastDetails = `${model}: ${data.promptFeedback?.blockReason || candidate?.finishReason || "Gemini returned an empty response."}`;
          break;
        }

        if (candidate?.finishReason === "MAX_TOKENS") {
          lastDetails = `${model}: output reached its token limit.`;
        } else {
          const parsed = parseJson(output);
          if (parsed) return { ok: true, data: parsed, model };
          lastDetails = `${model}: response was incomplete or not valid JSON.`;
        }

        if (attempt < 2) {
          currentPrompt = prompt + `

RETRY OUTPUT RULES:
- Return one complete, syntactically valid JSON object only.
- Keep the project to 25-30 essential files where practical.
- Keep Java and XML concise; do not add comments, explanations or unnecessary assets.
- Prioritize the user's requested core features and all required Android/Gradle files.
- Do not omit required files, truncate file contents, or use placeholders.
- Ensure every JSON string, array and object is properly closed.
`;
          await wait(1000);
          continue;
        }
        break;
      } catch (error) {
        lastDetails = `${model}: ${error.message || "Network error"}`;
        if (attempt < 2) {
          await wait(1500);
          continue;
        }
        break;
      }
    }
  }

  return {
    ok: false,
    error: "All Gemini generation models are temporarily busy or unavailable.",
    details: lastDetails
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
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
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
    return res.status(502).json({ error: "No project files were returned." });
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
      return res.status(502).json({ error: "Invalid project file." });
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

      if (/\bandroid:id\s*=\s*(["'])\s*(?:@(?:\+)?id\/)?\s*\1/.test(content)) {
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

  const javaDirectory = packageName.replace(/\./g, "/");
  const required = [
    "settings.gradle",
    "build.gradle",
    "app/build.gradle",
    "app/src/main/AndroidManifest.xml",
    `app/src/main/java/${javaDirectory}/MainActivity.java`,
    "app/src/main/res/drawable/ic_launcher.xml"
  ];

  const paths = new Set(files.map(file => file.path));
  const missing = required.filter(path => !paths.has(path));

  if (missing.length) {
    return res.status(422).json({
      error: "Required Android files are missing.",
      missingFiles: missing,
      hint: "Gemini omitted one or more mandatory files. Regenerate with the exact required file paths shown in the request."
    });
  }

  ensureGradleProperties(files);

  // Use one known-good root plugin declaration for every generated project.
  const rootGradleFile = files.find(file => file.path === "build.gradle");
  if (rootGradleFile) {
    rootGradleFile.content = `plugins {
    id 'com.android.application' version '8.6.1' apply false
}
`;
  }


  // Normalize settings.gradle instead of rejecting valid-but-differently-formatted
  // Gemini output. This guarantees the repository policy and plugin repositories.
  const settingsFile = files.find(file => file.path === "settings.gradle");
  settingsFile.content = `pluginManagement {
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

rootProject.name = "RKGeneratedApp"
include(":app")
`;

  const isRkSmartAssistant = packageName === "com.rkai.rksmartassistant";
  if (isRkSmartAssistant) {
    const javaSource = files.filter(file => file.path.endsWith(".java")).map(file => file.content).join("\n");
    const allSource = files.map(file => file.content).join("\n");
    const missingFeatures = [];
    if (!allSource.includes("https://rk-ai-apk-builder.vercel.app/api/chat")) missingFeatures.push("real AI chat endpoint integration");
    if (!allSource.includes("https://rk-ai-apk-builder.vercel.app/api/image")) missingFeatures.push("real image-generation endpoint integration");
    if (!/SharedPreferences|SQLiteDatabase|RoomDatabase/.test(javaSource)) missingFeatures.push("persistent local chat-history storage");
    if (!/history/i.test(javaSource) || !/delete/i.test(javaSource)) missingFeatures.push("chat-history open/delete actions");
    if (files.length < 15) missingFeatures.push("complete project files (at least 15 meaningful files)");
    if (missingFeatures.length) {
      return res.status(422).json({
        error: "Generated RK AI Smart Assistant project is incomplete. It was blocked before download.",
        missingFeatures,
        packageName
      });
    }
  }

  const mainActivity = files.find(
    file =>
      file.path ===
      `app/src/main/java/${javaDirectory}/MainActivity.java`
  );

  if (
    !new RegExp(`package\s+${escapeRegex(packageName)}\s*;`).test(
      mainActivity.content
    )
  ) {
    return res.status(422).json({
      error: "MainActivity package declaration is incorrect."
    });
  }

  for (const file of files.filter(item => item.path.endsWith(".java"))) {
    if (!checkJavaBraces(file.content)) {
      return res.status(422).json({
        error: "Java structure validation failed.",
        details: file.path
      });
    }
  }

  const icon = getContent(files, "app/src/main/res/drawable/ic_launcher.xml");
  if (
    !/<vector\b/.test(icon) ||
    !/<path\b/.test(icon) ||
    !/pathData\s*=/.test(icon)
  ) {
    return res.status(422).json({
      error: "Professional launcher icon is missing or invalid.",
      details: "app/src/main/res/drawable/ic_launcher.xml"
    });
  }

  const manifest = getContent(files, "app/src/main/AndroidManifest.xml");
  if (!/android:icon\s*=\s*["']@drawable\/ic_launcher["']/.test(manifest)) {
    return res.status(422).json({
      error: "Manifest must reference @drawable/ic_launcher."
    });
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
    (sum, file) => sum + Buffer.byteLength(file.content, "utf8"),
    0
  );

  if (totalSize > MAX_PROJECT_SIZE) {
    return res.status(413).json({ error: "Generated project is too large." });
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


const JAVA_RESERVED_WORDS = new Set([
  "abstract", "assert", "boolean", "break", "byte", "case", "catch",
  "char", "class", "const", "continue", "default", "do", "double",
  "else", "enum", "extends", "final", "finally", "float", "for",
  "goto", "if", "implements", "import", "instanceof", "int",
  "interface", "long", "native", "new", "package", "private",
  "protected", "public", "return", "short", "static", "strictfp",
  "super", "switch", "synchronized", "this", "throw", "throws",
  "transient", "try", "void", "volatile", "while", "true", "false",
  "null", "_"
]);

function deriveAppName(idea) {
  const source = String(idea || "").trim();
  const hindiName = source.match(/नाम\s*(?:का|की|वाला|वाली)\s*([A-Za-z][A-Za-z0-9]*(?:[ -][A-Za-z0-9]+){0,3})/i);
  if (hindiName?.[1]) return hindiName[1].trim();

  const englishName = source.match(/\b(?:called|named)\s+([A-Za-z][A-Za-z0-9]*(?:[ -][A-Za-z0-9]+){0,3})/i);
  if (englishName?.[1]) return englishName[1].trim();

  const words = source
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 4);
  return words.length ? words.join(" ") + " App" : "RK Custom App";
}

function inferAppType(idea) {
  const value = String(idea || "").toLowerCase();
  const categories = [
    [/chat|messag|बातचीत|चैट|assistant|सहायक/, "AI Chat and Assistant App"],
    [/image|photo|चित्र|इमेज|तस्वीर/, "Image and Photo App"],
    [/game|खेल|gaming/, "Game and Entertainment App"],
    [/shop|store|खरीद|दुकान|ecommerce/, "Shopping App"],
    [/music|song|audio|गाना|संगीत/, "Music and Audio App"],
    [/video|movie|वीडियो/, "Video App"],
    [/note|याद|लिख|notes/, "Notes and Productivity App"],
    [/finance|money|budget|खर्च|पैसा|बैंक/, "Finance App"],
    [/fitness|workout|health|सेहत|स्वास्थ्य/, "Health and Fitness App"],
    [/learn|study|education|पढ़|सीख|शिक्षा/, "Education App"]
  ];
  const match = categories.find(([pattern]) => pattern.test(value));
  return match ? match[1] : "Custom Android App";
}

function getPackageName(requestedPackage, appName, features) {
  const explicit = String(requestedPackage || "").trim();
  const featureMatch = String(features || "").match(
    /(?:package\s*name|application\s*id)\s*:\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)/i
  );

  const candidate = explicit || featureMatch?.[1] || "";
  if (candidate && isValidPackage(candidate)) return candidate;

  let slug =
    String(appName || "myapp")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 35) || "myapp";

  // Java package segments must start with a letter and cannot be keywords.
  if (!/^[a-z]/.test(slug) || JAVA_RESERVED_WORDS.has(slug)) {
    slug = "app" + slug;
  }

  return `com.rkai.${slug}`;
}

function isValidPackage(value) {
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value)
  ) {
    return false;
  }

  return value.split(".").every(
    segment => !JAVA_RESERVED_WORDS.has(segment)
  );
}


function normalizeJavaFiles(files, packageName) {
  const javaFiles = files.filter(
    file =>
      file.path.startsWith("app/src/main/java/") &&
      file.path.endsWith(".java")
  );

  const otherFiles = files.filter(
    file =>
      !(
        file.path.startsWith("app/src/main/java/") &&
        file.path.endsWith(".java")
      )
  );

  const normalized = [];
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

    content = content.replaceAll(DEFAULT_PACKAGE, packageName);
    const relativePackagePath = newPackage.replace(/\./g, "/");
    const filename = file.path.split("/").pop();
    const newPath =
      `app/src/main/java/${relativePackagePath}/${filename}`;

    if (seen.has(newPath)) continue;
    seen.add(newPath);
    normalized.push({ path: newPath, content });
  }

  files.splice(0, files.length, ...otherFiles, ...normalized);
}


function normalizePackageReferences(files, packageName) {
  for (const file of files) {
    if (
      file.path.endsWith(".java") ||
      file.path.endsWith(".xml") ||
      file.path.endsWith(".gradle") ||
      file.path.endsWith(".properties")
    ) {
      file.content = file.content.replaceAll(DEFAULT_PACKAGE, packageName);
    }
  }
}


function normalizeGradlePackage(files, packageName) {
  const file = files.find(item => item.path === "app/build.gradle");
  if (!file) return;

  let content = file.content;
  if (!/plugins\s*\\{/.test(content)) {
    content = `plugins {
    id 'com.android.application'
}

` + content;
  } else if (!/id\s+['"]com\\.android\\.application['"]/.test(content)) {
    content = content.replace(/plugins\s*\\{/, match => match + `\\n    id 'com.android.application'`);
  }

  if (/namespace\s+['"][^'"]+['"]/.test(content)) {
    content = content.replace(/namespace\s+['"][^'"]+['"]/, `namespace '${packageName}'`);
  } else {
    content = content.replace(/android\s*\\{/, match => match + `\\n    namespace '${packageName}'`);
  }

  if (/applicationId\s+['"][^'"]+['"]/.test(content)) {
    content = content.replace(/applicationId\s+['"][^'"]+['"]/, `applicationId '${packageName}'`);
  } else if (/defaultConfig\s*\\{/.test(content)) {
    content = content.replace(/defaultConfig\s*\\{/, match => match + `\\n        applicationId '${packageName}'`);
  }

  const setNumber = (key, value) => {
    const pattern = new RegExp(`(\\\b${key}\\\s+)\\\\d+`);
    if (pattern.test(content)) content = content.replace(pattern, `$1${value}`);
    else if (key === "compileSdk") content = content.replace(/android\s*\\{/, match => match + `\\n    compileSdk ${value}`);
    else content = content.replace(/defaultConfig\s*\\{/, match => match + `\\n        ${key} ${value}`);
  };

  setNumber("compileSdk", 35);
  setNumber("minSdk", 24);
  setNumber("targetSdk", 35);

  if (!/versionCode\s+\\d+/.test(content)) {
    content = content.replace(/defaultConfig\s*\\{/, match => match + `\\n        versionCode 1`);
  }
  if (!/versionName\s+['"][^'"]+['"]/.test(content)) {
    content = content.replace(/defaultConfig\s*\\{/, match => match + `\\n        versionName '1.0'`);
  }
  if (!/compileOptions\s*\\{/.test(content)) {
    content = content.replace(/android\s*\\{/, match => match + `
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }`);
  }
  file.content = content;
}

function getPackageFromGradle(files) {
  const app = getContent(files, "app/build.gradle");
  const match = app.match(/applicationId\s+['"]([^'"]+)['"]/);
  return match && isValidPackage(match[1]) ? match[1] : null;
}


function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function ensureGradleProperties(files) {
  const path = "gradle.properties";
  const file = files.find(item => item.path === path);
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
    const index = lines.findIndex(line => line.trim().startsWith(key + "="));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }

  const content = lines.join("\n") + "\n";
  if (file) file.content = content;
  else files.push({ path, content });
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
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (string && c === '"') string = false;
      else if (character && c === "'") character = false;
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

  return depth === 0 && !string && !character && !blockComment;
}


function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
