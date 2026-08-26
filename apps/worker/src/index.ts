const databaseConfigured = Boolean(process.env.DATABASE_URL);
console.log(JSON.stringify({ service: "pm-studio-worker", status: "started", queue: databaseConfigured ? "postgres" : "local-web-process", timestamp: new Date().toISOString() }));

if (!databaseConfigured) {
  console.log("DATABASE_URL is not configured; durable jobs run in the local web process for this development profile.");
}

setInterval(() => {
  console.log(JSON.stringify({ service: "pm-studio-worker", event: "heartbeat", timestamp: new Date().toISOString() }));
}, 30_000);
