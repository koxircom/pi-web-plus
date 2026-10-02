const { parentPort } = require("worker_threads");

if (!parentPort) process.exit(1);

parentPort.on("message", (msg) => {
  if (!msg) return;

  if (msg.filePath && msg.filePath.includes("exit-file")) {
    process.exit(0);
  }
  if (msg.filePath && msg.filePath.includes("crash-file")) {
    process.exit(2);
  }
  if (msg.filePath && msg.filePath.includes("slow-file")) {
    // Never reply to trigger timeout
    return;
  }

  if (msg.type === "exit0") {
    process.exit(0);
  }
  if (msg.type === "crash") {
    process.exit(2);
  }
});
