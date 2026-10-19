import { ChangeEvent, DragEvent, useRef, useState } from "react";

type TranscriptionResponse = {
  transcription?: string;
  error?: string;
};

const maxFileSize = 20 * 1024 * 1024;

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [transcription, setTranscription] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);

  function chooseFile(selectedFile?: File) {
    if (!selectedFile) return;
    setError("");
    setTranscription("");
    setCopied(false);

    if (selectedFile.type !== "application/pdf" || !selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setFile(null);
      setError("That file isn't a PDF. Please choose a prescription saved as a PDF.");
      return;
    }
    if (selectedFile.size > maxFileSize) {
      setFile(null);
      setError("This PDF is larger than 20 MB. Please choose a smaller file.");
      return;
    }
    setFile(selectedFile);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  async function transcribe() {
    if (!file) return;
    setIsLoading(true);
    setError("");
    setTranscription("");

    const formData = new FormData();
    formData.append("prescription", file);

    try {
      const response = await fetch("/api/transcribe", { method: "POST", body: formData });
      const responseText = await response.text();
      let result: TranscriptionResponse;
      try {
        result = JSON.parse(responseText) as TranscriptionResponse;
      } catch {
        throw new Error(
          response.ok
            ? "The transcription API returned an invalid response. Restart the app and try again."
            : `The transcription API returned an unexpected response (HTTP ${response.status}). Make sure the API server is running.`,
        );
      }
      if (!response.ok) throw new Error(result.error || "Transcription failed. Please try again.");
      if (!result.transcription) throw new Error("No text was returned. Please try a clearer PDF.");
      setTranscription(result.transcription);
    } catch (caughtError) {
      setError(
        caughtError instanceof TypeError
          ? "Could not connect to the transcription API. Make sure the app is running with npm run dev, then try again."
          : caughtError instanceof Error
            ? caughtError.message
            : "Something went wrong. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function copyTranscription() {
    await navigator.clipboard.writeText(transcription);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function downloadTranscription() {
    const blob = new Blob([transcription], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file?.name.replace(/\.pdf$/i, "") || "prescription"}-transcription.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ScriptCare home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M16 6v20M6 16h20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
          <span>script<span className="brand-light">care</span></span>
        </a>
        <div className="topbar-note"><span className="status-dot" /> API key stays server-side</div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-line" /> PRESCRIPTION TRANSCRIPTION</div>
        <h1>Make every note<br />a little <em>clearer.</em></h1>
        <p className="hero-copy">
          Upload a prescription PDF and get a careful text transcription.
          Anything hard to read is marked for review, never guessed.
        </p>
      </section>

      <section className="workspace" aria-label="Prescription transcription">
        <div className="upload-card">
          <div className="card-heading">
            <span className="step-number">01</span>
            <div>
              <h2>Upload prescription</h2>
              <p>Choose a PDF from your device</p>
            </div>
          </div>

          <div
            className={`dropzone${isDragging ? " dropzone-active" : ""}${file ? " dropzone-has-file" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              aria-label="Choose a prescription PDF"
            />
            {file ? (
              <div className="selected-file">
                <span className="file-icon" aria-hidden="true">PDF</span>
                <div className="file-info">
                  <strong title={file.name}>{file.name}</strong>
                  <span>{(file.size / (1024 * 1024)).toFixed(2)} MB · Ready to transcribe</span>
                </div>
                <button className="remove-file" type="button" onClick={() => { setFile(null); setTranscription(""); setError(""); }} aria-label="Remove selected file">×</button>
              </div>
            ) : (
              <>
                <div className="upload-icon" aria-hidden="true">
                  <svg viewBox="0 0 40 40" fill="none">
                    <path d="M20 26V9m0 0-6 6m6-6 6 6M9 25v6a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <strong>Drop your PDF here</strong>
                <span className="dropzone-or">or</span>
                <button className="browse-button" type="button" onClick={() => inputRef.current?.click()}>Browse files</button>
                <span className="file-hint">PDF only · Max 20 MB</span>
              </>
            )}
          </div>

          {error && <p className="error-message" role="alert">{error}</p>}

          <button className="transcribe-button" type="button" onClick={transcribe} disabled={!file || isLoading}>
            {isLoading ? (
              <><span className="spinner" /> Reading prescription…</>
            ) : (
              <>Transcribe prescription <span aria-hidden="true">→</span></>
            )}
          </button>
          <p className="upload-note"><span aria-hidden="true">⌑</span> Your file is not stored by this app; page images are sent to Groq.</p>
        </div>

        <div className="result-card">
          <div className="card-heading result-heading">
            <span className="step-number">02</span>
            <div>
              <h2>Your transcription</h2>
              <p>Text found in your prescription</p>
            </div>
          </div>
          {transcription ? (
            <div className="transcription-result">
              <div className="result-toolbar">
                <span className="result-label"><span className="result-dot" /> TRANSCRIPTION READY</span>
                <div className="result-actions">
                  <button type="button" onClick={copyTranscription}>{copied ? "Copied!" : "Copy text"}</button>
                  <button type="button" onClick={downloadTranscription}>Download</button>
                </div>
              </div>
              <pre className="transcription-text">{transcription}</pre>
              {transcription.includes("[unclear]") && (
                <p className="unclear-note"><span aria-hidden="true">ⓘ</span> Some text was difficult to read. Please confirm it with the prescribing doctor.</p>
              )}
            </div>
          ) : (
            <div className="empty-result">
              <div className="paper-illustration" aria-hidden="true">
                <div className="paper-fold" />
                <span className="paper-line paper-line-short" />
                <span className="paper-line" />
                <span className="paper-line paper-line-medium" />
                <span className="paper-line paper-line-short" />
                <span className="paper-check">✳</span>
              </div>
              <strong>Your text will appear here</strong>
              <p>Upload a prescription PDF to get started.</p>
            </div>
          )}
        </div>
      </section>

      <aside className="safety-banner">
        <span className="safety-icon" aria-hidden="true">i</span>
        <p><strong>For transcription only.</strong> This tool may make mistakes and does not provide medical advice. Always verify medicines and dosages with your doctor or pharmacist before acting.</p>
      </aside>

      <footer className="footer">
        <span>ScriptCare <span className="footer-separator">/</span> A clearer read, not a second opinion.</span>
        <span>AI-assisted transcription</span>
      </footer>
    </main>
  );
}

export default App;
