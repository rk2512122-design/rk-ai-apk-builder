
export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is not configured in Vercel."
    });
  }

  const baseUrl =
    "https://generativelanguage.googleapis.com/v1beta/interactions";

  const headers = {
    "x-goog-api-key": apiKey,
    "Api-Revision": "2026-05-20"
  };

  async function readResponse(response) {
    const raw = await response.text();

    try {
      return JSON.parse(raw);
    } catch {
      return { message: raw.slice(0, 500) };
    }
  }

  try {
    if (req.method === "GET") {
      const id = req.query?.id;

      if (!id) {
        return res.status(400).json({
          error: "Missing interaction ID."
        });
      }

      const response = await fetch(
        `${baseUrl}/${encodeURIComponent(id)}`,
        {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(15000)
        }
      );

      const data = await readResponse(response);

      if (!response.ok) {
        console.error("Gemini poll error:", response.status, data);

        return res.status(502).json({
          error: "Gemini status check failed.",
          details: data.error?.message || data.message ||
            `Google API returned HTTP ${response.status}.`
        });
      }

      const status =
        typeof data.status === "string" ? data.status : "";

      console.log("Gemini interaction poll:", {
        status: status || "MISSING",
        responseKeys: Object.keys(data)
      });

      if (!status) {
        return res.status(502).json({
          error: "Gemini response did not contain a status.",
          responseKeys: Object.keys(data)
        });
      }

      if (status === "completed") {
        let output = data.output_text || "";

        if (!output && Array.isArray(data.steps)) {
          for (const step of data.steps) {
            if (
              step.type === "model_output" &&
              typeof step.text === "string"
            ) {
              output += step.text;
            }

            if (Array.isArray(step.content)) {
              for (const item of step.content) {
                if (typeof item.text === "string") {
                  output += item.text;
                }
              }
            }
          }
        }

        if (!output && Array.isArray(data.outputs)) {
          for (const item of data.outputs) {
            if (typeof item.text === "string") {
              output += item.text;
            }
          }
        }

        if (!output) {
          return res.status(502).json({
            error: "Gemini completed but no text output was found.",
            responseKeys: Object.keys(data)
          });
        }

        return res.status(200).json({
          status: "completed",
          id,
          output
        });
      }

      if (status === "failed" || status === "cancelled") {
        return res.status(502).json({
          status,
          error:
            data.error?.message ||
            data.message ||
            `Gemini task ended with status: ${status}.`
        });
      }

      if (status !== "in_progress") {
        return res.status(502).json({
          error: `Unexpected Gemini status: ${status}`,
          responseKeys: Object.keys(data)
        });
      }

      return res.status(200).json({
        status: "in_progress",
        id
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");

      return res.status(405).json({
        error: "Method not allowed."
      });
    }

    const { appName, appType, features } = req.body || {};

    if (!appName || !appType || !features) {
      return res.status(400).json({
        error: "App name, app type and features are required."
      });
    }

    const prompt = `
Create a practical Android app project specification and source code.

App name: ${String(appName).slice(0, 100)}
App type: ${String(appType).slice(0, 100)}
Requested features: ${String(features).slice(0, 4000)}

Return:
1. Project file structure.
2. AndroidManifest.xml.
3. Gradle configuration.
4. MainActivity source code.
5. Instructions to build a debug APK.

Be concise but include usable code.
Do not claim that an APK has already been built.
`;

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        input: prompt,
        background: true,
        generation_config: {
          thinking_level: "low",
          max_output_tokens: 1024
        }
      }),
      signal: AbortSignal.timeout(20000)
    });

    const data = await readResponse(response);

    if (!response.ok) {
      console.error("Gemini start error:", response.status, data);

      return res.status(502).json({
        error: "Gemini could not start the task.",
        details: data.error?.message || data.message ||
          `Google API returned HTTP ${response.status}.`
      });
    }

    if (!data.id) {
      console.error("Gemini start response missing ID:", data);

      return res.status(502).json({
        error: "Gemini response did not contain a task ID.",
        responseKeys: Object.keys(data)
      });
    }

    const status =
      typeof data.status === "string" ? data.status : "in_progress";

    console.log("Gemini interaction started:", {
      status,
      hasId: true,
      responseKeys: Object.keys(data)
    });

    return res.status(202).json({
      status,
      id: data.id
    });
  } catch (error) {
    console.error("Generate API error:", error);

    return res.status(500).json({
      error: "Server error while contacting Gemini.",
      details: error.name === "TimeoutError"
        ? "Google API request timed out."
        : error.message
    });
  }
}
