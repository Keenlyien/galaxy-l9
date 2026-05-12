import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("MONGODB_URI environment variable is not set!");
}

let client = null;

async function getClient() {
    if (!client) {
        if (!uri) throw new Error("Database configuration missing");
        client = new MongoClient(uri);
        await client.connect();
    }
    return client;
}

export default async function handler(req, res) {
    try {
        const client = await getClient();
        const db = client.db("galaxy_l9");
        const bosses = await db.collection("bosses").find({}).toArray();

        const cleaned = bosses.map(b => ({
            name: b.name,
            level: b.level,
            location: b.location,
            respawn: b.respawn,
            last_killed: b.last_killed ?? null,
            imageData: b.imageData ?? null
        }));

        res.status(200).json(cleaned);
    } catch (err) {
        console.error("getBosses API error:", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
}
