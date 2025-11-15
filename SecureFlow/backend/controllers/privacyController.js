// controllers/privacyController.js

import * as pdfParse from "pdf-parse"; // ESM-safe import
import fs from "fs";
import { createWorker } from "tesseract.js";
import axios from "axios";
import Log from "../models/logModel.js";

// ===========================
// 🔍 1. Sensitive Data DETECTORS
// ===========================
// Each detector accepts common aliases/variants (case-insensitive)
const DETECTORS = [
  { type: "EMAIL", regex: /\b[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\s*\.\s*[A-Z]{2,}\b/gi },
  { type: "PERSON", regex: /\b(?:(?:my|your|his|her|their|our)(?:'s)?(?:\s+\w+)?\s+name|my\s+friend(?:'s)?\s+name|i(?:'m|\s+am)|this\s+is|name)\s*(?:is|:)?\s*([A-Za-z][A-Za-z'.-]{0,30})\b/gi },
  { type: "COURSE", regex: /\b(?:study|studying|pursuing|doing)\s+([A-Za-z&\s]{1,40})\b/gi },
  { type: "YEAR", regex: /\b(?:19|20)\d{2}\b/g },
  { type: "PASSWORD", regex: /\b(?:password|pwd|pass)\b\s*(?:is|:|=)?\s*([^\s,\.\n]+)/gi },
  { type: "PHONE", regex: /\+?\s*91\s*[-\s]?\d{1,5}\s*[-\s]?\d{5,}|\b[6-9]\d{1,2}\s*[-\s]?\d{1,5}\s*[-\s]?\d{3,}\b/g },
  { type: "AADHAAR", regex: /\b\d{4}\s*[-\s]?\d{4}\s*[-\s]?\d{4}\b/g },
  { type: "PAN", regex: /\b[A-Z]{5}\d{4}[A-Z]\b/gi },
  { type: "PASSPORT", regex: /\b[A-Z]\d{7}\b/gi },
  { type: "DRIVING_LICENSE", regex: /\b[A-Z]{2}\d{1,2}\s*\d{4,10}\b/gi },
  { type: "CREDIT_CARD", regex: /\b(?:\d{4}\s*[-\s]?){3}\d{4}\b|\b\d{15}\b/g },
  { type: "IFSC", regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi },
  { type: "BANK_ACCOUNT", regex: /\b\d{9,18}\b/g },
  { type: "JWT", regex: /\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\b/g },
  { type: "API_KEY", regex: /\b(?:AKIA|sk_live|sk_test|AIza|SG\.|rzp_live|rzp_test|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,})[A-Za-z0-9\-_\.]{10,}\b/g },
  { type: "IP_ADDRESS", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g },
  { type: "URL", regex: /\bhttps?:\/\/[^\s/$.?#].[^\s]*\b/gi },
  { type: "ADDRESS", regex: /\b\d{1,4}\s+(?:street|st|road|rd|avenue|ave|block|sector|lane|apt|apartment)\b/gi },
];

// ===========================
// 🔍 Run All Detectors
// ===========================
function runDetectors(text) {
  let results = [];
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

      if (isOverlapping(start, end)) continue;

      results.push({
        type: detector.type,
        value: matched,
        secret: match[1] || null,
        range: { start, end },
      });

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
  t = t.replace(/\r?\n+/g, ' ');
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, '');
  t = t.replace(/([A-Za-z0-9._%+-])\s*@\s*([A-Za-z0-9._%+-])/g, '$1@$2');
  t = t.replace(/([A-Za-z0-9._%+-])\s*\.\s*([A-Za-z0-9._%+-])/g, '$1.$2');
  t = t.replace(/([A-Za-z0-9_-])\s*\.\s*([A-Za-z0-9_-])/g, '$1.$2');
  t = t.replace(/((?:\d[\s-]?){9,})/g, (m) => m.replace(/[\s-]/g, ''));
  t = t.replace(/\s{2,}/g, ' ');
  return t.trim();
}

// ===========================
// 🔗 Map cleaned-text matches back to original text indices
// ===========================
function mapMatchesToOriginal(matches, cleanedText, originalText) {
  if (!matches || matches.length === 0) return [];
  const mapped = [];
  let cursor = 0;
  const orig = originalText || '';
  for (const m of matches) {
    const search = m.value;
    const idx = orig.toLowerCase().indexOf(search.toLowerCase(), cursor);
    if (idx >= 0) {
      mapped.push({ ...m, range: { start: idx, end: idx + search.length } });
      cursor = idx + search.length;
    } else {
      mapped.push(m);
    }
  }
  return mapped;
}

// ===========================
// 🔧 Sanitization: combine regex & ML spans, heuristics
// ===========================
function sanitizeText(originalText, findings = [], mlEntities = []) {
  const text = originalText || '';
  const spans = [];

  const typeLabel = (t) => t === 'PERSON' ? 'PERSON' : t === 'COURSE' ? 'COURSE' : t;

  try {
    for (const f of findings) {
      const displayLabel = typeLabel(f.type) || f.type;
      const placeholder = `[${displayLabel}]`;
      if (f.secret) {
        const inner = f.secret.trim();
        const idx = f.value.toLowerCase().indexOf(inner.toLowerCase());
        if (idx >= 0) {
          const start = f.range.start + idx;
          const end = start + inner.length;
          spans.push({ start, end, placeholder, priority: 2 });
          continue;
        }
      }
      spans.push({ start: f.range.start, end: f.range.end, placeholder, priority: 2 });
    }

    const mlLabelMap = {};
    for (const e of mlEntities) mlLabelMap[e.label] = e.label.toUpperCase();
    for (const e of mlEntities) {
      if (typeof e.start === 'number' && typeof e.end === 'number') {
        let start = e.start; let end = e.end;
        const displayLabel = mlLabelMap[e.label] || e.label.toUpperCase();
        const placeholder = `[${displayLabel}]`;
        if (e.label === 'MONEY' && start > 0) {
          const before = text.charAt(start - 1);
          if (/[$€£₹¥]/.test(before)) start = start - 1;
        }
        spans.push({ start, end, placeholder, priority: 3 });
      }
    }

    const personHeur = /(?:my|your|his|her|their|our)(?:'s)?(?:\s+\w+)?\s+name\s*(?:is|:)?\s*([A-Za-z][A-Za-z'.-]{0,30})/gi;
    let ph;
    while ((ph = personHeur.exec(text)) !== null) {
      const secret = ph[1] && ph[1].trim(); if (!secret) continue;
      const matchStart = ph.index;
      const innerOffset = ph[0].toLowerCase().indexOf(secret.toLowerCase());
      const start = matchStart + (innerOffset >= 0 ? innerOffset : 0);
      const end = start + secret.length;
      let overlap = false;
      for (const s of spans) { if (Math.max(s.start, start) < Math.min(s.end, end)) { overlap = true; break; } }
      if (!overlap) spans.push({ start, end, placeholder: `[PERSON]`, priority: 2 });
    }

    const courseHeur = /(?:study|studying|pursuing|doing)\s+([A-Za-z&\s]{1,40})/gi;
    let ch;
    while ((ch = courseHeur.exec(text)) !== null) {
      const secret = ch[1] && ch[1].trim(); if (!secret) continue;
      const matchStart = ch.index;
      const innerOffset = ch[0].toLowerCase().indexOf(secret.toLowerCase());
      const start = matchStart + (innerOffset >= 0 ? innerOffset : 0);
      const end = start + secret.length;
      let overlap = false;
      for (const s of spans) { if (Math.max(s.start, start) < Math.min(s.end, end)) { overlap = true; break; } }
      if (!overlap) spans.push({ start, end, placeholder: `[COURSE]`, priority: 2 });
    }
  } catch (e) {}

  if (spans.length === 0) return text;
  spans.sort((a, b) => a.start - b.start || b.priority - a.priority);
  const resolved = [];
  for (const s of spans) {
    if (resolved.length === 0) { resolved.push(s); continue; }
    const last = resolved[resolved.length - 1];
    if (s.start >= last.end) resolved.push(s);
    else { if (s.priority > last.priority) resolved[resolved.length - 1] = s; else if (s.priority === last.priority && (s.end - s.start) > (last.end - last.start)) resolved[resolved.length - 1] = s; }
  }
  let out = ""; let pos = 0;
  for (const s of resolved) { if (pos < s.start) out += text.substring(pos, s.start); out += s.placeholder; pos = s.end; }
  if (pos < text.length) out += text.substring(pos);
  return out;
}

// ===========================
// ⚖️ Confidence Scoring Helpers
// ===========================

function scoreForType(type, value) {
  const base = {
    EMAIL: 0.95,
    YEAR: 0.40,
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
  if (type === "PASSWORD" && value) {
    const len = (value || "").length;
    if (len >= 12) score = Math.min(1, score + 0.03);
    else if (len < 6) score = Math.max(0.5, score - 0.05);
  }

  if (type === "BANK_ACCOUNT") {
    const len = (value || "").replace(/\D/g, "").length;
    if (len >= 12) score = 0.85;
    else if (len >= 9) score = 0.72;
    else score = 0.6;
  }

  if (type === "PHONE") {
    if (/^[6-9]\d{9}$/.test((value || '').replace(/[^0-9]/g, ''))) score = 0.92;
  }

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
  for (const t of Object.keys(byType)) map[t] = Number((byType[t].total / byType[t].count).toFixed(2));
  return map;
}

// ===========================
// 🧾 Compute Severity (server-side)
// ===========================
function computeSeverity(findings, avgScore) {
  const priority = {
    AADHAAR: 0.98,
    PAN: 0.92,
    CREDIT_CARD: 0.9,
    PASSWORD: 0.9,
    IFSC: 0.88,
    JWT: 0.85,
    API_KEY: 0.85,
  };

  let score = Number(avgScore) || 0;
  const typesPresent = new Set((findings || []).map((f) => f.type));
  for (const t of Object.keys(priority)) if (typesPresent.has(t)) score = Math.max(score, priority[t]);

  let level = 'Low';
  if (score >= 0.9) level = 'Critical';
  else if (score >= 0.75) level = 'High';
  else if (score >= 0.5) level = 'Medium';
  else level = 'Low';

  return { score: Number(score.toFixed(2)), level };
}

// ===========================
// 🧠 Fetch ML NER Entities
// ===========================
async function fetchMLNER(text) {
  try {
    const response = await axios.post("http://127.0.0.1:8000/ner", { text }, { timeout: 5000 });
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

    const findings = runDetectors(text);
    const mlEntities = await fetchMLNER(text);

    const sanitized = sanitizeText(text, findings, mlEntities);
    const entityTypes = [...new Set(findings.map((f) => f.type))];
    const mlEntityTypes = [...new Set(mlEntities.map((e) => e.label))];

    const confidenceMap = computeConfidenceMap(findings);
    const avgConfidence = Object.keys(confidenceMap).length
      ? Object.values(confidenceMap).reduce((a, b) => a + b, 0) / Object.keys(confidenceMap).length
      : 0;
    const avgRounded = Number(avgConfidence.toFixed(2));

    const sev = computeSeverity(findings, avgRounded);

    const log = await Log.create({
      username: req.user?.username || "guest",
      entities: entityTypes,
      eventType: "text_scan",
      sanitized,
      confidence: avgRounded,
      confidenceMap,
      severityScore: sev.score,
      severity: sev.level,
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
      sanitized,
      confidenceScore: avgRounded,
      confidenceMap,
      severityScore: sev.score,
      severity: sev.level,
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
    const logs = await Log.find({ username }).sort({ createdAt: -1 }).limit(50);
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
    if (!req.files || !req.files.file) return res.status(400).json({ message: "No file uploaded" });
    const file = req.files.file;
    if (file.mimetype !== "application/pdf") return res.status(400).json({ message: "Only PDF files are supported" });

    const dataBuffer = fs.readFileSync(file.tempFilePath);
    const pdfData = await pdfParse.default(dataBuffer);
    const text = pdfData.text || "";

    const cleanedText = cleanOCRText(text);
    const findings = runDetectors(cleanedText);
    const mlEntities = await fetchMLNER(cleanedText);
    const sanitized = sanitizeText(cleanedText, findings, mlEntities);

    const entityTypes = [...new Set(findings.map((f) => f.type))];
    const confidenceMap = computeConfidenceMap(findings);
    const avgConfidence = Object.keys(confidenceMap).length
      ? Object.values(confidenceMap).reduce((a, b) => a + b, 0) / Object.keys(confidenceMap).length
      : 0;
    const avgRounded = Number(avgConfidence.toFixed(2));
    const sev = computeSeverity(findings, avgRounded);

    const newLog = await Log.create({
      username: req.user?.username || "guest",
      entities: entityTypes,
      eventType: "file_scan",
      sanitized,
      confidence: avgRounded,
      confidenceMap,
      severityScore: sev.score,
      severity: sev.level,
      originalText: text.slice(0, 2000),
    });

    return res.status(200).json({
      ok: true,
      extractedText: text,
      findings: findings.map((f) => ({ ...f, source: "regex" })),
      mlFindings: mlEntities.map((e) => ({ ...e, source: "ml" })),
      entities: entityTypes,
      allEntities: [...new Set([...entityTypes, ...mlEntities.map(e => e.label)])],
      sanitized,
      confidenceScore: avgRounded,
      confidenceMap,
      severityScore: sev.score,
      severity: sev.level,
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
    if (!req.files || !req.files.file) return res.status(400).json({ message: "No image uploaded" });
    const file = req.files.file;
    if (!file.mimetype.startsWith("image/")) return res.status(400).json({ message: "Only image files are supported" });

    const dataBuffer = fs.readFileSync(file.tempFilePath);
    const worker = await createWorker();
    const { data } = await worker.recognize(dataBuffer);
    await worker.terminate();

    const extractedText = data?.text || "";
    const cleanedText = cleanOCRText(extractedText);
    const findings = runDetectors(cleanedText);
    const mlEntities = await fetchMLNER(cleanedText);
    const sanitized = sanitizeText(cleanedText, findings, mlEntities);

    const entityTypes = [...new Set(findings.map((f) => f.type))];
    const confidenceMap = computeConfidenceMap(findings);
    const avgConfidence = Object.keys(confidenceMap).length
      ? Object.values(confidenceMap).reduce((a, b) => a + b, 0) / Object.keys(confidenceMap).length
      : 0;
    const avgRounded = Number(avgConfidence.toFixed(2));
    const sev = computeSeverity(findings, avgRounded);

    const newLog = await Log.create({
      username: req.user?.username || "guest",
      entities: entityTypes,
      eventType: "file_scan",
      sanitized,
      confidence: avgRounded,
      confidenceMap,
      severityScore: sev.score,
      severity: sev.level,
      originalText: extractedText.slice(0, 2000),
    });

    return res.status(200).json({
      ok: true,
      extractedText,
      findings: findings.map((f) => ({ ...f, source: "regex" })),
      mlFindings: mlEntities.map((e) => ({ ...e, source: "ml" })),
      entities: entityTypes,
      allEntities: [...new Set([...entityTypes, ...mlEntities.map(e => e.label)])],
      sanitized,
      confidenceScore: avgRounded,
      confidenceMap,
      severityScore: sev.score,
      severity: sev.level,
      logId: newLog._id,
    });
  } catch (err) {
    console.error("❌ Image OCR error:", err);
    return res.status(500).json({ error: "Failed to process image file" });
  }
};


