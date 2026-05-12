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
    try {
        const client = await getClient();
        const db = client.db("galaxy_l9");
        const collection = db.collection("bosses");

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });

        const raw = await collection.find({}).toArray();
        const bosses = raw.map(b => ({
            name: b.name,
            level: b.level,
            location: b.location,
            respawn: b.respawn,
            last_killed: b.last_killed ?? null,
            imageData: b.imageData ?? null
        }));
        res.write(`data: ${JSON.stringify(bosses)}\n\n`);

        const changeStream = collection.watch();
        changeStream.on("change", async () => {
            const raw2 = await collection.find({}).toArray();
            const updated = raw2.map(b => ({
                name: b.name,
                level: b.level,
                location: b.location,
                respawn: b.respawn,
                last_killed: b.last_killed ?? null,
                imageData: b.imageData ?? null
            }));
            res.write(`data: ${JSON.stringify(updated)}\n\n`);
        });

        req.on("close", () => {
            changeStream.close();
            res.end();
        });
    } catch (err) {
        console.error("stream API error:", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
}
