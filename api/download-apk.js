
import { get } from "@vercel/blob";
import { Readable } from "node:stream";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const buildId = req.query?.buildId;

  if (!token) {
    return res.status(500).json({ error: "Blob token missing" });
  }

  if (
    typeof buildId !== "string" ||
    !/^[A-Za-z0-9_-]+-[0-9]+\.zip$/.test(buildId)
  ) {
    return res.status(400).json({ error: "Invalid buildId" });
  }

  const apkName = buildId.replace(/\.zip$/i, ".apk");
  const pathname = `apks/${apkName}`;

  try {
    const result = await get(pathname, {
      access: "private",
      token
    });

    if (!result || result.statusCode !== 200 || !result.stream) {
      return res.status(404).json({
        error: "APK stream not available"
      });
    }

    res.statusCode = 200;
    res.setHeader(
      "Content-Type",
      "application/vnd.android.package-archive"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${apkName}"`
    );
    res.setHeader("Content-Length", String(result.blob.size));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const stream = Readable.fromWeb(result.stream);

    stream.on("error", (error) => {
      console.error("APK stream error:", error);
      res.destroy(error);
    });

    stream.pipe(res);

  } catch (error) {
    console.error("APK download error:", error);

    if (!res.headersSent) {
      return res.status(500).json({
        error: "APK download failed",
        details: error.message
      });
    }

    res.destroy(error);
  }
}
