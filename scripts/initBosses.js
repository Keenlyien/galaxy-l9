import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
}

const defaultBosses = [
    { name: "Venatus", location: "Leafre Forest", level: 135, respawn: "24 Hour" },
    { name: "Livera", location: "Leafre Forest", level: 135, respawn: "24 Hour" },
    { name: "Neutro", location: "Leafre Forest", level: 135, respawn: "24 Hour" },
    { name: "Lady Dalia", location: "Leafre Forest", level: 135, respawn: "24 Hour" },
    { name: "Thymele", location: "Leafre Forest", level: 135, respawn: "24 Hour" },
    { name: "Baron Braudmore", location: "Leafre Forest", level: 140, respawn: "Monday 12:00, Friday 12:00" },
    { name: "Milavy", location: "Deep Sea", level: 150, respawn: "24 Hour" },
    { name: "Wannitas", location: "Deep Sea", level: 150, respawn: "24 Hour" },
    { name: "Duplican", location: "Tower of Oz", level: 155, respawn: "Monday 12:00, Friday 12:00" },
    { name: "Shuliar", location: "Tower of Oz", level: 155, respawn: "Monday 12:00, Friday 12:00" },
    { name: "Roderick", location: "Tower of Oz", level: 155, respawn: "Monday 12:00, Friday 12:00" },
    { name: "Titore", location: "Tower of Oz", level: 155, respawn: "Monday 12:00, Friday 12:00" },
    { name: "Larba", location: "Tower of Oz", level: 160, respawn: "Saturday 18:00" },
    { name: "Catena", location: "Ancient Ruins", level: 165, respawn: "Sunday 18:00" },
    { name: "Auraq", location: "Ancient Ruins", level: 165, respawn: "Saturday 18:00" },
    { name: "Secreta", location: "Ancient Ruins", level: 170, respawn: "Saturday 18:00" },
    { name: "Ordo", location: "Ancient Ruins", level: 170, respawn: "Sunday 18:00" },
    { name: "Asta", location: "Dimensional Crack", level: 175, respawn: "Monday 18:00, Friday 18:00" },
    { name: "Chaiflock", location: "Dimensional Crack", level: 180, respawn: "Monday 18:00, Friday 18:00" },
    { name: "Benji", location: "Dimensional Crack", level: 185, respawn: "Monday 18:00, Friday 18:00" }
];

async function initializeBosses() {
    let client;
    try {
        client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
        
        const db = client.db("galaxy_l9");
        const collection = db.collection("bosses");
        
        // Check if bosses already exist
        const count = await collection.countDocuments();
        
        if (count === 0) {
            console.log("Initializing bosses in database...");
            
            // Add default bosses
            const result = await collection.insertMany(
                defaultBosses.map(boss => ({
                    ...boss,
                    last_killed: null,
                    image: null
                }))
            );
            
            console.log(`✓ Initialized ${result.insertedCount} bosses`);
        } else {
            console.log(`✓ Database already has ${count} bosses`);
        }
        
    } catch (err) {
        console.error("Error initializing bosses:", err);
    } finally {
        if (client) {
            await client.close();
        }
    }
}

initializeBosses();
