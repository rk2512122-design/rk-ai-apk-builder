
import { get } from "@vercel/blob";
import { Readable } from "node:stream";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Only GET requests are supported."
    });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "BLOB_READ_WRITE_TOKEN is missing."
    });
  }

  const buildId = req.query?.buildId;

  if (
    typeof buildId !== "string" ||
    !/^[A-Za-z0-9_-]+-[0-9]+\.zip$/.test(buildId)
  ) {
    return res.status(400).json({
      error: "A valid buildId is required."
    });
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
        error: "APK is not available yet."
      });
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.android.package-archive"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${apkName}"`
    );

    res.setHeader("Content-Length", result.blob.size);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");

    Readable.fromWeb(result.stream).pipe(res);

  } catch (error) {
    console.error("APK download error:", error);

    return res.status(500).json({
      error: "APK download failed."
    });
  }
}
