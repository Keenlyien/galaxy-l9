import { MongoClient } from "mongodb";

let client;
const uri = process.env.MONGODB_URI;

export default async function handler(req, res) {
  // Only accept POST and require auth header
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  const authHeader = req.headers["authorization"];
  const expectedToken = process.env.ADMIN_TOKEN || "admin-secret";
  
  if (authHeader !== `Bearer ${expectedToken}`) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    if (!client) {
      client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
      await client.connect();
    }

    const db = client.db("galaxy_l9");
    const col = db.collection("bosses");
    
    const result = await col.deleteMany({});
    res.status(200).json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
