import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

export default async function handler(req, res) {
  // Simple diagnostic endpoint - NO AUTH required (for debugging only)
  try {
    if (!uri) {
      return res.status(500).json({ 
        error: "MONGODB_URI not set in environment variables",
        hint: "Add MONGODB_URI to your Vercel project settings"
      });
    }

    const client = new MongoClient(uri, { 
      useNewUrlParser: true, 
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    
    await client.connect();
    const db = client.db("galaxy_l9");
    const collections = await db.listCollections().toArray();
    const bosses = await db.collection("bosses").countDocuments();
    
    await client.close();
    
    res.status(200).json({ 
      success: true,
      mongodbUri: uri.substring(0, 50) + "...",
      database: "galaxy_l9",
      collections: collections.map(c => c.name),
      bossCount: bosses,
      message: "MongoDB connection successful!"
    });
  } catch (err) {
    res.status(500).json({ 
      error: err.message,
      hint: "Check MONGODB_URI is correct and MongoDB cluster is running"
    });
  }
}
