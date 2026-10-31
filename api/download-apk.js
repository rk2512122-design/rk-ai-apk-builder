
import { get } from "@vercel/blob";
import { Readable } from "node:stream";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("GET only");
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const buildId = req.query?.buildId;

  if (!token) {
    return res.status(500).send("Blob token missing");
  }

  if (
    typeof buildId !== "string" ||
    !/^[A-Za-z0-9_-]+-[0-9]+\.zip$/.test(buildId)
  ) {
    return res.status(400).send("Invalid buildId");
  }

  const apkName = buildId.replace(/\.zip$/i, ".apk");
  const pathname = `apks/${apkName}`;

  try {
    const result = await get(pathname, {
      access: "private",
      token
    });

    if (!result || result.statusCode !== 200) {
      return res.status(404).send("APK not found");
    }

    res.setHeader(
      "Content-Type",
      result.blob.contentType || "application/vnd.android.package-archive"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${apkName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");

    Readable.fromWeb(result.stream).pipe(res);

  } catch (error) {
    console.error("APK download error:", error);
    if (!res.headersSent) {
      return res.status(500).send("Download error: " + error.message);
    }
    res.destroy(error);
  }
}
