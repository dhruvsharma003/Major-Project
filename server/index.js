import "dotenv/config";
import express from "express";
import multer from "multer";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const app = express();
const port = Number(process.env.PORT) || 3001;
const maxFileSize = 20 * 1024 * 1024;
const maxPdfPages = 12;
const maxImagesPerRequest = 3;

globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;
globalThis.Path2D ??= Path2D;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSize, files: 1 },
  fileFilter(_request, file, callback) {
    if (file.mimetype !== "application/pdf" || !file.originalname.toLowerCase().endsWith(".pdf")) {
      callback(new Error("Please upload a PDF file."));
      return;
    }
    callback(null, true);
  },
});

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", groqConfigured: Boolean(process.env.GROQ_API_KEY) });
});

async function renderPdfPages(pdfBuffer) {
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;

  try {
    if (pdf.numPages > maxPdfPages) {
      throw new Error(`This PDF has ${pdf.numPages} pages. Please upload a PDF with ${maxPdfPages} pages or fewer.`);
    }

    const images = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        await page.render({ canvas, viewport }).promise;
        images.push(canvas.toBuffer("image/jpeg", 85));
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
    return images;
  } finally {
    await loadingTask.destroy();
  }
}

async function requestGroqTranscription(images, startPage, model, prompt) {
  const content = [
    { type: "text", text: `Transcribe pages ${startPage + 1}–${startPage + images.length}. Keep each page's text in order and clearly separate pages.` },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` },
    })),
  ];
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content },
    ],
    temperature: 0.1,
    max_completion_tokens: 4096,
  });

  let apiResponse;
  let responseText;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    apiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body,
      signal: AbortSignal.timeout(90_000),
    });
    responseText = await apiResponse.text();

    const isRetryableOverload = apiResponse.status === 503 || apiResponse.status === 502;
    if (!isRetryableOverload || attempt === 2) break;

    console.warn(`Groq is temporarily unavailable; retrying (${attempt + 1}/2).`);
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    console.error("Groq returned a non-JSON response:", { status: apiResponse.status });
    throw new Error("Groq returned an unexpected response. Please try again.");
  }

  if (!apiResponse.ok) {
    const providerMessage = result.error?.message || "Groq API request failed.";
    console.error("Groq transcription request failed:", { status: apiResponse.status, message: providerMessage });

    if (apiResponse.status === 429) {
      throw new Error("The Groq free API limit was reached. Wait for the quota to reset, then try again.");
    }
    if (apiResponse.status === 401 || apiResponse.status === 403) {
      throw new Error("Groq rejected the API key. Check GROQ_API_KEY in .env and restart the API server.");
    }
    if (apiResponse.status === 503 || apiResponse.status === 502) {
      throw new Error("Groq is temporarily unavailable. Please wait a little and try again.");
    }
    throw new Error(`Groq could not process this PDF: ${providerMessage}`);
  }

  const transcription = result.choices?.[0]?.message?.content?.trim();
  if (!transcription) {
    throw new Error(`Groq returned no readable text for pages ${startPage + 1}–${startPage + images.length}.`);
  }
  return transcription;
}

app.post("/api/transcribe", upload.single("prescription"), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: "Choose a prescription PDF to transcribe." });
    return;
  }

  if (!process.env.GROQ_API_KEY) {
    response.status(503).json({ error: "The server is missing its Groq API key. Add GROQ_API_KEY to the .env file, then restart the API." });
    return;
  }

  try {
    const model = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
    const prompt = [
        "Transcribe the text visible in this doctor's prescription PDF as accurately and literally as possible.",
        "Preserve the original language, spelling, abbreviations, numbers, dosage notation, and line breaks where practical.",
        "Do not interpret, correct, expand abbreviations, provide medical advice, or infer missing information.",
        "If any word, number, or instruction cannot be read confidently, write [unclear] in its place. Never guess medication names or doses.",
        "Return only the transcription. Do not add a heading, summary, or commentary.",
      ].join(" ");
    const pageImages = await renderPdfPages(request.file.buffer);
    const pages = [];
    for (let startPage = 0; startPage < pageImages.length; startPage += maxImagesPerRequest) {
      const imageBatch = pageImages.slice(startPage, startPage + maxImagesPerRequest);
      pages.push(await requestGroqTranscription(imageBatch, startPage, model, prompt));
    }

    response.json({ transcription: pages.join("\n\n") });
  } catch (error) {
    console.error("Prescription transcription failed:", error instanceof Error ? error.message : "Unknown error");
    const message = error instanceof Error ? error.message : "Could not transcribe this PDF.";
    const status = message.startsWith("The Groq free API limit") ? 429
      : message.startsWith("Groq rejected") ? 401
        : message.startsWith("This PDF has") ? 413 : 502;
    response.status(status).json({
      error: error instanceof Error && error.name === "TimeoutError"
        ? "Groq took too long to process this PDF. Please try again."
        : message,
    });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({ error: "The PDF must be 20 MB or smaller." });
    return;
  }

  response.status(400).json({ error: error.message || "The uploaded file could not be processed." });
});

app.listen(port, () => {
  console.log(`Prescription transcription API listening on http://localhost:${port}`);
});
