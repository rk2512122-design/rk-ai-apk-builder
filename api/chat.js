const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const ALLOWED_INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Only POST requests are supported." });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "AI service is not configured on the server." });

  const body = req.body || {};
  const message = String(body.message || body.prompt || body.text || "").trim();
  if (!message) return res.status(400).json({ error: "A non-empty message is required." });
  if (message.length > MAX_MESSAGE_LENGTH) return res.status(413).json({ error: "Message is too long." });

  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory.slice(-MAX_HISTORY_MESSAGES).map(item => {
    const roleValue = String(item?.role || "user").toLowerCase();
    const role = ["assistant", "model", "ai"].includes(roleValue) ? "model" : "user";
    const value = String(item?.content || item?.text || "").trim().slice(0, MAX_MESSAGE_LENGTH);
    return value ? { role, parts: [{ text: value }] } : null;
  }).filter(Boolean);

  const parts = [{ text: message }];
  let totalBytes = 0;
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 4) : [];
  for (const file of attachments) {
    const mimeType = String(file?.mimeType || "").toLowerCase();
    const name = String(file?.name || "attachment").slice(0, 120);
    if (typeof file?.text === "string") {
      const text = file.text.slice(0, 60000);
      parts.push({ text: "\n\nAttached text file (" + name + "):\n" + text });
      totalBytes += text.length;
      continue;
    }
    const data = String(file?.data || "");
    if (!ALLOWED_INLINE_TYPES.has(mimeType)) {
      return res.status(415).json({ error: "Unsupported attachment type: " + name + ". Use PDF, JPG, PNG, or WebP." });
    }
    const bytes = Math.floor(data.length * 3 / 4);
    totalBytes += bytes;
    if (!data || totalBytes > MAX_ATTACHMENT_BYTES) {
      return res.status(413).json({ error: "Attachments together must be smaller than 3 MB." });
    }
    parts.push({ inline_data: { mime_type: mimeType, data } });
    parts.push({ text: "The attached file is named " + name + ". Please inspect it as relevant to the user's request." });
  }

  const projectMode = body.projectMode === true;
  const tools = [];
  if (!projectMode && body.webSearch === true) tools.push({ google_search: {} });
  if (!projectMode && body.codeExecution === true) tools.push({ code_execution: {} });

  const payload = {
    systemInstruction: {
      parts: [{
        text: projectMode
          ? "You are an Android Java project file generator. Generate the complete Android Studio project for the user's requested app in ONE response. Return files using this exact repeated format, with no Markdown fences: [[FILE: relative/path]] on its own line, then the complete file content, then [[END FILE]]. Include settings.gradle, root build.gradle, gradle.properties, app/build.gradle, app/src/main/AndroidManifest.xml, app/src/main/java/<package path>/MainActivity.java, app/src/main/res/drawable/ic_launcher.xml, and every referenced resource. Use Java only, AGP 8.6.1, compileSdk 35, minSdk 24, targetSdk 35, Java 17. Use package com.rkai.<app-slug> consistently in namespace, applicationId and Java declarations. Implement all requested features as working behavior, not mockups. Include all files, keep under 80 files and 2 MB total. After all file blocks, add [[PROJECT NAME: App Name]] and [[PACKAGE: com.rkai.appname]]. Do not ask the user to copy code or send it to another generator. The website will assemble these exact files into ZIP."
          : "You are RK AI Universal Assistant, a capable general-purpose assistant. Help with explanations, learning, brainstorming, writing, editing, translation, planning, maths, coding, debugging, technology, troubleshooting and practical step-by-step tasks. Reply in the same language and script as the user's latest message; understand Hindi, Hinglish and English. Be friendly, accurate, clear and practical. Ask one focused clarification only when essential. When files or images are attached, inspect their actual contents and clearly distinguish what is visible/readable from uncertainty. When web search is enabled, use current search results for fresh facts and include source links in your answer when available. When code execution is enabled, use it for calculations or code checks where useful and report only actual results. Never claim to have accessed accounts, devices, local files or performed external actions unless actually provided. Do not invent facts, citations, tests or completed work. For Android app requests, help define requirements and guide the separate Android Project generator. Keep answers concise by default and detailed when asked."
      }]
    },
    contents: [...history, { role: "user", parts }],
    generationConfig: projectMode ? { temperature: 0.1, maxOutputTokens: 24576 } : { temperature: 0.7, maxOutputTokens: 4096 }
  };
  if (tools.length) payload.tools = tools;

  try {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(projectMode ? 50000 : 90000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.error?.message || "Gemini API returned HTTP " + response.status;
      console.error("Chat Gemini request failed:", response.status, detail);
      return res.status(response.status === 429 ? 429 : 502).json({
        error: response.status === 429 ? "AI service is busy. Please try again shortly." : "AI service could not process the message. " + detail.slice(0, 250)
      });
    }
    const candidate = data.candidates?.[0];
    const answer = (candidate?.content?.parts || []).map(part => part.text || "").filter(Boolean).join("\n").trim();
    if (!answer) return res.status(502).json({ error: "AI returned an empty response. Please try again." });
    const grounding = candidate?.groundingMetadata || {};
    const citations = (grounding.groundingChunks || []).map(chunk => chunk.web).filter(item => item?.uri).map(item => ({ title: item.title || item.uri, url: item.uri }));
    return res.status(200).json({ reply: answer, response: answer, answer, citations, searched: citations.length > 0 });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    return res.status(504).json({ error: "Could not reach the AI service. Please try again." });
  }
}
