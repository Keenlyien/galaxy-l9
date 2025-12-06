import { MongoClient, ObjectId } from "mongodb";

let client;
const uri = process.env.MONGODB_URI;

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: "Missing id or status" });

    if (!client) {
        client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
    }

    const db = client.db("galaxy_l9");
    const collection = db.collection("bosses");

    await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
    );

    res.status(200).json({ success: true });
}
