import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("MONGODB_URI environment variable is not set!");
}

let client;

async function getClient() {
  if (!client) {
    if (!uri) throw new Error("Database configuration missing");
    client = new MongoClient(uri);
    await client.connect();
  }
  return client;
}

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const { bossName, status } = req.body;
    if (!bossName) return res.status(400).json({ error: "Missing bossName" });

    try {
        const client = await getClient();
        const db = client.db("galaxy_l9");
        const collection = db.collection("bosses");

        const newStatus = status !== null ? Number(status) : null;

        await collection.updateOne(
            { name: bossName },
            { $set: { last_killed: newStatus } },
            { upsert: true }
        );

        res.status(200).json({ success: true });
    } catch (err) {
        console.error("updateBoss API error:", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
}


