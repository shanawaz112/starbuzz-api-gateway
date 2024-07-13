const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const winston = require("winston");
const axios = require("axios");
require("dotenv").config();
// const https = require("https");

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET;

// Use Helmet for security
app.use(helmet());

// Set up Winston logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  );
}

// Use morgan for HTTP request logging
app.use(
  morgan("combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// Set up rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) {
    return res.status(403).send("A token is required for authentication");
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    return res.status(401).send("Invalid Token");
  }
  return next();
};

// Define the configuration for proxy routes
const proxyConfig = [
  {
    path: "/service1",
    target: process.env.SERVICE1_URL, // Ensure this is the AWS service URL
  },
  {
    path: "/service2",
    target: process.env.SERVICE2_URL, // Ensure this is the AWS service URL
  },
];

// Set up the proxy middleware for each route
proxyConfig.forEach((config) => {
  app.use(
    config.path,
    // verifyToken,
    createProxyMiddleware({
      target: config.target,
      changeOrigin: true,
      pathRewrite: (path, req) => path.replace(config.path, ""),
      timeout: 10000, // Increase timeout to 10 seconds
      proxyTimeout: 10000, // Increase proxy timeout to 10 seconds
      onError: (err, req, res) => {
        logger.error(
          `Error occurred while proxying ${req.url}: ${err.message}`
        );
        res.status(504).send("Gateway Timeout");
      },
        secure: true, // Ensure secure connections to the target
    })
  );
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("API Gateway is healthy");
});

// API status endpoint
app.get("/status", async (req, res) => {
  const services = [
    { name: "service1", url: process.env.SERVICE1_URL },
    { name: "service2", url: process.env.SERVICE2_URL },
  ];

  const statusPromises = services.map(async (service) => {
    try {
      await axios.get(`${service.url}/health`);
      return { name: service.name, status: "healthy" };
    } catch (error) {
      return { name: service.name, status: "unhealthy", error: error.message };
    }
  });

  const statuses = await Promise.all(statusPromises);
  res.status(200).json({ gateway: "healthy", services: statuses });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).send("Something broke!");
});

// // Create HTTPS credentials
// const credentials = {
//   key: process.env.HTTPS_KEY,
//   cert: process.env.HTTPS_CERT,
// };

// // Create HTTPS server (if you want your local API Gateway to also support HTTPS)
// const httpsServer = https.createServer(credentials, app);

// For local development without HTTPS, use HTTP server
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
