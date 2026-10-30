
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Only POST requests are supported."
    });
  }

  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "GITHUB_TOKEN is missing in Vercel Environment Variables."
    });
  }

  const { appName, zipBase64 } = req.body || {};

  if (
    typeof zipBase64 !== "string" ||
    !zipBase64.trim()
  ) {
    return res.status(400).json({
      error: "Android project ZIP is required."
    });
  }

  const cleanBase64 = zipBase64.replace(
    /^data:application\/zip;base64,/,
    ""
  );

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64)) {
    return res.status(400).json({
      error: "Invalid ZIP base64 data."
    });
  }

  const zipBuffer = Buffer.from(cleanBase64, "base64");

  if (
    zipBuffer.length < 4 ||
    zipBuffer.length > 4 * 1024 * 1024 ||
    zipBuffer[0] !== 0x50 ||
    zipBuffer[1] !== 0x4b
  ) {
    return res.status(400).json({
      error: "Invalid ZIP file or ZIP exceeds the 4 MB limit."
    });
  }

  const owner = "rk2512122-design";
  const repo = "rk-ai-apk-builds";
  const branch = "main";

  const safeName = String(appName || "Android-App")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 40) || "Android-App";

  const zipName = `${safeName}-${Date.now()}.zip`;

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };

  try {
    // Upload the generated ZIP to the private repository.
    const uploadResponse = await fetch(
      `${apiUrl}/contents/${zipName}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: `Upload Android project: ${safeName}`,
          content: zipBuffer.toString("base64"),
          branch
        })
      }
    );

    const uploadData = await uploadResponse.json();

    if (!uploadResponse.ok) {
      return res.status(502).json({
        error: "Could not upload the Android project to GitHub.",
        details: uploadData.message || "GitHub upload failed."
      });
    }

    // Start the APK build workflow.
    const workflowResponse = await fetch(
      `${apiUrl}/actions/workflows/build-apk.yml/dispatches`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ref: branch,
          inputs: {
            zip_name: zipName
          }
        })
      }
    );

    if (!workflowResponse.ok) {
      const workflowError = await workflowResponse.json();

      return res.status(502).json({
        error: "ZIP uploaded, but APK build could not be started.",
        details: workflowError.message || "Workflow dispatch failed.",
        zipName
      });
    }

    return res.status(200).json({
      status: "started",
      message: "Android project uploaded. APK build started.",
      zipName,
      workflowUrl: `https://github.com/${owner}/${repo}/actions`
    });

  } catch (error) {
    return res.status(500).json({
      error: "Build request failed.",
      details: error.message
    });
  }
}
