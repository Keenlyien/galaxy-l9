import { MongoClient } from "mongodb";

let client;
const uri = process.env.MONGODB_URI;

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const { bossName, status } = req.body;
    if (!bossName) return res.status(400).json({ error: "Missing bossName" });

    if (!client) {
        client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
    }

    const db = client.db("galaxy_l9");
    const collection = db.collection("bosses");

    // Convert status to number or null
    const newStatus = status !== null ? Number(status) : null;

    await collection.updateOne(
        { name: bossName },
        { $set: { last_killed: newStatus } },
        { upsert: true }
    );

    res.status(200).json({ success: true });
}


