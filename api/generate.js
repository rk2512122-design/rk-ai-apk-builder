
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Only POST requests are allowed."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel Environment Variables."
    });
  }

  try {
    const { appName, appType, features } = req.body || {};

    if (!appName || !appType || !features) {
      return res.status(400).json({
        error: "Please provide appName, appType and features."
      });
    }

    const prompt = `
Create an Android app project plan and source code.

App name: ${appName}
App type: ${appType}
Required features: ${features}

Provide:
1. Android project file structure.
2. Complete source code for each important file.
3. Required Gradle configuration.
4. Instructions to build and install the APK.

Do not claim an APK has been built.
Return a clear, practical answer.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash",
          input: prompt
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Gemini API request failed."
      });
    }

    const result = data.output_text;

    if (!result) {
      return res.status(502).json({
        error: "Gemini returned no text. Please try again."
      });
    }

    return res.status(200).json({ result });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unexpected server error."
    });
  }
}
