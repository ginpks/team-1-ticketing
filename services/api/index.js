const express = require("express");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    service: "api",
    status: "ok",
    message: "Express service is running",
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "healthy" });
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
