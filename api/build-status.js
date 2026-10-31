
import { head } from "@vercel/blob";

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
    const blob = await head(pathname, { token });

    return res.status(200).json({
      status: "completed",
      message: "APK is ready for download.",
      buildId,
      apkName,
      size: blob.size
    });

  } catch (error) {
    if (
      error.name === "BlobNotFoundError" ||
      error.status === 404
    ) {
      return res.status(200).json({
        status: "building",
        message: "APK is still being built.",
        buildId
      });
    }

    return res.status(500).json({
      error: "Could not check APK build status.",
      details: error.message
    });
  }
}
