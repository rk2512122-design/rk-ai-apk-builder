import { get, head } from "@vercel/blob";

function isNotFound(error) {
  return error?.name === "BlobNotFoundError" || error?.status === 404;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Only GET requests are supported." });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is missing." });
  }

  const buildId = req.query?.buildId;
  if (typeof buildId !== "string" || !/^[A-Za-z0-9_-]+-[0-9]+\\.zip$/.test(buildId)) {
    return res.status(400).json({ error: "A valid buildId is required." });
  }

  const apkName = buildId.replace(/\\.zip$/i, ".apk");

  try {
    // Prefer the workflow's explicit status record so failed builds do not poll forever.
    try {
      const saved = await get(`build-status/${buildId}.json`, {
        access: "private",
        token
      });

      if (saved?.statusCode === 200) {
        const record = await new Response(saved.stream).json();
        if (["building", "completed", "failed"].includes(record.status)) {
          return res.status(200).json({
            ...record,
            buildId,
            ...(record.status === "completed" ? { apkName } : {})
          });
        }
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    // Backward compatibility: older builds have no status record.
    try {
      const blob = await head(`apks/${apkName}`, { token });
      return res.status(200).json({
        status: "completed",
        message: "APK is ready for download.",
        buildId,
        apkName,
        size: blob.size
      });
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return res.status(200).json({
        status: "building",
        message: "APK is still being built.",
        buildId
      });
    }
  } catch (error) {
    console.error("Build status error:", error);
    return res.status(500).json({
      error: "Could not check APK build status."
    });
  }
}
