# Atharva Chatbot 001

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

Put your Groq key in `backend/.env`.

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
  - `GROQ_API_KEY`: your Groq key
  - `GROQ_MODEL`: `llama-3.3-70b-versatile`
  - `FRONTEND_ORIGIN`: your Netlify site URL

Do not put API keys in `frontend/`. Browser code is public.
