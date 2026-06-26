# Atharva Chatbot

## Folder structure

- `frontend/` deploys to Netlify.
- `backend/` deploys to Render.

## Local backend

```bash
cd backend
npm install
copy .env.example .env
npm run dev
```

Put your API keys in `backend/.env`. For chat, set your Groq values. For image generation, set either the NVIDIA Flux values or the Hugging Face Flux values from `backend/.env.example`.

## Netlify frontend

Deploy the `frontend/` folder.

After your Render backend is live, update this line in `frontend/config.js`:

```js
window.CHATBOT_API_BASE_URL = "https://your-render-app.onrender.com";
```

## Render backend

Create a new Web Service using the `backend/` folder.

- Build command: `npm install`
- Start command: `npm start`
- Environment variables:
  - `GROQ_API_KEY`: your Groq chat API key
  - `GROQ_MODEL`: your Groq chat model, for example `llama-3.3-70b-versatile`
  - `NVIDIA_IMAGE_API_KEY`: your NVIDIA Flux API key
  - `HUGGINGFACE_API_TOKEN`: your Hugging Face token for FLUX fallback or direct image generation
  - `GEMINI_API_KEY`: your Gemini API key for backup chat responses
  - `FRONTEND_ORIGIN`: your Netlify site URL

Do not put API keys in `frontend/`. Browser code is public.
