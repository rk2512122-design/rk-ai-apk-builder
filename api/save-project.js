import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Only POST requests are supported." });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is missing." });

  const encoded = req.body?.zipBase64;
  if (typeof encoded !== "string" || !encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    return res.status(400).json({ error: "Valid ZIP base64 data is required." });
  }

  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length < 4 || buffer.length > 4 * 1024 * 1024 ||
      buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return res.status(400).json({ error: "Invalid ZIP file or ZIP exceeds the 4 MB limit." });
  }

  const projectId = randomUUID();
  try {
    await put(`projects/${projectId}.zip`, buffer, {
      access: "private",
      token,
      addRandomSuffix: false,
      contentType: "application/zip"
    });
    return res.status(200).json({ success: true, projectId, size: buffer.length });
  } catch (error) {
    console.error("Project ZIP backup failed:", error);
    return res.status(500).json({ error: "Could not save the project ZIP backup." });
  }
}
