// api/stream.js
import { MongoClient } from "mongodb";

let client;
const uri = process.env.MONGODB_URI;



export default async function handler(req, res) {
    if (!client) {
        client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
    }

    const db = client.db("galaxy_l9");
    const collection = db.collection("bosses");

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    // Send initial data (only necessary fields)
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

    // Watch for DB changes
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
}
