import { MongoClient } from "mongodb";

let client;
const uri = process.env.MONGODB_URI;

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
    const col = db.collection("bosses");

    if (req.method === "POST") {
      const { action, boss } = req.body;
      if (!action || !boss || !boss.name) return res.status(400).json({ error: "Missing action or boss.name" });

      if (action === "create" || action === "update") {
        // Upsert by name
        const update = {
          $set: {
            name: boss.name,
            level: boss.level ?? 0,
            location: boss.location ?? "",
            respawn: boss.respawn ?? "",
          }
        };
        if (boss.imageData) update.$set.imageData = boss.imageData;

        await col.updateOne({ name: boss.name }, update, { upsert: true });
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    if (req.method === "DELETE") {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Missing name" });
      await col.deleteOne({ name });
      return res.status(200).json({ success: true });
    }

    res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
