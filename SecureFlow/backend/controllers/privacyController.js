// controllers/privacyController.js

import * as pdfParse from "pdf-parse";   // <-- FIXED FOR ESM
import fs from "fs";
import { createWorker } from "tesseract.js";
import axios from "axios";
import Log from "../models/logModel.js";

// ===========================
// 🔍 1. Sensitive Data DETECTORS
// ===========================
// Each detector accepts common aliases/variants (case-insensitive)
const DETECTORS = [
  {
    type: "EMAIL",
    // Flexible email detection - handles spacing from OCR
    regex: /\b[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\s*\.\s*[A-Z]{2,}\b/gi,
  },
  {
    type: "PASSWORD",
    // capture the secret in group 1 for targeted sanitization
    // require a word-boundary after the keyword to avoid matching 'passport'
    regex: /\b(?:password|pwd|pass)\b\s*(?:is|:|=)?\s*([^\s,\.\n]+)/gi,
    regex: /\b(?:password|pass|pwd)\s*(?:is|:|=)?\s*([^\s,.\n]+)/gi,
  },
  {
    type: "PHONE",
    // 10-digit or with country code like +91 - flexible spacing for OCR
    regex: /\+?\s*91\s*[-\s]?\d{1,5}\s*[-\s]?\d{5,}|\b[6-9]\d{1,2}\s*[-\s]?\d{1,5}\s*[-\s]?\d{3,}\b/g,
  },
  {
    type: "AADHAAR",
    // 12 digits, allow spaces or dashes
    regex: /\b\d{4}\s*[-\s]?\d{4}\s*[-\s]?\d{4}\b/g,
  },
  {
    type: "PAN",
    // Indian PAN: 5 letters, 4 digits, 1 letter - stricter to avoid false positives
    regex: /\b[A-Z]{5}\d{4}[A-Z]\b/gi,
  },
  {
    type: "PASSPORT",
    // Typical passport pattern: 1 letter + 7 digits (e.g., A1234567)
    regex: /\b[A-Z]\d{7}\b/gi,
  },
  {
    type: "DRIVING_LICENSE",
    // Generic driving license pattern (state code + numbers), e.g., MH12 2020202020
    regex: /\b[A-Z]{2}\d{1,2}\s*\d{4,10}\b/gi,
  },
  {
    type: "CREDIT_CARD",
    // common 16-digit cards grouped by 4, also detect 15-digit (Amex)
    regex: /\b(?:\d{4}\s*[-\s]?){3}\d{4}\b|\b\d{15}\b/g,
  },
  {
    type: "IFSC",
    // IFSC: 4 letters, 0, 6 alphanumeric - stricter match
    regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,
  },
  {
    type: "BANK_ACCOUNT",
    // 9 to 18 digit account numbers - avoid matching short numbers
    regex: /\b\d{9,18}\b/g,
  },
  {
    type: "JWT",
    // JWT-like tokens (start with eyJ...)
    regex: /\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\b/g,
  },
  {
    type: "API_KEY",
    // common API key prefixes (Stripe, GitHub, AWS, Google)
    regex: /\b(?:sk_live_[A-Za-z0-9-_.]+|sk_test_[A-Za-z0-9-_.]+|gh[pousr]_[A-Za-z0-9_]+|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z-_]{35})\b/gi,
  },
  {
    type: "IP_ADDRESS",
    // IPv4 and a simple IPv6 matcher
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g,
  },
  {
    type: "URL",
    // HTTP/HTTPS with optional path/query
    regex: /\bhttps?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*)/gi,
  },
  {
    type: "ADDRESS",
    // simple address token detection (street/road/avenue/etc.)
    regex: /\b\d{1,4}\s+(?:street|st|road|rd|avenue|ave|block|sector|lane|apt|apartment)\b/gi,
  },
];

// ===========================
// 🔍 Run All Detectors
// ===========================
function runDetectors(text) {
  let results = [];

  // Track consumed character ranges to prevent overlapping matches
  const consumed = [];

  function isOverlapping(start, end) {
    for (const r of consumed) {
      if (Math.max(r.start, start) < Math.min(r.end, end)) return true;
    }
    return false;
  }

  for (const detector of DETECTORS) {
    const re = detector.regex;
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const matched = match[0];
      const start = match.index;
      const end = start + matched.length;

      // skip if this range overlaps a previously consumed match
      if (isOverlapping(start, end)) continue;

      results.push({
        type: detector.type,
        value: matched,
        secret: match[1] || null,
        range: { start, end },
      });

      // mark range as consumed
      consumed.push({ start, end });
    }
  }

  return results;
}

// ===========================
// 🧹 OCR Text Cleaner
// ===========================
function cleanOCRText(text) {
  if (!text || typeof text !== 'string') return '';
  let t = text;

  // Normalize newlines and remove zero-width chars
  t = t.replace(/\r?\n+/g, ' ');
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Fix common OCR spacing around @ and . within tokens (emails, domains)
  t = t.replace(/([A-Za-z0-9._%+-])\s*@\s*([A-Za-z0-9._%+-])/g, '$1@$2');
  t = t.replace(/([A-Za-z0-9._%+-])\s*\.\s*([A-Za-z0-9._%+-])/g, '$1.$2');
  // Also collapse dot spacing inside tokens like JWT and dotted tokens
  t = t.replace(/([A-Za-z0-9_-])\s*\.\s*([A-Za-z0-9_-])/g, '$1.$2');

  // Compress digit groups separated by spaces/dashes when they form long numbers (phones, cards, account nos)
  t = t.replace(/((?:\d[\s-]?){9,})/g, (m) => m.replace(/[\s-]/g, ''));

  // Remove repeated spaces
  t = t.replace(/\s{2,}/g, ' ');

  return t.trim();
}

// ===========================
// 🔗 Map cleaned-text matches back to original text indices
// ===========================
function mapMatchesToOriginal(matches, cleanedText, originalText) {
  // matches: array of { type, value, secret, range }
  const mapped = [];
  let searchCursor = 0;

  const normalize = (s) => (s || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  const orig = normalize(originalText);
  const clean = normalize(cleanedText);

  for (const m of matches) {
    const val = (m.value || '').trim();
    if (!val) continue;

    // Try to find the value in the original text starting from last cursor
    let idx = orig.indexOf(val, searchCursor);

    // If not found, try with collapsed whitespace
    if (idx === -1) {
      const collapsed = val.replace(/\s+/g, '');
      idx = orig.indexOf(collapsed, searchCursor);
    }

    // Case-insensitive fallback
    if (idx === -1) {
      idx = orig.toLowerCase().indexOf(val.toLowerCase(), searchCursor);
    }

    // As a last resort, attempt to find by looking around the approximate position
    if (idx === -1 && m.range && typeof m.range.start === 'number') {
      // estimate position ratio in cleaned text and map to original
      try {
        const ratio = m.range.start / Math.max(1, clean.length);
        const guess = Math.floor(ratio * orig.length);
        idx = orig.indexOf(val, Math.max(0, guess - 50));
      } catch (e) {
        idx = -1;
      }
    }

    if (idx !== -1) {
      const start = idx;
      const end = idx + val.length;
      mapped.push({ ...m, range: { start, end }, value: originalText.substring(start, end) });
      searchCursor = end; // move cursor forward to avoid rematching same occurrence
    } else {
      // couldn't map; skip mapping but still include original cleaned ranges as best-effort
      mapped.push(m);
    }
  }

  return mapped;
}

// ===========================
// 🧼 Sanitize Text
// ===========================
function sanitizeText(text, findings, mlEntities = []) {
  // Map ML entity labels to display names
  const mlLabelMap = {
    PERSON: "PERSON",
    LOCATION: "LOCATION",
    GPE: "LOCATION",
    LOC: "LOCATION",
    ORG: "ORG",
    DATE: "DATE",
    MONEY: "MONEY",
    CARDINAL: "CARDINAL",
  };

  const spans = [];

  // Add regex-detected spans (use ranges provided by runDetectors)
  for (const f of findings) {
    if (f.range && typeof f.range.start === 'number' && typeof f.range.end === 'number') {
      // Preserve certain prefixes (e.g., +91- for phones)
      const orig = text.substring(f.range.start, f.range.end);
      if (f.type === 'PHONE') {
        const m = orig.match(/^(\+\d{1,3}[-\s]?)/);
        if (m) {
          const prefixLen = m[1].length;
          // keep prefix in text, replace only the numeric portion
          const placeholder = `[${f.type}]`;
          spans.push({ start: f.range.start + prefixLen, end: f.range.end, placeholder, priority: 2 });
          continue;
        }
      }

      const placeholder = `[${f.type}]`;
      spans.push({ start: f.range.start, end: f.range.end, placeholder, priority: 2 });
    }
  }

  // Add ML-detected spans with squared bracket format
  for (const e of mlEntities) {
    if (typeof e.start === 'number' && typeof e.end === 'number') {
      let start = e.start;
      let end = e.end;
      // Use mapped label or fallback to uppercase label
      const displayLabel = mlLabelMap[e.label] || e.label.toUpperCase();
      const placeholder = `[${displayLabel}]`;

      // If MONEY, also consume a single currency symbol immediately preceding the span (e.g. $)
      if (e.label === 'MONEY' && start > 0) {
        const before = text.charAt(start - 1);
        if (/[$€£₹¥]/.test(before)) {
          start = start - 1;
        }
      }

      spans.push({ start, end, placeholder, priority: 1 });
    }
  }

  // If no spans, return original text
  if (spans.length === 0) return text;

  // Sort spans by start asc, then priority desc (regex higher priority)
  spans.sort((a, b) => a.start - b.start || b.priority - a.priority);

  // Resolve overlaps: keep highest priority, skip overlapping lower-priority spans
  const resolved = [];
  for (const s of spans) {
    if (resolved.length === 0) {
      resolved.push(s);
      continue;
    }
    
    const last = resolved[resolved.length - 1];
    
    // If current span starts after last one ends, no overlap - add it
    if (s.start >= last.end) {
      resolved.push(s);
    } else {
      // There's an overlap
      // Keep the one with higher priority, or if same priority, keep the longer one
      if (s.priority > last.priority) {
        resolved[resolved.length - 1] = s;
      } else if (s.priority === last.priority && (s.end - s.start) > (last.end - last.start)) {
        resolved[resolved.length - 1] = s;
      }
      // Otherwise skip current span (keep last one)
    }
  }

  // Build sanitized string from original text using resolved spans
  let out = "";
  let pos = 0;
  for (const s of resolved) {
    if (pos < s.start) out += text.substring(pos, s.start);
    out += s.placeholder;
    pos = s.end;
  }
  if (pos < text.length) out += text.substring(pos);

  return out;
}

// ===========================
// ⚖️ Confidence Scoring Helpers
// ===========================
function scoreForType(type, value) {
  // Base confidences per detector type
  const base = {
    EMAIL: 0.95,
    PASSWORD: 0.92,
    PHONE: 0.9,
    AADHAAR: 0.96,
    PAN: 0.92,
    PASSPORT: 0.9,
    DRIVING_LICENSE: 0.85,
    CREDIT_CARD: 0.9,
    IFSC: 0.9,
    BANK_ACCOUNT: 0.7,
    JWT: 0.85,
    API_KEY: 0.88,
    IP_ADDRESS: 0.85,
    URL: 0.9,
    ADDRESS: 0.6,
  };

  let score = base[type] ?? 0.5;

  // small heuristics adjustments
  if (type === "PASSWORD" && value) {
    // longer secrets -> slightly higher confidence
    const len = (value || "").length;
    if (len >= 12) score = Math.min(1, score + 0.03);
    else if (len < 6) score = Math.max(0.5, score - 0.05);
  }

  if (type === "BANK_ACCOUNT") {
    // Bank account numbers are ambiguous; shorter ones should be lower confidence
    const len = (value || "").replace(/\D/g, "").length;
    if (len >= 12) score = 0.85;
    else if (len >= 9) score = 0.72;
    else score = 0.6;
  }

  if (type === "PHONE") {
    // ensure starts with valid digit for our pattern
    if (/^[6-9]\d{9}$/.test(value.replace(/[^0-9]/g, ""))) score = 0.92;
  }

  // clamp
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function computeConfidenceMap(findings) {
  const byType = {};
  for (const f of findings) {
    const valForScoring = f.secret || f.value;
    const s = scoreForType(f.type, valForScoring);
    if (!byType[f.type]) byType[f.type] = { total: 0, count: 0 };
    byType[f.type].total += s;
    byType[f.type].count += 1;
  }

  const map = {};
  for (const t of Object.keys(byType)) {
    map[t] = Number((byType[t].total / byType[t].count).toFixed(2));
  }
  return map;
}

// ===========================
// 🧠 Fetch ML NER Entities
// ===========================
async function fetchMLNER(text) {
  try {
    const response = await axios.post("http://127.0.0.1:8000/ner", {
      text,
    }, { timeout: 5000 });
    return response.data || [];
  } catch (error) {
    console.warn("⚠️  ML NER service unavailable:", error.message);
    return [];
  }
}

// ===========================
// 📌 1. Analyze Text
// ===========================
export const analyzeText = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) return res.status(400).json({ error: "Text required" });

    // Run detectors locally
    const findings = runDetectors(text);
    
    // Fetch ML NER entities
    const mlEntities = await fetchMLNER(text);

    const sanitized = sanitizeText(text, findings, mlEntities);
    const entityTypes = [...new Set(findings.map((f) => f.type))]; // Unique regex entities
    const mlEntityTypes = [...new Set(mlEntities.map((e) => e.label))]; // Unique ML entities

    // Compute confidence map and overall label
    const confidenceMap = computeConfidenceMap(findings);
    const avgConfidence = Object.keys(confidenceMap).length
      ? Object.values(confidenceMap).reduce((a, b) => a + b, 0) / Object.keys(confidenceMap).length
      : 0;
    const avgRounded = Number(avgConfidence.toFixed(2));

    // Store log with numeric confidence score and map
    const log = await Log.create({
      username: req.user?.username || "guest",
      entities: entityTypes,
      sanitized,
      confidence: avgRounded,
      confidenceMap,
      originalText: text.slice(0, 2000),
    });

    res.json({
      ok: true,
      entities: entityTypes,
      mlEntities: mlEntityTypes,
      regexEntities: entityTypes,
      allEntities: [...new Set([...entityTypes, ...mlEntityTypes])],
      findings: findings.map((f) => ({ ...f, source: "regex" })),
      mlFindings: mlEntities.map((e) => ({ ...e, source: "ml" })),
      entityCount: findings.length,
      sanitized: sanitized,
      confidenceScore: avgRounded,
      confidenceMap,
      logId: log._id,
    });

  } catch (error) {
    console.error("❌ Analyze error:", error.message);
    res.status(500).json({ error: "Failed to analyze text" });
  }
};

// ===========================
// 📌 2. Fetch Logs
// ===========================
export const fetchLogs = async (req, res) => {
  try {
    const username = req.user?.username || "guest";
    const logs = await Log.find({ username }).sort({ createdAt: -1 }).limit(10);

    return res.status(200).json(logs);
  } catch (err) {
    console.error("❌ Fetch logs error:", err);
    return res.status(500).json({ error: "Could not fetch logs" });
  }
};

// ===========================
// 📌 3. Upload and Analyze PDF
// ===========================
export const uploadFile = async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const file = req.files.file;

    // Allow only PDF for now
    if (file.mimetype !== "application/pdf") {
      return res.status(400).json({ message: "Only PDF files are supported" });
    }

    const dataBuffer = fs.readFileSync(file.tempFilePath);
    const pdfData = await pdfParse.default(dataBuffer); // <-- FIXED

    const text = pdfData.text || "";

    // Clean OCR-like artifacts in PDF text (helps OCRed PDFs)
    const cleanedText = cleanOCRText(text);

    const findings = runDetectors(cleanedText);
    
    // Fetch ML NER entities
    const mlEntities = await fetchMLNER(cleanedText);

    const sanitized = sanitizeText(cleanedText, findings, mlEntities);

    const entityTypes = [...new Set(findings.map((f) => f.type))];
    const mlEntityTypes = [...new Set(mlEntities.map((e) => e.label))];

    const confidenceMap = computeConfidenceMap(findings);
    const avgConfidence = Object.keys(confidenceMap).length
      ? Object.values(confidenceMap).reduce((a, b) => a + b, 0) / Object.keys(confidenceMap).length
      : 0;
    const avgRounded = Number(avgConfidence.toFixed(2));

    const newLog = await Log.create({
      username: req.user?.username || "guest",
      entities: entityTypes,
      sanitized,
      confidence: avgRounded,
      confidenceMap,
      originalText: text.slice(0, 2000),
    });

    return res.status(200).json({
      ok: true,
      extractedText: text,
      findings: findings.map((f) => ({ ...f, source: "regex" })),
      mlFindings: mlEntities.map((e) => ({ ...e, source: "ml" })),
      entities: entityTypes,
      mlEntities: mlEntityTypes,
      allEntities: [...new Set([...entityTypes, ...mlEntityTypes])],
      sanitized,
      confidenceScore: avgRounded,
      confidenceMap,
      logId: newLog._id,
    });
  } catch (err) {
    console.error("❌ PDF Upload error:", err);
    return res.status(500).json({ error: "Failed to process PDF file" });
  }
};

// ===========================
// 📌 4. Analyze Image (OCR)
// ===========================
export const analyzeImage = async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ message: "No image uploaded" });
    }

    const file = req.files.file;

    // Accept common image types
    if (!file.mimetype.startsWith("image/")) {
      return res.status(400).json({ message: "Only image files are supported" });
    }

    const dataBuffer = fs.readFileSync(file.tempFilePath);

    // Run Tesseract OCR
    const worker = await createWorker();
    const { data } = await worker.recognize(dataBuffer);
    await worker.terminate();

    const extractedText = data?.text || "";

    // Clean OCR text to improve regex/NER matching
    const cleanedText = cleanOCRText(extractedText);

    // Run detectors on cleaned text
    const findings = runDetectors(cleanedText);
    const mlEntities = await fetchMLNER(cleanedText);

    const sanitized = sanitizeText(cleanedText, findings, mlEntities);

    const entityTypes = [...new Set(findings.map((f) => f.type))];
    const mlEntityTypes = [...new Set(mlEntities.map((e) => e.label))];

    const confidenceMap = computeConfidenceMap(findings);
    const avgConfidence = Object.keys(confidenceMap).length
      ? Object.values(confidenceMap).reduce((a, b) => a + b, 0) / Object.keys(confidenceMap).length
      : 0;
    const avgRounded = Number(avgConfidence.toFixed(2));

    const newLog = await Log.create({
      username: req.user?.username || "guest",
      entities: entityTypes,
      sanitized,
      confidence: avgRounded,
      confidenceMap,
      originalText: extractedText.slice(0, 2000),
    });

    return res.status(200).json({
      ok: true,
      extractedText,
      findings: findings.map((f) => ({ ...f, source: "regex" })),
      mlFindings: mlEntities.map((e) => ({ ...e, source: "ml" })),
      entities: entityTypes,
      mlEntities: mlEntityTypes,
      allEntities: [...new Set([...entityTypes, ...mlEntityTypes])],
      sanitized,
      confidenceScore: avgRounded,
      confidenceMap,
      logId: newLog._id,
    });
  } catch (err) {
    console.error("❌ Image OCR error:", err);
    return res.status(500).json({ error: "Failed to process image file" });
  }
};
