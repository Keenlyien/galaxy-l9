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
