
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

  const { appName, packageName, zipBase64 } = req.body || {};

  if (
    typeof packageName !== "string" ||
    !/^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName) ||
    packageName.length > 200
  ) {
    return res.status(400).json({ error: "A valid Android packageName is required for app identity tracking." });
  }

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

  // Build filenames must start with an alphanumeric character.
  // Strip leading/trailing separators and collapse repeated separators so
  // Hindi/Unicode app names cannot produce invalid names such as "-----App".
  const normalizedName = String(appName || "Android-App")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "")
    .slice(0, 40)
    .replace(/[^a-zA-Z0-9]+$/g, "");

  const safeName = /^[A-Za-z0-9]/.test(normalizedName)
    ? normalizedName
    : "Android-App";

  const zipName = `${safeName}-${Date.now()}.zip`;

  // Use ZIP filename as the unique build ID.
  const buildId = zipName;

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };

  try {
    // Upload Android project ZIP to the private GitHub repository.
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


    // Keep a permanent app identity record in the private build repository.
    // The package name is the stable app key across future update builds.
    const registryPath = `apps/${packageName}.json`;
    const registryUrl = `${apiUrl}/contents/${registryPath}`;
    let existingRecord = null;
    let existingSha = null;
    const existingResponse = await fetch(registryUrl, { headers });
    if (existingResponse.ok) {
      const existingFile = await existingResponse.json();
      existingSha = existingFile.sha;
      try {
        existingRecord = JSON.parse(Buffer.from(existingFile.content, "base64").toString("utf8"));
      } catch {
        return res.status(409).json({ error: "The saved app identity record is unreadable. Build was stopped to protect app identity." });
      }
      if (existingRecord.packageName !== packageName) {
        return res.status(409).json({ error: "Saved app identity does not match the requested package name." });
      }
    } else if (existingResponse.status !== 404) {
      const detail = await existingResponse.text();
      return res.status(502).json({ error: "Could not read app identity record.", details: detail.slice(0, 500) });
    }

    const now = new Date().toISOString();
    const buildRecord = {
      buildId,
      zipName,
      appName: safeName,
      createdAt: now
    };
    const registry = {
      schemaVersion: 1,
      packageName,
      appName: String(appName || safeName).slice(0, 100),
      createdAt: existingRecord?.createdAt || now,
      updatedAt: now,
      latestBuildId: buildId,
      builds: [...(Array.isArray(existingRecord?.builds) ? existingRecord.builds : []), buildRecord].slice(-50)
    };
    const registryBody = {
      message: existingSha
        ? `Update app identity: ${packageName}`
        : `Register Android app identity: ${packageName}`,
      content: Buffer.from(JSON.stringify(registry, null, 2)).toString("base64"),
      branch,
      ...(existingSha ? { sha: existingSha } : {})
    };
    const registryResponse = await fetch(registryUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify(registryBody)
    });
    if (!registryResponse.ok) {
      const detail = await registryResponse.json();
      return res.status(502).json({
        error: "Could not save the app identity record. APK build was not started.",
        details: detail.message || "GitHub registry update failed."
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
        zipName,
        buildId
      });
    }

    return res.status(200).json({
      status: "started",
      message: "Android project uploaded. APK build started.",
      zipName,
      buildId,
      packageName,
      appIdentitySaved: true,
      workflowUrl: `https://github.com/${owner}/${repo}/actions`
    });

  } catch (error) {
    return res.status(500).json({
      error: "Build request failed.",
      details: error.message
    });
  }
}
