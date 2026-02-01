// api/stream.js - Server-Sent Events for real-time boss updates
// Note: Vercel serverless functions have limitations with long-lived connections
// This is a placeholder that returns current data. For true real-time, use polling.

import { MongoClient } from "mongodb";

let client;
const uri = process.env.MONGODB_URI;

export default async function handler(req, res) {
    try {
        if (!client) {
            client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
            await client.connect();
        }

        const db = client.db("galaxy_l9");
        const collection = db.collection("bosses");

        // Return current boss data as JSON instead of SSE
        // SSE doesn't work well on Vercel serverless
        const bosses = await collection.find({}).toArray();
        
        res.status(200).json(bosses);
    } catch (err) {
        console.error("Stream error:", err);
        res.status(500).json({ error: err.message });
    }
}
