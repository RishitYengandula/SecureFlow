import mongoose from "mongoose";

const logSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    entities: { type: [String], default: [] },
    sanitized: { type: String, default: "" },
    // numeric overall confidence score (0.00 - 1.00)
    confidence: { type: Number, default: 0 },
    // per-entity numeric confidence scores (e.g. { EMAIL: 0.92 })
    confidenceMap: { type: mongoose.Schema.Types.Mixed, default: {} },
    originalText: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const Log = mongoose.model("Log", logSchema);
export default Log;
