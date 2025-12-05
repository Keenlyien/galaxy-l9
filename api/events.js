import { getSSEController } from "../../lib/sseController";


export const config = {
runtime: "nodejs",
};


export default function handler(req, res) {
res.setHeader("Content-Type", "text/event-stream");
res.setHeader("Cache-Control", "no-cache, no-transform");
res.setHeader("Connection", "keep-alive");


const { addClient } = getSSEController();
addClient(res);
}
