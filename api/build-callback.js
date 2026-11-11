import { put } from "@vercel/blob";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Only POST requests are supported." });
  }

  const expectedSecret = process.env.BUILD_CALLBACK_SECRET;
  const suppliedSecret = req.headers["x-build-callback-secret"];

  if (!expectedSecret || !safeEqual(suppliedSecret, expectedSecret)) {
    return res.status(401).json({ error: "Unauthorized build callback." });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is missing." });
  }

  const { buildId, status, message } = req.body || {};
  if (
    typeof buildId !== "string" ||
    !/^[A-Za-z0-9_-]+-[0-9]+\.zip$/.test(buildId)
  ) {
    return res.status(400).json({ error: "A valid buildId is required." });
  }

  if (!["building", "completed", "failed"].includes(status)) {
    return res.status(400).json({ error: "Invalid build status." });
  }

  const record = {
    buildId,
    status,
    message: typeof message === "string" ? message.slice(0, 500) : "",
    updatedAt: new Date().toISOString()
  };

  try {
    await put(`build-status/${buildId}.json`, JSON.stringify(record), {
      access: "private",
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json"
    });

    return res.status(200).json({ success: true, status });
  } catch (error) {
    console.error("Build callback storage error:", error);
    return res.status(500).json({ error: "Could not save build status." });
  }
}
