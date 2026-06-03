import "dotenv/config";
import cors from "cors";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";

app.use(
  cors({
    origin: FRONTEND_ORIGIN === "*" ? "*" : FRONTEND_ORIGIN.split(",").map(origin => origin.trim())
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({ ok: true, service: "Atharva chatbot backend", provider: "Groq" });
});

app.post("/chat", async (req, res) => {
  try {
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: "Missing GROQ_API_KEY on the backend." });
    }

    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    const systemPrompt =
      typeof req.body.systemPrompt === "string"
        ? req.body.systemPrompt
        : "You are a fast, precise, and friendly assistant.";

    const safeMessages = messages
      .filter(message => ["user", "assistant"].includes(message.role))
      .map(message => ({
        role: message.role,
        content: String(message.content || "").slice(0, 8000)
      }))
      .slice(-20);

    if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
      return res.status(400).json({ error: "A user message is required." });
    }

    const aiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
        temperature: 0.5,
        max_tokens: 1024
      })
    });

    const data = await aiResponse.json();

    if (!aiResponse.ok) {
      const errorMessage =
        data.error?.message ||
        data.error?.detail ||
        data.message ||
        data.detail ||
        `Groq request failed with status ${aiResponse.status}: ${JSON.stringify(data)}`;

      return res.status(aiResponse.status).json({
        error: errorMessage
      });
    }

    const replyContent = data.choices?.[0]?.message?.content;
    const reply = Array.isArray(replyContent)
      ? replyContent.map(part => part.text).filter(Boolean).join("\n").trim()
      : replyContent?.trim();

    res.json({ reply: reply || "No response received from Groq." });
  } catch (error) {
    res.status(500).json({ error: error.message || "Server error." });
  }
});

app.listen(PORT, () => {
  console.log(`Chatbot backend running on port ${PORT}`);
});
