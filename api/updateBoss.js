import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
let client = null;

async function getClient() {
    if (!client) {
        client = new MongoClient(uri, {});
        await client.connect();
    }
    return client;
}

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "POST required" });
    }

    try {
        const client = await getClient();
        const db = client.db("bossTracker");

        const { bossName, status } = req.body;

        await db.collection("bosses").updateOne(
            { name: bossName },
            { $set: { status: status, updatedAt: new Date() } },
            { upsert: true }
        );

        res.status(200).json({ message: "Updated successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
