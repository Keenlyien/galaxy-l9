import { MongoClient } from "mongodb";


const uri = process.env.MONGODB_URI;
const options = {};


let client;
let clientPromise;


if (!process.env.MONGODB_URI) {
throw new Error("Missing MONGODB_URI in environment");
}


if (process.env.NODE_ENV === "development") {
if (!global._mongoClientPromise) {
client = new MongoClient(uri, options);
global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;
} else {
client = new MongoClient(uri, options);
clientPromise = client.connect();
}


export default clientPromise;


=============================
FILE: /lib/sseController.js
=============================


let clients = [];


export function getSSEController() {
return {
addClient(res) {
clients.push(res);
res.write(`event: connected\n`);
res.write(`data: connected\n\n`);


req.on("close", () => {
clients = clients.filter((c) => c !== res);
});
},


broadcast(data) {
const payload = `data: ${JSON.stringify(data)}\n\n`;
clients.forEach((res) => res.write(payload));
},
};
}
