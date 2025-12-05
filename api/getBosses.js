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
    try {
        const client = await getClient();
        const db = client.db("bossTracker");
        const bosses = await db.collection("bosses").find({}).toArray();

        res.status(200).json(bosses);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
