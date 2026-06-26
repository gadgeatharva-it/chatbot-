const API_BASE_URL = window.CHATBOT_API_BASE_URL || "http://localhost:3000";
const MAX_INPUT_HEIGHT = 160;
const STORAGE_KEY = "atharva-chat-theme";

const chatBox = document.getElementById("chatBox");
const messagesWrap = document.getElementById("messagesWrap");
const userInput = document.getElementById("userInput");
const sendButton = document.getElementById("sendButton");
const newChatBtn = document.getElementById("newChatBtn");
const chatHistory = document.getElementById("chatHistory");
const welcomeHero = document.getElementById("welcomeHero");
const quickPrompts = document.getElementById("quickPrompts");
const statusText = document.getElementById("statusText");
const themeToggle = document.getElementById("themeToggle");
const settingsBtn = document.getElementById("settingsBtn");
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");
const sidebarScrim = document.getElementById("sidebarScrim");
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");
const attachmentPreview = document.getElementById("attachmentPreview");
const emojiBtn = document.getElementById("emojiBtn");
const emojiPanel = document.getElementById("emojiPanel");
const voiceBtn = document.getElementById("voiceBtn");
const toast = document.getElementById("toast");

const systemPrompt =
  "You are Atharva AI, a fast, precise, friendly assistant. Keep answers clear and render code in fenced markdown blocks when helpful.";

const sampleHistory = [
  { id: "seed-1", title: "Frontend polish ideas", preview: "Microinteractions and responsive states", messages: [] },
  { id: "seed-2", title: "Code review notes", preview: "API handling and error states", messages: [] },
  { id: "seed-3", title: "Project roadmap", preview: "Tasks, launch checks, deployment", messages: [] }
];

let sessions = [
  {
    id: makeId(),
    title: "New conversation",
    preview: "Ready when you are",
    messages: []
  },
  ...sampleHistory
];
let activeSessionId = sessions[0].id;
let isLoading = false;
let attachedFile = null;
let attachedPayload = null;
let toastTimer;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

function makeId() {
  return window.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function activeSession() {
  return sessions.find(session => session.id === activeSessionId) || sessions[0];
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlightCode(code) {
  const tokenPattern =
    /(\/\/.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(const|let|var|function|return|if|else|for|while|async|await|try|catch|class|new|import|from|export|default|throw|true|false|null|undefined)\b|\b(\d+(?:\.\d+)?)\b/gm;
  let output = "";
  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(code)) !== null) {
    output += escapeHtml(code.slice(lastIndex, match.index));
    const token = escapeHtml(match[0]);
    if (match[1]) output += `<span class="tok-comment">${token}</span>`;
    else if (match[2]) output += `<span class="tok-string">${token}</span>`;
    else if (match[3]) output += `<span class="tok-keyword">${token}</span>`;
    else output += `<span class="tok-number">${token}</span>`;
    lastIndex = tokenPattern.lastIndex;
  }

  return output + escapeHtml(code.slice(lastIndex));
}

function renderTextWithCode(text) {
  const fragment = document.createDocumentFragment();
  const pattern = /```(\w+)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    appendTextBlock(fragment, text.slice(lastIndex, match.index));
    fragment.appendChild(createCodeBlock(match[2].trimEnd(), match[1] || "text"));
    lastIndex = pattern.lastIndex;
  }

  appendTextBlock(fragment, text.slice(lastIndex));
  return fragment;
}

function appendTextBlock(fragment, text) {
  if (!text.trim()) return;
  const lines = text.trim().split(/\n{2,}/);
  lines.forEach(line => {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = escapeHtml(line).replace(/\n/g, "<br>");
    fragment.appendChild(paragraph);
  });
}

function createCodeBlock(code, language) {
  const block = document.createElement("div");
  block.className = "code-card";

  const header = document.createElement("div");
  header.className = "code-header";
  header.innerHTML = `<span>${escapeHtml(language)}</span>`;

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(code);
    copy.textContent = "Copied";
    setTimeout(() => {
      copy.textContent = "Copy";
    }, 1200);
  });

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.innerHTML = highlightCode(code);

  header.appendChild(copy);
  pre.appendChild(codeEl);
  block.append(header, pre);
  return block;
}

function autoResizeInput() {
  userInput.style.height = "auto";
  userInput.style.height = `${Math.min(userInput.scrollHeight, MAX_INPUT_HEIGHT)}px`;
}

function scrollToBottom() {
  try {
    const settings = typeof loadSettings === "function" ? loadSettings() : { autoScroll: true };
    if (!settings.autoScroll) return;
  } catch {}
  requestAnimationFrame(() => {
    messagesWrap.scrollTo({
      top: messagesWrap.scrollHeight,
      behavior: "smooth"
    });
  });
}

function renderHistory() {
  chatHistory.innerHTML = "";
  sessions.forEach(session => {
    const row = document.createElement("div");
    row.className = `history-row ${session.id === activeSessionId ? "is-active" : ""}`;

    const item = document.createElement("button");
    item.type = "button";
    item.className = "history-item";
    item.innerHTML = `
      <span class="history-title">${escapeHtml(session.title)}</span>
      <span class="history-preview">${escapeHtml(session.preview)}</span>
    `;
    item.addEventListener("click", () => {
      activeSessionId = session.id;
      document.body.classList.remove("sidebar-open");
      renderApp();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "history-delete";
    deleteButton.setAttribute("aria-label", `Delete ${session.title}`);
    deleteButton.title = "Delete";
    deleteButton.innerHTML = `<span class="icon-trash"></span>`;
    deleteButton.addEventListener("click", event => {
      event.stopPropagation();
      deleteSession(session.id);
    });

    row.append(item, deleteButton);
    chatHistory.appendChild(row);
  });
}

function deleteSession(sessionId) {
  const deletedSession = sessions.find(session => session.id === sessionId);
  sessions = sessions.filter(session => session.id !== sessionId);

  if (!sessions.length) {
    sessions = [
      {
        id: makeId(),
        title: "New conversation",
        preview: "Ready when you are",
        messages: []
      }
    ];
  }

  if (activeSessionId === sessionId) {
    activeSessionId = sessions[0].id;
  }

  showToast(`Deleted ${deletedSession?.title || "chat"}`);
  renderApp();
}

function updateChrome() {
  const session = activeSession();
  welcomeHero.hidden = session.messages.length > 0;
  sendButton.disabled = !userInput.value.trim() || isLoading;
  userInput.disabled = isLoading;
  statusText.textContent = isLoading ? "Typing" : "Online";
  document.body.classList.toggle("is-loading", isLoading);
}

function createTypingMessage() {
  const message = {
    id: makeId(),
    role: "assistant",
    content: "",
    time: formatTime(),
    typing: true
  };
  activeSession().messages.push(message);
  renderMessages();
  return message.id;
}

function renderMessages() {
  chatBox.innerHTML = "";
  const session = activeSession();

  session.messages.forEach(message => {
    const row = document.createElement("article");
    row.className = `message-row ${message.role === "user" ? "user-row" : "bot-row"}`;

    const avatar = document.createElement("div");
    avatar.className = `message-avatar ${message.role === "user" ? "user-avatar" : "bot-avatar"}`;
    avatar.textContent = message.role === "user" ? "A" : "AI";

    const bubble = document.createElement("div");
    bubble.className = `message-bubble ${message.role === "user" ? "user-msg" : "bot-msg"}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.innerHTML = `
      <span>${message.role === "user" ? "You" : "Atharva AI"}</span>
      <span>${message.time}</span>
      ${message.role === "user" ? `<span class="ticks ${message.status === "sent" ? "is-sent" : ""}">&#10003;&#10003;</span>` : ""}
    `;

    const body = document.createElement("div");
    body.className = "message-body";

    if (message.typing) {
      body.innerHTML = `
        <div class="typing-indicator" aria-label="AI is typing">
          <span></span><span></span><span></span>
        </div>
      `;
    } else {
      body.appendChild(renderTextWithCode(message.content));
      if (message.image?.data) body.appendChild(createGeneratedImage(message.image));
    }

    bubble.append(meta, body);
    if (message.role === "user") row.append(bubble, avatar);
    else row.append(avatar, bubble);
    chatBox.appendChild(row);
  });

  updateChrome();
  scrollToBottom();
}

function createGeneratedImage(image) {
  const figure = document.createElement("figure");
  figure.className = "image-card";

  const img = document.createElement("img");
  img.alt = "AI generated image";
  img.loading = "lazy";
  img.src = `data:${image.mimeType || "image/png"};base64,${image.data}`;

  const link = document.createElement("a");
  link.href = img.src;
  link.download = "atharva-ai-image.png";
  link.textContent = "Download";

  figure.append(img, link);
  return figure;
}

function renderApp() {
  renderHistory();
  renderMessages();
}

function setInputValue(value) {
  userInput.value = value;
  autoResizeInput();
  updateChrome();
  userInput.focus();
}

function updateSessionSummary(text) {
  const session = activeSession();
  const short = text.replace(/\s+/g, " ").slice(0, 58);
  if (session.messages.filter(message => message.role === "user").length <= 1) {
    session.title = short || "New conversation";
  }
  session.preview = short || session.preview;
  sessions = [session, ...sessions.filter(item => item.id !== session.id)];
  activeSessionId = session.id;
  renderHistory();
}

function setLoadingState(loading) {
  isLoading = loading;
  updateChrome();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result || "");
      resolve(dataUrl.includes(",") ? dataUrl.split(",").pop() : dataUrl);
    });
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read attachment.")));
    reader.readAsDataURL(file);
  });
}

async function sendMessage(prefilledText) {
  const rawText = typeof prefilledText === "string" ? prefilledText : userInput.value;
  const text = rawText.trim();
  if (!text || isLoading) return;

  const session = activeSession();
  const attachmentText = attachedFile ? `\n\nAttached: ${attachedFile.name}` : "";
  const attachment = attachedPayload;
  session.messages.push({
    id: makeId(),
    role: "user",
    content: `${text}${attachmentText}`,
    time: formatTime(),
    status: "sending"
  });

  updateSessionSummary(text);
  attachedFile = null;
  attachedPayload = null;
  attachmentPreview.hidden = true;
  fileInput.value = "";
  userInput.value = "";
  autoResizeInput();
  setLoadingState(true);
  renderMessages();

  const typingId = createTypingMessage();

  try {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: session.messages
          .filter(message => ["user", "assistant"].includes(message.role) && !message.typing)
          .map(message => ({ role: message.role, content: message.content })),
        attachment,
        systemPrompt
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Chat request failed.");

    session.messages = session.messages.map(message =>
      message.id === typingId
        ? {
            id: message.id,
            role: "assistant",
            content: data.reply?.trim() || "No response received from the AI.",
            image: data.image,
            time: formatTime()
          }
        : message.role === "user"
          ? { ...message, status: "sent" }
          : message
    );
    session.preview = data.reply?.replace(/\s+/g, " ").slice(0, 58) || session.preview;
  } catch (error) {
    session.messages = session.messages.map(message =>
      message.id === typingId
        ? {
            id: message.id,
            role: "assistant",
            content:
              error.message === "Failed to fetch"
                ? `Cannot connect to backend at ${API_BASE_URL}.`
                : error.message || "Error. Please check the backend server.",
            time: formatTime()
          }
        : message.role === "user"
          ? { ...message, status: "sent" }
          : message
    );
  } finally {
    setLoadingState(false);
    renderApp();
  }
}

function startNewChat() {
  const session = {
    id: makeId(),
    title: "New conversation",
    preview: "Ready when you are",
    messages: []
  };
  sessions = [session, ...sessions];
  activeSessionId = session.id;
  userInput.value = "";
  autoResizeInput();
  document.body.classList.remove("sidebar-open");
  renderApp();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

function toggleSidebar(open) {
  document.body.classList.toggle("sidebar-open", open);
}

function setupVoiceInput() {
  if (!recognition) {
    voiceBtn.addEventListener("click", () => showToast("Voice input is not available in this browser."));
    return;
  }

  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.addEventListener("result", event => {
    const transcript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join("");
    setInputValue(transcript);
  });

  recognition.addEventListener("end", () => {
    voiceBtn.classList.remove("is-recording");
  });

  voiceBtn.addEventListener("click", () => {
    voiceBtn.classList.add("is-recording");
    recognition.start();
  });
}

userInput.addEventListener("input", () => {
  autoResizeInput();
  updateChrome();
});

userInput.addEventListener("keydown", event => {
  const settings = loadSettings();
  if (event.key === "Enter" && !event.shiftKey && settings.sendOnEnter) {
    event.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", () => sendMessage());
newChatBtn.addEventListener("click", startNewChat);

/* ── Settings Modal ── */

const settingsOverlay = document.getElementById("settingsOverlay");
const settingsModal = document.getElementById("settingsModal");
const settingsClose = document.getElementById("settingsClose");
const settingsDoneBtn = document.getElementById("settingsDoneBtn");
const themeSwitcher = document.getElementById("themeSwitcher");
const fontSizeSlider = document.getElementById("fontSizeSlider");
const fontSizeLabel = document.getElementById("fontSizeLabel");
const autoScrollToggle = document.getElementById("autoScrollToggle");
const soundToggle = document.getElementById("soundToggle");
const sendEnterToggle = document.getElementById("sendEnterToggle");
const apiEndpointInput = document.getElementById("apiEndpointInput");
const clearAllChatsBtn = document.getElementById("clearAllChatsBtn");
const resetSettingsBtn = document.getElementById("resetSettingsBtn");

const SETTINGS_KEY = "atharva-chat-settings";

const defaultSettings = {
  fontSize: 16,
  autoScroll: true,
  sound: false,
  sendOnEnter: true,
  apiEndpoint: ""
};

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applySettings(settings) {
  // Font size
  document.documentElement.style.setProperty("--msg-font-size", `${settings.fontSize}px`);
  fontSizeSlider.value = settings.fontSize;
  fontSizeLabel.textContent = `${settings.fontSize}px`;

  // Toggles
  autoScrollToggle.checked = settings.autoScroll;
  soundToggle.checked = settings.sound;
  sendEnterToggle.checked = settings.sendOnEnter;

  // API endpoint
  apiEndpointInput.value = settings.apiEndpoint || "";

  // Sync theme switcher
  syncThemeSwitcher();
}

function syncThemeSwitcher() {
  const currentTheme = document.documentElement.dataset.theme || "dark";
  themeSwitcher.querySelectorAll(".theme-option").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.theme === currentTheme);
  });
}

function openSettings() {
  const settings = loadSettings();
  applySettings(settings);
  settingsOverlay.classList.add("is-open");
}

function closeSettings() {
  settingsOverlay.classList.remove("is-open");

  // Save current state
  const settings = {
    fontSize: parseInt(fontSizeSlider.value, 10),
    autoScroll: autoScrollToggle.checked,
    sound: soundToggle.checked,
    sendOnEnter: sendEnterToggle.checked,
    apiEndpoint: apiEndpointInput.value.trim()
  };
  saveSettings(settings);
}

settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsDoneBtn.addEventListener("click", closeSettings);

settingsOverlay.addEventListener("click", event => {
  if (event.target === settingsOverlay) closeSettings();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && settingsOverlay.classList.contains("is-open")) {
    closeSettings();
  }
});

// Theme switcher
themeSwitcher.addEventListener("click", event => {
  const btn = event.target.closest(".theme-option");
  if (!btn) return;
  applyTheme(btn.dataset.theme);
  syncThemeSwitcher();
});

// Font size slider
fontSizeSlider.addEventListener("input", () => {
  const size = fontSizeSlider.value;
  fontSizeLabel.textContent = `${size}px`;
  document.documentElement.style.setProperty("--msg-font-size", `${size}px`);
});

// Clear all chats
clearAllChatsBtn.addEventListener("click", () => {
  if (!confirm("Delete all conversations? This cannot be undone.")) return;
  sessions = [{
    id: makeId(),
    title: "New conversation",
    preview: "Ready when you are",
    messages: []
  }];
  activeSessionId = sessions[0].id;
  showToast("All chats cleared");
  renderApp();
});

// Reset settings
resetSettingsBtn.addEventListener("click", () => {
  if (!confirm("Reset all settings to defaults?")) return;
  saveSettings(defaultSettings);
  applySettings(defaultSettings);
  applyTheme("dark");
  syncThemeSwitcher();
  showToast("Settings reset to defaults");
});

themeToggle.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(nextTheme);
  syncThemeSwitcher();
});

menuToggle.addEventListener("click", () => toggleSidebar(true));
sidebarScrim.addEventListener("click", () => toggleSidebar(false));

quickPrompts.addEventListener("click", event => {
  const button = event.target.closest("button[data-prompt]");
  if (button) setInputValue(button.dataset.prompt);
});

attachBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  attachedFile = fileInput.files?.[0] || null;
  if (!attachedFile) return;

  const supported =
    attachedFile.type === "application/pdf" ||
    attachedFile.type.startsWith("text/") ||
    /\.(txt|md|csv|json|js|ts|html|css|log|pdf)$/i.test(attachedFile.name);

  if (!supported) {
    attachedFile = null;
    attachedPayload = null;
    fileInput.value = "";
    showToast("Attach a PDF or text file.");
    return;
  }

  try {
    attachedPayload = {
      name: attachedFile.name,
      type: attachedFile.type || "application/octet-stream",
      data: await readFileAsBase64(attachedFile)
    };
    attachmentPreview.textContent = `${attachedFile.name} - ${Math.ceil(attachedFile.size / 1024)} KB`;
    attachmentPreview.hidden = false;
    showToast("Attachment ready");
  } catch (error) {
    attachedFile = null;
    attachedPayload = null;
    showToast(error.message || "Could not read attachment.");
  }
});

emojiBtn.addEventListener("click", () => {
  emojiPanel.hidden = !emojiPanel.hidden;
});

emojiPanel.addEventListener("click", event => {
  const emoji = event.target.closest("button")?.textContent;
  if (!emoji) return;
  const start = userInput.selectionStart;
  const end = userInput.selectionEnd;
  userInput.value = `${userInput.value.slice(0, start)}${emoji}${userInput.value.slice(end)}`;
  userInput.selectionStart = userInput.selectionEnd = start + emoji.length;
  emojiPanel.hidden = true;
  autoResizeInput();
  updateChrome();
  userInput.focus();
});

document.addEventListener("click", event => {
  if (!emojiPanel.hidden && !emojiPanel.contains(event.target) && !emojiBtn.contains(event.target)) {
    emojiPanel.hidden = true;
  }
});

setupVoiceInput();
applyTheme(localStorage.getItem(STORAGE_KEY) || "dark");
autoResizeInput();

// Apply saved settings on load
const savedSettings = loadSettings();
document.documentElement.style.setProperty("--msg-font-size", `${savedSettings.fontSize}px`);

renderApp();

window.sendMessage = sendMessage;
