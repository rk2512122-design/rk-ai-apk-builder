
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "केवल POST अनुरोध स्वीकार है।"
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY सर्वर में सेट नहीं है।"
    });
  }

  try {
    const { appName, appType, features } = req.body || {};

    if (!appName || !features) {
      return res.status(400).json({
        error: "ऐप का नाम और सुविधाएँ लिखें।"
      });
    }

    const prompt = `
Create an Android app project specification.
App name: ${String(appName).slice(0, 100)}
App type: ${String(appType || "Other Android App").slice(0, 100)}
Required features: ${String(features).slice(0, 4000)}

Return a clear Android implementation plan with screens,
features, permissions, and suggested project files.
Do not claim that an APK has been built.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: data.error?.message || "Gemini अनुरोध विफल हुआ।"
      });
    }

    const result =
      data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("\n") || "कोई परिणाम नहीं मिला।";

    return res.status(200).json({ result });
  } catch (error) {
    return res.status(500).json({
      error: "सर्वर में समस्या हुई।"
    });
  }
}
