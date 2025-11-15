import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import { analyzeText, fetchLogs, uploadFile, analyzeImage } from "../controllers/privacyController.js";

const router = express.Router();

// Protected routes
router.post("/analyze", verifyToken, analyzeText);
router.get("/logs", verifyToken, fetchLogs);
router.post("/upload", verifyToken, uploadFile);
router.post("/analyze-image", verifyToken, analyzeImage);

export default router;
