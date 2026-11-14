import { get } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Only GET requests are supported." });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is missing." });

  const projectId = req.query?.projectId;
  if (typeof projectId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    return res.status(400).json({ error: "A valid projectId is required." });
  }

  try {
    const blob = await get(`projects/${projectId}.zip`, { access: "private", token });
    if (!blob || blob.statusCode !== 200) return res.status(404).json({ error: "Saved project ZIP was not found." });
    const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Content-Disposition", "attachment; filename=\"Android-Project.zip\"");
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(bytes);
  } catch (error) {
    if (error?.name === "BlobNotFoundError" || error?.status === 404) {
      return res.status(404).json({ error: "Saved project ZIP was not found." });
    }
    console.error("Project ZIP restore failed:", error);
    return res.status(500).json({ error: "Could not restore the saved project ZIP." });
  }
}
