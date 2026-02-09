// server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8787;

const server = http.createServer((req, res) => {
  // Simple static server
  const urlPath = req.url.split("?")[0];
  const filePath = urlPath === "/" ? "index.html" : urlPath.slice(1);

  const full = path.join(process.cwd(), filePath);

  // Optional: API placeholder (for later)
  if (req.method === "POST" && urlPath === "/api/evaluate") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "NOT_IMPLEMENTED",
        message: "API mode not implemented in this minimal server. Use offline mock in index.html or extend this endpoint."
      }));
    });
    return;
  }

  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`AEGIS UI running at http://localhost:${PORT}`);
});
