import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();
const data = "10mb";

app.use(
  cors({
    origin: process.env.CLIENT_URI,
    credentials: true,
  })
);

app.use(express.json({ limit: data }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

import authRoutes from "./routes/authRoute.js";
import dnsRoutes from "./routes/dnsRoute.js";
import mailboxRoute from "./routes/mailboxRoute.js";
import emailRoute from "./routes/emailRoute.js";

app.use("/api/auth", authRoutes);
app.use("/api/dns", dnsRoutes);
app.use("/api/mailboxes", mailboxRoute);
app.use("/api/email", emailRoute);

app.get("/", (req, res) => {
  res.send("Hello from root!");
});

export default app;
