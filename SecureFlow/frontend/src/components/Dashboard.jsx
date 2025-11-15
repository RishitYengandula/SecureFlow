import { useEffect, useState } from "react";
import { fetchLogs } from "../services/api";
import { motion } from "framer-motion";

export default function Dashboard() {
  const [logs, setLogs] = useState([]);
  const [copiedMap, setCopiedMap] = useState({});

  useEffect(() => {
    let mounted = true;
    const loadLogs = async () => {
      try {
        const data = await fetchLogs();
        if (!mounted) return;
        if (Array.isArray(data)) setLogs(data);
        else if (data && data.logs) setLogs(data.logs);
        else setLogs([]);
      } catch (e) {
        console.warn('Failed to load logs', e);
      }
    };

    // initial load
    loadLogs();

    // poll for updates every 3 seconds to approximate real-time updates
    const id = setInterval(loadLogs, 3000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return (
    <motion.div
      className="p-6 bg-[#0B0B12]/95 border border-gray-800 rounded-2xl backdrop-blur-lg shadow-lg"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold text-fuchsia-400">Audit Logs</h2>
        <span className="text-xs text-gray-500 italic">
          Updated in real-time
        </span>
      </div>

      <p className="text-sm text-gray-400 mb-4">
        Encrypted summaries of recent text and file scans.
      </p>

      {/* Logs Section */}
      <div className="bg-[#11111A]/80 rounded-lg border border-gray-800 p-4 overflow-y-auto max-h-[75vh] scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
        {logs.length === 0 ? (
          <p className="text-gray-500 text-sm text-center mt-10">
            No logs available yet.
          </p>
        ) : (
          <motion.ul
            className="space-y-3"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.12 } },
            }}
          >
            {logs.map((log, index) => (
              <motion.li
                key={index}
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0 },
                }}
                className="relative border border-gray-700 rounded-lg p-3 bg-[#151521]/80 hover:border-fuchsia-500 hover:shadow-[0_0_10px_#d946ef44] transition-all duration-300"
              >
                {/* Copy button (top-right) */}
                <div className="absolute top-3 right-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const text = log.sanitized || log.sanitized_text || log.sanitizedText || "";
                      try {
                        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                          await navigator.clipboard.writeText(text);
                        } else {
                          // fallback
                          const ta = document.createElement('textarea');
                          ta.value = text;
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand('copy');
                          document.body.removeChild(ta);
                        }
                        setCopiedMap(prev => ({ ...prev, [log._id || index]: true }));
                        setTimeout(() => setCopiedMap(prev => { const copy = { ...prev }; delete copy[log._id || index]; return copy; }), 1800);
                      } catch (e) {
                        console.warn('Copy failed', e);
                      }
                    }}
                    className="text-xs px-2 py-1 rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200"
                    aria-label="Copy sanitized output"
                  >
                    Copy
                  </button>
                  {copiedMap[log._id || index] && (
                    <span className="text-xs text-emerald-400">Copied</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-1">
                  <span className="text-fuchsia-400 font-medium">Time:</span>{" "}
                  {new Date(log.createdAt).toLocaleString()}
                </p>
                {/* Severity tag computed from confidence (higher = more severe) */}
                <p className="text-xs text-gray-400 mb-1 flex items-center gap-2">
                  <span className="text-cyan-400 font-medium">Severity:</span>
                  {(() => {
                    const conf = typeof log.confidence === 'number' ? log.confidence : (typeof log.confidenceScore === 'number' ? log.confidenceScore : null);
                    let level = 'Low';
                    if (conf == null) level = 'Low';
                    else if (conf >= 0.9) level = 'Critical';
                    else if (conf >= 0.75) level = 'High';
                    else if (conf >= 0.5) level = 'Medium';
                    else level = 'Low';

                    const sevMap = {
                      Low: 'bg-emerald-600 text-white',
                      Medium: 'bg-yellow-500 text-black',
                      High: 'bg-orange-500 text-white',
                      Critical: 'bg-red-600 text-white',
                    };

                    return (
                      <span className={`text-xs px-2 py-1 rounded-md ${sevMap[level] || 'bg-gray-700 text-white'}`}>{level}</span>
                    );
                  })()}
                </p>
                <p className="text-xs text-gray-400 mb-2">
                  <span className="text-amber-400 font-medium">Entities:</span>{" "}
                  {Array.isArray(log.entities) && log.entities.length ? (
                    <span className="inline-flex flex-wrap gap-2">
                      {log.entities.map((e, i) => {
                        const key = String(e || "").toUpperCase();
                        const colorMap = {
                          EMAIL: "bg-purple-600 text-white",
                          PHONE: "bg-blue-600 text-white",
                          PASSWORD: "bg-red-600 text-white",
                          AADHAAR: "bg-yellow-400 text-black",
                          PAN: "bg-green-600 text-white",
                          PERSON: "bg-pink-600 text-white",
                          COURSE: "bg-emerald-600 text-white",
                        };
                        const cls = colorMap[key] || "bg-gray-800 text-gray-200";
                        return (
                          <span key={i} className={`text-xs px-2 py-1 rounded-md ${cls}`}>
                            {key}
                          </span>
                        );
                      })}
                    </span>
                  ) : (
                    <span>No entity data</span>
                  )}
                </p>
                <div className="text-xs text-gray-300 mt-1">
                  <strong className="text-fuchsia-400">Sanitized:</strong>
                  <div className="mt-1 text-sm text-gray-200 break-words">{log.sanitized || log.sanitized_text || log.sanitizedText || "(none)"}</div>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
    </motion.div>
  );
}
