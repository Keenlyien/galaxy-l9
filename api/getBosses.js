import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
let client = null;

async function getClient() {
    if (!client) {
        client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
    }
    return client;
}

export default async function handler(req, res) {
    try {
        const client = await getClient();
        const db = client.db("galaxy_l9");
        const bosses = await db.collection("bosses").find({}).toArray();

        // Ensure we return last_killed (number) or null
        const cleaned = bosses.map(b => ({
            name: b.name,
            level: b.level,
            location: b.location,
            respawn: b.respawn,
            last_killed: b.last_killed ?? null
        }));

        res.status(200).json(cleaned);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
