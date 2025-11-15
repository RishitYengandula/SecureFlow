import { useState } from "react";
import { analyzeText, uploadFile, uploadImage } from "../services/api";

export default function PrivacyAnalyzer() {
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

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
    setLoading(false);
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
        <div className="mt-5 bg-[#151521] p-4 rounded-lg border border-gray-700">
          {/* Regex-detected entities */}
          <p className="text-sm text-gray-300">
            <strong className="text-fuchsia-400">🔍 Regex Detections:</strong>{" "}
            {(() => {
              if (result.entities && Array.isArray(result.entities)) {
                return result.entities.length ? result.entities.join(", ") : "None";
              }
              if (result.findings && Array.isArray(result.findings)) {
                const types = [...new Set(result.findings.map((f) => f.type))];
                return types.length ? types.join(", ") : "None";
              }
              return "None";
            })()}
          </p>

          {/* ML-detected entities */}
          {result.mlEntities && result.mlEntities.length > 0 && (
            <p className="text-sm text-gray-300 mt-2">
              <strong className="text-cyan-400">🧠 ML Detections:</strong>{" "}
              {result.mlEntities.join(", ")}
            </p>
          )}

          {/* All unique entities combined */}
          {result.allEntities && result.allEntities.length > 0 && (
            <p className="text-sm text-gray-300 mt-2">
              <strong className="text-purple-400">✨ Combined Entities:</strong>{" "}
              {result.allEntities.join(", ")}
            </p>
          )}

          <p className="text-sm text-gray-300 mt-2">
            <strong className="text-fuchsia-400">Sanitized Output:</strong>{" "}
            {result.sanitized || result.sanitized_text || result.sanitizedText || "N/A"}
          </p>
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
