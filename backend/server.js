import "dotenv/config";
import cors from "cors";
import express from "express";
import OpenAI from "openai";
import { PDFParse } from "pdf-parse";

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
const DEFAULT_CHAT_TIMEOUT_MS = Number(process.env.CHAT_PROVIDER_TIMEOUT_MS || 30000);
const DEFAULT_IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_PROVIDER_TIMEOUT_MS || 45000);
const MAX_ATTACHMENT_BYTES = Number(process.env.MAX_ATTACHMENT_BYTES || 5 * 1024 * 1024);
const MAX_ATTACHMENT_TEXT_CHARS = Number(process.env.MAX_ATTACHMENT_TEXT_CHARS || 18000);

const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"
});

function getMessageText(message) {
  return String(message?.content || "").trim();
}

function toGeminiContents(messages) {
  return messages
    .filter(message => message.role !== "system")
    .map(message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: getMessageText(message) }]
    }))
    .filter(message => message.parts[0].text);
}

function getLastUserPrompt(messages) {
  return getMessageText([...messages].reverse().find(message => message.role === "user"));
}

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;

  const name = String(attachment.name || "attachment").slice(0, 180);
  const type = String(attachment.type || "application/octet-stream").slice(0, 120);
  const data = String(attachment.data || "");

  if (!data) return null;

  return { name, type, data };
}

async function extractAttachmentText(attachment) {
  const normalized = normalizeAttachment(attachment);
  if (!normalized) return "";

  const buffer = Buffer.from(normalized.data, "base64");
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment "${normalized.name}" is too large. Maximum size is ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`);
  }

  let text = "";
  if (normalized.type === "application/pdf" || normalized.name.toLowerCase().endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      text = parsed.text || "";
    } finally {
      await parser.destroy();
    }
  } else if (
    normalized.type.startsWith("text/") ||
    /\.(txt|md|csv|json|js|ts|html|css|log)$/i.test(normalized.name)
  ) {
    text = buffer.toString("utf8");
  } else {
    throw new Error(`Attachment "${normalized.name}" is not supported yet. Please attach a PDF or text file.`);
  }

  const cleanText = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleanText) {
    throw new Error(`Could not extract readable text from "${normalized.name}".`);
  }

  return [
    `Attached file: ${normalized.name}`,
    `File type: ${normalized.type}`,
    "Extracted content:",
    cleanText.slice(0, MAX_ATTACHMENT_TEXT_CHARS)
  ].join("\n");
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function callProvider(provider, messages) {
  console.log(`Calling ${provider.name} (${provider.model})...`);

  try {
    const result = await withTimeout(provider.complete(messages), provider.timeoutMs, provider.name);
    console.log(`${provider.name} responded`);
    return result;
  } catch (error) {
    console.error(`${provider.name} failed: ${error.message || error}`);
    throw error;
  }
}

async function completeWithFallback(provider, messages) {
  try {
    return {
      provider,
      result: await callProvider(provider, messages)
    };
  } catch (error) {
    if (provider === providers.groqChat && process.env.GEMINI_API_KEY) {
      console.log("Groq chat is unavailable. Falling back to Gemini Flash...");
      return {
        provider: providers.geminiFlash,
        result: await callProvider(providers.geminiFlash, messages)
      };
    }

    if (provider === providers.nvidiaFlux && process.env.HUGGINGFACE_API_TOKEN) {
      console.log("NVIDIA Flux is unavailable. Falling back to Hugging Face FLUX.1-dev...");
      return {
        provider: providers.huggingFaceFlux,
        result: await callProvider(providers.huggingFaceFlux, messages)
      };
    }

    throw error;
  }
}

async function readProviderResponse(response, providerName) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data.error?.message ||
      data.error?.status ||
      `${providerName} request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return data;
}

function normalizeBase64Image(value) {
  if (!value || typeof value !== "string") return null;

  const dataUrlMatch = value.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      data: dataUrlMatch[2],
      mimeType: dataUrlMatch[1]
    };
  }

  return {
    data: value,
    mimeType: "image/png"
  };
}

function extractNvidiaImage(data) {
  const candidates = [
    data.image,
    data.image_base64,
    data.b64_json,
    data.artifacts?.[0]?.base64,
    data.artifacts?.[0]?.image,
    data.data?.[0]?.b64_json,
    data.data?.[0]?.image,
    data.output?.[0]?.image,
    data.output?.[0]?.b64_json
  ];

  for (const candidate of candidates) {
    const image = normalizeBase64Image(candidate);
    if (image?.data) return image;
  }

  return null;
}

const providers = {
  groqChat: {
    name: "Groq Chat",
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    timeoutMs: Number(process.env.GROQ_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS),
    async complete(messages) {
      if (!process.env.GROQ_API_KEY) {
        throw new Error("Missing GROQ_API_KEY on the backend.");
      }

      const completion = await groqClient.chat.completions.create(
        {
          model: this.model,
          messages,
          temperature: Number(process.env.GROQ_TEMPERATURE || 0.5),
          max_tokens: Number(process.env.GROQ_MAX_TOKENS || 1024),
          stream: false
        },
        {
          timeout: this.timeoutMs
        }
      );

      return completion.choices[0]?.message?.content?.trim();
    }
  },
  geminiFlash: {
    name: "Gemini Flash",
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || DEFAULT_CHAT_TIMEOUT_MS),
    async complete(messages) {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("Missing GEMINI_API_KEY on the backend.");
      }

      const systemPrompt = messages.find(message => message.role === "system")?.content;
      const url = new URL(
        `${process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"}/models/${this.model}:generateContent`
      );
      url.searchParams.set("key", process.env.GEMINI_API_KEY);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: systemPrompt
            ? {
                parts: [{ text: getMessageText({ content: systemPrompt }) }]
              }
            : undefined,
          contents: toGeminiContents(messages),
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            maxOutputTokens: 8192
          }
        })
      });

      const data = await readProviderResponse(response, this.name);
      return data.candidates?.[0]?.content?.parts
        ?.map(part => part.text)
        .filter(Boolean)
        .join("\n")
        .trim();
    }
  },
  nvidiaFlux: {
    name: "NVIDIA Flux",
    model: process.env.NVIDIA_IMAGE_MODEL || "black-forest-labs/flux.2-klein-4b",
    timeoutMs: Number(process.env.NVIDIA_IMAGE_TIMEOUT_MS || DEFAULT_IMAGE_TIMEOUT_MS),
    async complete(messages) {
      const apiKey = process.env.NVIDIA_IMAGE_API_KEY;
      if (!apiKey) {
        throw new Error("Missing NVIDIA_IMAGE_API_KEY on the backend.");
      }

      const prompt = getLastUserPrompt(messages);
      const response = await fetch(process.env.NVIDIA_IMAGE_URL || "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          prompt,
          width: Number(process.env.NVIDIA_IMAGE_WIDTH || 1024),
          height: Number(process.env.NVIDIA_IMAGE_HEIGHT || 1024),
          seed: Number(process.env.NVIDIA_IMAGE_SEED || 0),
          steps: Number(process.env.NVIDIA_IMAGE_STEPS || 4)
        })
      });

      const data = await readProviderResponse(response, this.name);
      const image = extractNvidiaImage(data);

      if (!image) {
        throw new Error(`${this.name} did not return an image.`);
      }

      return {
        reply: "Created your image.",
        image
      };
    }
  },
  huggingFaceFlux: {
    name: "Hugging Face FLUX.1-dev",
    model: process.env.HUGGINGFACE_IMAGE_MODEL || "black-forest-labs/FLUX.1-dev",
    timeoutMs: Number(process.env.HUGGINGFACE_IMAGE_TIMEOUT_MS || DEFAULT_IMAGE_TIMEOUT_MS),
    async complete(messages) {
      if (!process.env.HUGGINGFACE_API_TOKEN) {
        throw new Error("Missing HUGGINGFACE_API_TOKEN on the backend.");
      }

      const prompt = getLastUserPrompt(messages);
      const response = await fetch(
        `${process.env.HUGGINGFACE_IMAGE_BASE_URL || "https://api-inference.huggingface.co/models"}/${this.model}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "image/png",
            Authorization: `Bearer ${process.env.HUGGINGFACE_API_TOKEN}`
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              width: Number(process.env.HUGGINGFACE_IMAGE_WIDTH || 1024),
              height: Number(process.env.HUGGINGFACE_IMAGE_HEIGHT || 1024),
              num_inference_steps: Number(process.env.HUGGINGFACE_IMAGE_STEPS || 28),
              guidance_scale: Number(process.env.HUGGINGFACE_IMAGE_GUIDANCE_SCALE || 3.5)
            }
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(errorText || `${this.name} request failed with status ${response.status}.`);
      }

      const contentType = response.headers.get("content-type") || "image/png";
      if (!contentType.startsWith("image/")) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `${this.name} did not return an image.`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      return {
        reply: "Created your image.",
        image: {
          data: buffer.toString("base64"),
          mimeType: contentType
        }
      };
    }
  }
};

function chooseProvider(messages = []) {
  const prompt = getLastUserPrompt(messages).toLowerCase();
  const imageWords = "image|picture|photo|poster|logo|wallpaper|art|visual|thumbnail|banner|icon";
  const createWords = "generate|genrate|create|make|draw|design|render|paint|illustrate";
  const asksForImage =
    new RegExp(`\\b(${createWords})\\b.*\\b(${imageWords})\\b`).test(prompt) ||
    new RegExp(`\\b(${imageWords})\\b.*\\b(${createWords})\\b`).test(prompt) ||
    new RegExp(`\\b(${imageWords})\\s+of\\b`).test(prompt) ||
    /\btext\s*to\s*image\b/.test(
      prompt
    );
  if (asksForImage && process.env.NVIDIA_IMAGE_API_KEY) {
    return providers.nvidiaFlux;
  }

  if (asksForImage && process.env.HUGGINGFACE_API_TOKEN) {
    return providers.huggingFaceFlux;
  }

  if (process.env.GROQ_API_KEY) {
    return providers.groqChat;
  }

  return providers.geminiFlash;
}

app.use(
  cors({
    origin: FRONTEND_ORIGIN === "*" ? "*" : FRONTEND_ORIGIN.split(",").map(origin => origin.trim())
  })
);
app.use(express.json({ limit: "8mb" }));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Atharva chatbot backend",
    providers: Object.values(providers).map(provider => provider.name),
    defaultProvider: chooseProvider().name
  });
});

app.post("/chat", async (req, res) => {
  try {
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    const systemPrompt =
      typeof req.body.systemPrompt === "string"
        ? req.body.systemPrompt
        : "You are a fast, precise, and friendly assistant.";
    const attachmentText = await extractAttachmentText(req.body.attachment);

    const safeMessages = messages
      .filter(message => ["user", "assistant"].includes(message.role))
      .map(message => ({
        role: message.role,
        content: String(message.content || "").slice(0, 12000)
      }))
      .slice(-20);

    if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
      return res.status(400).json({ error: "A user message is required." });
    }

    const messagesForProvider = attachmentText
      ? safeMessages.map((message, index) =>
          index === safeMessages.length - 1
            ? {
                ...message,
                content: `${message.content}\n\nUse this attachment content to answer the user's request. Do not claim you cannot read the file; the extracted text is provided below.\n\n${attachmentText}`
              }
            : message
        )
      : safeMessages;

    const provider = chooseProvider(messagesForProvider);
    const completion = await completeWithFallback(provider, [{ role: "system", content: systemPrompt }, ...messagesForProvider]);
    const result = completion.result;
    const reply = typeof result === "string" ? result : result?.reply;

    res.json({
      reply: reply || `No response received from ${provider.name}.`,
      image: typeof result === "string" ? undefined : result?.image,
      provider: completion.provider.name
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Server error." });
  }
});

app.listen(PORT, () => {
  console.log(`Chatbot backend running on port ${PORT}`);
  console.log(
    `Chat timeouts: Groq ${providers.groqChat.timeoutMs}ms, Gemini ${providers.geminiFlash.timeoutMs}ms; Groq max tokens ${process.env.GROQ_MAX_TOKENS || 1024}`
  );
});
