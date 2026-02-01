import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname)));

// Import API routes
import getBossesHandler from "./api/getBosses.js";
import updateBossHandler from "./api/updateBoss.js";
import manageBossHandler from "./api/manageBoss.js";
import streamHandler from "./api/stream.js";

// API Routes
app.get("/api/getBosses", (req, res) => getBossesHandler(req, res));
app.post("/api/updateBoss", (req, res) => updateBossHandler(req, res));
app.post("/api/manageBoss", (req, res) => manageBossHandler(req, res));
app.delete("/api/manageBoss", (req, res) => manageBossHandler(req, res));
app.get("/api/stream", (req, res) => streamHandler(req, res));

// HTML Routes (remove .html from URLs)
app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/participation", (req, res) => {
    res.sendFile(path.join(__dirname, "participation.html"));
});

app.get("/view-only", (req, res) => {
    res.sendFile(path.join(__dirname, "view-only.html"));
});

// Root
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Catch all - serve index.html for SPA routing
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
