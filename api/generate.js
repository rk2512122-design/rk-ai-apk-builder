
export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel."
    });
  }

  const baseUrl =
    "https://generativelanguage.googleapis.com/v1beta/interactions";

  try {
    // Check the status of an existing background task.
    if (req.method === "GET") {
      const id = req.query?.id;

      if (!id || typeof id !== "string") {
        return res.status(400).json({
          error: "Interaction ID is required."
        });
      }

      const response = await fetch(
        `${baseUrl}/${encodeURIComponent(id)}`,
        {
          headers: {
            "x-goog-api-key": apiKey
          },
          signal: AbortSignal.timeout(10000)
        }
      );

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }

      if (!response.ok) {
        return res.status(response.status).json({
          error:
            data.error?.message ||
            "Could not check Gemini task status."
        });
      }

      const status = data.status || "in_progress";

      if (status === "completed") {
        let output = data.output_text || "";

        if (!output && Array.isArray(data.steps)) {
          output = data.steps
            .filter(step => step.type === "model_output")
            .flatMap(step => step.content || [])
            .filter(item => item.type === "text")
            .map(item => item.text || "")
            .join("\n");
        }

        if (!output) {
          return res.status(502).json({
            error: "Gemini completed without returning text."
          });
        }

        return res.status(200).json({
          status: "completed",
          result: output,
          output: output
        });
      }

      if (status === "failed" || status === "cancelled") {
        return res.status(502).json({
          status,
          error:
            data.error?.message ||
            `Gemini task ${status}. Please try again.`
        });
      }

      return res.status(200).json({
        status: status,
        id: data.id || id
      });
    }

    // Start a new background task.
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Only POST and GET requests are allowed."
      });
    }

    const { appName, appType, features } = req.body || {};

    if (
      typeof appName !== "string" ||
      typeof appType !== "string" ||
      typeof features !== "string" ||
      !appName.trim() ||
      !appType.trim() ||
      !features.trim()
    ) {
      return res.status(400).json({
        error: "Please enter the app name, app type, and features."
      });
    }

    const prompt = `
Create an original Android app project plan and basic source code.

App name: ${appName.trim()}
App type: ${appType.trim()}
Required features: ${features.trim()}

Requirements:
- Use original content.
- Do not copy copyrighted apps or source code.
- Give a concise project plan and basic Android source code.
- Explain how to build the project.
- Do not claim an APK has been built unless it actually has.
`;

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
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
      signal: AbortSignal.timeout(15000)
    });

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.error?.message ||
          `Gemini API error (${response.status}).`
      });
    }

    if (!data.id) {
      return res.status(502).json({
        error: "Gemini did not return a task ID."
      });
    }

    return res.status(202).json({
      status: data.status || "in_progress",
      id: data.id
    });
  } catch (error) {
    console.error("Gemini API error:", error);

    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError"
    ) {
      return res.status(504).json({
        error: "The request timed out. Please try again."
      });
    }

    return res.status(500).json({
      error: "Unable to connect to Gemini. Please try again."
    });
  }
}
