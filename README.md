# ScriptCare — Prescription Transcriber

A small web app that renders prescription PDF pages to images and asks Groq's vision model to return a literal text transcription. It marks unreadable parts as `[unclear]` instead of guessing medication names or doses.

## Requirements

- Node.js 20 or newer
- A Groq API key from [GroqCloud](https://console.groq.com/keys)

## Run locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and add your Groq API key as `GROQ_API_KEY`. The default vision model is `qwen/qwen3.8-27b`; you can optionally change `GROQ_MODEL` to another Groq vision model available to your account.
3. Start the frontend and API:

   ```sh
   npm run dev
   ```

4. Open the local URL printed by Vite (usually `http://localhost:5173`).

The API accepts PDFs up to 20 MB and 12 pages, renders pages in memory, and does not save the uploaded file or transcription to disk. Page images are sent to Groq for processing. Groq's API access is subject to its current usage limits and data-handling terms. Avoid uploading identifiable patient information unless you have appropriate consent and have reviewed those terms.

## Important

This is an AI-assisted transcription aid, not a medical device or source of medical advice. AI can misread handwriting, medicines, and dosages. Always have a doctor or pharmacist verify the transcription before relying on it.
