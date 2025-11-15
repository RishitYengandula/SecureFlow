import { useState } from "react";
import { analyzeText, uploadFile, uploadImage } from "../services/api";

export default function PrivacyAnalyzer() {
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState(null);

  // derived sanitized text for copy/display
  const sanitizedText = result
    ? result.sanitized || result.sanitized_text || result.sanitizedText || "N/A"
    : "N/A";

  // Map entity types to Tailwind color classes and border/ring styles
  const entityColorMap = {
    EMAIL: "bg-purple-600 text-white",
    PERSON: "bg-pink-600 text-white",
    COURSE: "bg-emerald-600 text-white",
    PHONE: "bg-blue-600 text-white",
    PASSWORD: "bg-red-600 text-white",
    AADHAAR: "bg-yellow-400 text-black",
    PAN: "bg-green-600 text-white",
    LOCATION: "bg-cyan-600 text-white",
    DATE: "bg-indigo-500 text-white",
    DEFAULT: "bg-gray-700 text-white",
  };

  const entityBorderMap = {
    EMAIL: "border-purple-700",
    PERSON: "border-pink-700",
    COURSE: "border-emerald-700",
    PHONE: "border-blue-700",
    PASSWORD: "border-red-700",
    AADHAAR: "border-yellow-500",
    PAN: "border-green-700",
    LOCATION: "border-cyan-700",
    DATE: "border-indigo-700",
    DEFAULT: "border-gray-600",
  };

  const entityRingMap = {
    EMAIL: "ring-purple-400",
    PERSON: "ring-pink-300",
    COURSE: "ring-emerald-300",
    PHONE: "ring-blue-400",
    PASSWORD: "ring-red-400",
    AADHAAR: "ring-yellow-300",
    PAN: "ring-green-400",
    LOCATION: "ring-cyan-300",
    DATE: "ring-indigo-300",
    DEFAULT: "ring-white/20",
  };

  const renderBadges = (items) => {
    if (!items || !Array.isArray(items) || items.length === 0) return <span>None</span>;

    // Determine whether items are raw strings (unique types) or findings objects
    // Findings objects: regex findings have { type, value, ... }, ML findings have { label, start, end }
    const counts = {};
    const sample = items[0];

    if (typeof sample === "string") {
      // items are already unique type strings -> count unavailable
      for (const s of items) {
        const key = String(s || "").toUpperCase();
        counts[key] = (counts[key] || 0) + 0; // leave as 0 to indicate unknown count
      }
    } else if (typeof sample === "object") {
      for (const it of items) {
        if (!it) continue;
        const key = (it.type || it.label || it).toString().toUpperCase();
        counts[key] = (counts[key] || 0) + 1;
      }
    }

    // Friendly label map
    const friendly = {
      EMAIL: "Email",
      PHONE: "Phone",
      PASSWORD: "Password",
      AADHAAR: "Aadhaar",
      PAN: "PAN",
      PERSON: "Person",
      COURSE: "Course",
      LOCATION: "Location",
      DATE: "Date",
      DEFAULT: "Other",
    };

    const keys = Object.keys(counts);

    return (
      <div className="flex flex-wrap gap-2">
        {keys.map((key, idx) => {
          const bg = entityColorMap[key] || entityColorMap.DEFAULT;
          const border = entityBorderMap[key] || entityBorderMap.DEFAULT;
          const ring = entityRingMap[key] || entityRingMap.DEFAULT;
          const active = selectedEntity === key;
          const display = friendly[key] || key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
          const count = counts[key];

          return (
            <button
              key={`${key}-${idx}`}
              onClick={() => setSelectedEntity((s) => (s === key ? null : key))}
              className={`flex items-center gap-2 text-xs px-3 py-1 rounded-md ${bg} ${border} border text-left transition transform ${active ? `scale-105 shadow-lg ring-2 ring-offset-1 ${ring}` : "hover:scale-105"}`}
              title={`Filter/highlight ${display}`}
            >
              <span className={`w-2 h-2 rounded-full ${bg} ${border}`} aria-hidden="true" />
              <span className="font-semibold">{display}{count > 0 ? ` (${count})` : ""}</span>
            </button>
          );
        })}
      </div>
    );
  };

  // Render sanitized text and highlight bracketed entity tokens when a badge is selected
  const renderSanitizedText = (text) => {
    if (!text || text === "N/A") return <span className="text-gray-400">N/A</span>;

    const parts = [];
    const re = /\[([^\]]+)\]/g;
    let lastIndex = 0;
    let m;
    let idx = 0;

    while ((m = re.exec(text)) !== null) {
      const before = text.slice(lastIndex, m.index);
      if (before) parts.push(<span key={`t-${idx++}`}>{before}</span>);

      const token = m[1];
      const key = String(token).toUpperCase();
      const isActive = selectedEntity === key;
      const ring = entityRingMap[key] || entityRingMap.DEFAULT;
      parts.push(
        <span
          key={`tok-${idx++}`}
          className={`px-1 rounded ${isActive ? `ring-2 ring-offset-1 ${ring} bg-white/5` : "bg-white/3 text-gray-100"}`}
        >
          [{token}]
        </span>
      );

      lastIndex = re.lastIndex;
    }

    const tail = text.slice(lastIndex);
    if (tail) parts.push(<span key={`t-${idx++}`}>{tail}</span>);

    return <div className="mt-2 text-gray-200 break-words">{parts}</div>;
  };

  // 🧩 Handle file selection and preview
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);

    if (selectedFile && selectedFile.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result);
      reader.readAsDataURL(selectedFile);
    } else {
      setPreview(null); // PDFs will just show file info
    }
  };

  // 🚀 Analyze either text or uploaded file
  const handleAnalyze = async () => {
    if (!text && !file) return alert("Please enter text or upload a file.");
    setLoading(true);
    setResult(null);

    let data;
    if (file) {
      // Use OCR endpoint for images, PDF endpoint for PDFs
      data = file.type.startsWith("image/") ? await uploadImage(file) : await uploadFile(file);
    } else {
      data = await analyzeText(text);
    }

    setResult(data);
    setResult(data);
    setSelectedEntity(null);
    setLoading(false);
  };

  // Copy sanitized output to clipboard with small UI feedback
  const handleCopy = async () => {
    if (!sanitizedText || sanitizedText === "N/A") return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(sanitizedText);
      } else {
        const el = document.createElement("textarea");
        el.value = sanitizedText;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed", err);
      alert("Unable to copy to clipboard");
    }
  };

  return (
    <div className="p-6 bg-[#0B0B12]/95 border border-gray-800 rounded-2xl backdrop-blur-lg shadow-lg text-gray-200">
      <h2 className="text-xl font-semibold text-fuchsia-400 mb-2">
        Privacy Analyzer
      </h2>
      <p className="text-sm text-gray-400 mb-4">
        Paste text or upload a file to detect sensitive data.
      </p>

      {/* 📝 Text Area */}
      <textarea
        placeholder="Enter or paste text here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full h-32 p-3 rounded-md bg-[#1A1A24] border border-gray-700 text-gray-200 mb-3 outline-none resize-none"
      ></textarea>

      {/* 📂 File Upload */}
      <div className="flex flex-col items-center border-2 border-dashed border-gray-700 rounded-lg p-4 mb-3 bg-[#11111A] hover:border-fuchsia-500 transition-all">
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileChange}
          className="hidden"
          id="fileUpload"
        />
        <label
          htmlFor="fileUpload"
          className="cursor-pointer text-fuchsia-400 font-medium hover:underline"
        >
          Click to upload PDF or image
        </label>

        {file && (
          <div className="mt-3 text-center">
            {preview ? (
              <img
                src={preview}
                alt="Preview"
                className="max-h-48 rounded-lg border border-gray-600 shadow-md"
              />
            ) : (
              <p className="text-sm text-gray-400">
                📄 {file.name} ({Math.round(file.size / 1024)} KB)
              </p>
            )}
          </div>
        )}
      </div>

      {/* 🚀 Analyze Button */}
      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="w-full py-2 rounded-md bg-gradient-to-r from-fuchsia-600 via-purple-500 to-cyan-500 hover:opacity-90 transition-all duration-300 font-semibold"
      >
        {loading ? "Analyzing..." : file ? "Analyze File" : "Analyze Text"}
      </button>

      {/* 🧠 Result Section */}
      {result && (
        <div className="mt-5 bg-[#151521] p-4 rounded-lg border border-gray-700 relative">
          <button
            onClick={handleCopy}
            disabled={sanitizedText === "N/A"}
            className="absolute right-3 top-3 bg-gray-800 text-sm px-3 py-1 rounded-md hover:bg-gray-700 transition"
            aria-label="Copy sanitized output"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          {/* Regex-detected entities */}
          <div className="text-sm text-gray-300">
            <strong className="text-fuchsia-400">🔍 Regex Detections:</strong>
            <div className="mt-2">
              {(() => {
                // Prefer detailed findings (objects) to compute counts. Fallback to entity lists.
                if (result.findings && Array.isArray(result.findings) && result.findings.length) {
                  return renderBadges(result.findings);
                }
                if (result.entities && Array.isArray(result.entities) && result.entities.length) {
                  return renderBadges(result.entities);
                }
                return <span className="ml-2">None</span>;
              })()}
            </div>
          </div>

          {/* ML-detected entities */}
          {result.mlEntities && result.mlEntities.length > 0 && (
            <div className="text-sm text-gray-300 mt-2">
              <strong className="text-cyan-400">🧠 ML Detections:</strong>
                <div className="mt-2">{renderBadges((result.mlFindings && result.mlFindings.length) ? result.mlFindings : result.mlEntities)}</div>
            </div>
          )}

          {/* All unique entities combined */}
          {result.allEntities && result.allEntities.length > 0 && (
            <div className="text-sm text-gray-300 mt-2">
              <strong className="text-purple-400">✨ Combined Entities:</strong>
              <div className="mt-2">{(() => {
                const combined = [...(result.findings || []), ...(result.mlFindings || [])];
                if (combined.length) return renderBadges(combined);
                return renderBadges(result.allEntities || []);
              })()}</div>
            </div>
          )}

          <div className="text-sm text-gray-300 mt-2">
            <strong className="text-fuchsia-400">Sanitized Output:</strong>
            {renderSanitizedText(sanitizedText)}
          </div>
          {(() => {
            // overall numeric score returned by backend as `confidenceScore`
            const overall =
              typeof result.confidenceScore === "number"
                ? result.confidenceScore
                : typeof result.confidence === "number"
                ? result.confidence
                : null;

            // per-entity confidence map
            const conf = result.confidenceMap || (result.confidence && typeof result.confidence === 'object' ? result.confidence : null);

            if (!overall && (!conf || Object.keys(conf).length === 0)) return null;

            return (
              <div className="mt-2">
                <p className="text-sm text-gray-300 flex items-center gap-2">
                  <strong className="text-fuchsia-400">Confidence:</strong>
                  {overall != null && (
                    <span className="text-sm text-gray-200">{Math.round(Number(overall) * 100)}%</span>
                  )}
                </p>

                {conf && Object.keys(conf).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {Object.entries(conf).map(([k, v]) => (
                      <span
                        key={k}
                        className="text-xs px-2 py-1 bg-gray-800 rounded-md text-gray-200"
                        title={`Confidence for ${k}`}
                      >
                        {k}: {Math.round(Number(v) * 100)}%
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
