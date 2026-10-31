
import { get } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    return res.status(500).json({
      step: "token",
      error: "BLOB_READ_WRITE_TOKEN missing"
    });
  }

  const buildId = req.query?.buildId;

  if (
    typeof buildId !== "string" ||
    !/^[A-Za-z0-9_-]+-[0-9]+\.zip$/.test(buildId)
  ) {
    return res.status(400).json({
      step: "buildId",
      error: "Invalid buildId"
    });
  }

  const apkName = buildId.replace(/\.zip$/i, ".apk");
  const pathname = `apks/${apkName}`;

  try {
    const result = await get(pathname, {
      access: "private",
      token
    });

    if (!result) {
      return res.status(404).json({
        step: "blob",
        error: "Blob not found"
      });
    }

    return res.status(200).json({
      step: "get-success",
      statusCode: result.statusCode,
      hasStream: Boolean(result.stream),
      size: result.blob?.size,
      contentType: result.blob?.contentType
    });

  } catch (error) {
    return res.status(500).json({
      step: "get-error",
      name: error.name,
      error: error.message
    });
  }
}
