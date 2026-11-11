import { timingSafeEqual } from "node:crypto";

function authorized(req) {
  const expected = process.env.ADMIN_PANEL_PASSWORD;
  const supplied = String(req.headers["x-admin-password"] || "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Only GET requests are supported." });
  }
  if (!process.env.ADMIN_PANEL_PASSWORD) {
    return res.status(503).json({ error: "Admin panel is not configured. Set ADMIN_PANEL_PASSWORD in Vercel." });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: "Admin login is incorrect." });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN is missing." });
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  try {
    const response = await fetch("https://api.github.com/repos/rk2512122-design/rk-ai-apk-builds/contents/apps", { headers });
    if (response.status === 404) return res.status(200).json({ apps: [] });
    if (!response.ok) throw new Error("Private app registry returned HTTP " + response.status);
    const entries = await response.json();
    const files = entries.filter(item => item.type === "file" && item.name.endsWith(".json"));
    const apps = [];
    for (const file of files) {
      const detailResponse = await fetch(file.url, { headers });
      if (!detailResponse.ok) continue;
      const detail = await detailResponse.json();
      try {
        const record = JSON.parse(Buffer.from(detail.content, "base64").toString("utf8"));
        if (record && typeof record.packageName === "string") {
          apps.push({
            appName: String(record.appName || record.packageName),
            packageName: record.packageName,
            createdAt: record.createdAt || null,
            updatedAt: record.updatedAt || null,
            latestBuildId: record.latestBuildId || null,
            builds: Array.isArray(record.builds) ? record.builds.length : 0
          });
        }
      } catch {}
    }
    apps.sort((a,b) => String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
    return res.status(200).json({ apps });
  } catch (error) {
    console.error("Admin app registry error:", error);
    return res.status(502).json({ error: "Could not load private app registry." });
  }
}
