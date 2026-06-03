const API_BASE_URL = window.CHATBOT_API_BASE_URL || "http://localhost:3000";
const MAX_INPUT_HEIGHT = 180;

const chatBox = document.getElementById("chatBox");
const userInput = document.getElementById("userInput");
const sendButton = document.getElementById("sendButton");
const suggestionBtn = document.getElementById("suggestionBtn");
const clearChatBtn = document.getElementById("clearChatBtn");
const welcomePanel = document.getElementById("welcomePanel");
const promptGrid = document.getElementById("promptGrid");
const headerBadge = document.getElementById("headerBadge");

const promptIdeas = [
  "Summarize this conversation in a clean action list.",
  "Turn my idea into a polished LinkedIn post.",
  "Explain this topic in very simple terms.",
  "Give me a fast but precise answer with examples.",
  "Help me write a short message that sounds confident."
];

const systemPrompt =
  "You are Atharva's Api, a fast, precise, and friendly assistant. Keep answers clear, helpful, and well-structured.";

let promptIndex = 0;
let isLoading = false;
let conversationHistory = [];

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function autoResizeInput() {
  userInput.style.height = "auto";
  userInput.style.height = `${Math.min(userInput.scrollHeight, MAX_INPUT_HEIGHT)}px`;
}

function updateHeaderBadge() {
  if (isLoading) {
    headerBadge.innerHTML = '<span class="status-dot"></span>Generating reply';
    return;
  }

  if (!conversationHistory.length) {
    headerBadge.innerHTML = '<span class="status-dot"></span>Groq Live';
    return;
  }

  const userTurns = conversationHistory.filter(message => message.role === "user").length;
  headerBadge.innerHTML = `<span class="status-dot"></span>${userTurns} prompt${userTurns === 1 ? "" : "s"} active`;
}

function updateComposerState() {
  const hasText = userInput.value.trim().length > 0;
  sendButton.disabled = !hasText || isLoading;
  suggestionBtn.disabled = isLoading;
  clearChatBtn.disabled = isLoading;
}

function toggleWelcomePanel() {
  welcomePanel.hidden = conversationHistory.length > 0 || chatBox.children.length > 0;
}

function scrollToBottom() {
  chatBox.scrollTop = chatBox.scrollHeight;
}

function setInputValue(value) {
  userInput.value = value;
  autoResizeInput();
  updateComposerState();
  userInput.focus();
}

function createTypingDots(body) {
  body.classList.add("typing-indicator");
  body.innerHTML = `
    <span></span>
    <span></span>
    <span></span>
  `;
}

function appendMessage(text, sender, options = {}) {
  toggleWelcomePanel();

  const row = document.createElement("div");
  row.classList.add("message-row", sender === "user" ? "user-row" : "bot-row");

  const avatar = document.createElement("div");
  avatar.classList.add("message-avatar", sender === "user" ? "user-avatar" : "bot-avatar");
  avatar.textContent = sender === "user" ? "A" : "AI";

  const bubble = document.createElement("div");
  bubble.classList.add("message", sender === "user" ? "user-msg" : "bot-msg");

  const meta = document.createElement("div");
  meta.classList.add("message-meta");
  meta.textContent =
    options.metaText ||
    `${sender === "user" ? "Atharva" : "Atharva's Api"} - ${formatTime()}`;

  const body = document.createElement("div");
  body.classList.add("message-body");

  if (options.isTyping) {
    createTypingDots(body);
  } else {
    body.textContent = text;
  }

  bubble.append(meta, body);

  if (sender === "user") {
    row.append(bubble, avatar);
  } else {
    row.append(avatar, bubble);
  }

  chatBox.appendChild(row);
  scrollToBottom();

  return { row, body, meta };
}

function setLoadingState(loading) {
  isLoading = loading;
  sendButton.textContent = loading ? "Sending..." : "Send";
  document.body.classList.toggle("is-loading", loading);
  updateComposerState();
  updateHeaderBadge();
}

function resetChat() {
  conversationHistory = [];
  chatBox.innerHTML = "";
  toggleWelcomePanel();
  updateHeaderBadge();
  updateComposerState();
}

async function sendMessage(prefilledText) {
  const text = (typeof prefilledText === "string" ? prefilledText : userInput.value).trim();
  if (!text || isLoading) return;

  appendMessage(text, "user");
  conversationHistory.push({ role: "user", content: text });

  userInput.value = "";
  autoResizeInput();
  setLoadingState(true);

  const thinkingMessage = appendMessage("", "bot", {
    isTyping: true,
    metaText: "Atharva's Api - thinking"
  });

  try {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: conversationHistory,
        systemPrompt
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Chat request failed.");
    }

    const reply = data.reply?.trim();

    thinkingMessage.body.classList.remove("typing-indicator");
    thinkingMessage.body.textContent = reply || "No response received from Groq.";
    thinkingMessage.meta.textContent = `Atharva's Api - ${formatTime()}`;

    if (reply) {
      conversationHistory.push({ role: "assistant", content: reply });
    }
  } catch (err) {
    thinkingMessage.body.classList.remove("typing-indicator");
    thinkingMessage.body.textContent =
      err.message === "Failed to fetch"
        ? `Cannot connect to backend at ${API_BASE_URL}. Start the backend locally or set your Render URL in config.js.`
        : err.message || "Error. Please check the backend server.";
    thinkingMessage.meta.textContent = "Atharva's Api - issue detected";
  } finally {
    setLoadingState(false);
    scrollToBottom();
  }
}

userInput.addEventListener("input", () => {
  autoResizeInput();
  updateComposerState();
});

userInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

suggestionBtn.addEventListener("click", () => {
  setInputValue(promptIdeas[promptIndex]);
  promptIndex = (promptIndex + 1) % promptIdeas.length;
});

clearChatBtn.addEventListener("click", resetChat);

promptGrid.addEventListener("click", event => {
  const chip = event.target.closest(".prompt-chip");
  if (!chip) return;
  setInputValue(chip.dataset.prompt || "");
});

autoResizeInput();
toggleWelcomePanel();
updateHeaderBadge();
updateComposerState();

window.sendMessage = sendMessage;
