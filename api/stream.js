import { MongoClient } from "mongodb";

let client;
const uri = process.env.MONGODB_URI;

export default async function handler(req, res) {
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }

  const db = client.db("galaxy_l9");
  const collection = db.collection("bosses");

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Initial data
  const bosses = await collection.find({}).toArray();
  res.write(`data: ${JSON.stringify(bosses)}\n\n`);

  // Listen to changes
  const changeStream = collection.watch();

  changeStream.on("change", (change) => {
    collection.find({}).toArray().then((updated) => {
      res.write(`data: ${JSON.stringify(updated)}\n\n`);
    });
  });

  // Close connection on client disconnect
  req.on("close", () => {
    changeStream.close();
    res.end();
  });
}
