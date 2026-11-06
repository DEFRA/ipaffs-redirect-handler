const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const PORT = 8000;
const version = process.env.VERSION || "dev";

const errorTemplate = fs.readFileSync(
  path.join(__dirname, "templates", "error.html"),
  "utf8"
);
const returnTemplate = fs.readFileSync(
  path.join(__dirname, "templates", "return.html"),
  "utf8"
);

// Mirrors Go's html.EscapeString.
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;");
}

// Fills `%[n]s` placeholders (Go fmt syntax, so the templates stay in sync with upstream).
function render(template, ...values) {
  return template.replace(/%\[(\d+)\]s/g, (match, n) => {
    const value = values[Number(n) - 1];
    return value === undefined ? match : value;
  });
}

// Like Go's url.Values.Get: the first value for a key, or "".
function first(value) {
  if (Array.isArray(value)) return value.length ? String(value[0]) : "";
  return value === undefined || value === null ? "" : String(value);
}

function hiddenFields(fields) {
  return Object.entries(fields)
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`
    )
    .join("");
}

function handleError(res, statusCode, errorTitle, errorMessage) {
  res
    .status(statusCode)
    .type("text/html; charset=utf-8")
    .send(render(errorTemplate, escapeHtml(errorTitle), escapeHtml(errorMessage)));
}

function determineHostname(req) {
  return (
    process.env.HOST ||
    req.get("X-Forwarded-For") ||
    req.get("X-Original-Host") ||
    req.get("Host") ||
    ""
  );
}

function loginHandler(req, res) {
  if (req.method !== "GET") {
    return handleError(res, 405, "Invalid Request", "Method not allowed");
  }

  const hostname = determineHostname(req);
  if (!hostname) {
    return handleError(
      res,
      400,
      "Invalid Request",
      "Unable to determine hostname from HTTP headers"
    );
  }

  let loginUrl;
  try {
    loginUrl = new URL(first(req.query.login_url));
  } catch (err) {
    return handleError(res, 500, "Could not parse `login_url`", err.message);
  }

  const params = new URLSearchParams();
  const skipFields = ["login_url", "redirect_uri", "state"];
  for (const [key, value] of Object.entries(req.query)) {
    if (skipFields.includes(key)) continue;
    const val = first(value);
    if (val) params.set(key, val);
  }

  const state = {
    originalState: first(req.query.state),
    originalUrl: first(req.query.redirect_uri),
  };

  params.set("redirect_uri", `https://${hostname}/return`);
  params.set("state", JSON.stringify(state));
  loginUrl.search = params.toString();

  res.redirect(302, loginUrl.toString());
}

function returnHandler(req, res) {
  if (req.method !== "POST") {
    return handleError(res, 405, "Invalid Request", "Method not allowed");
  }

  const form = req.body || {};

  const errorCode = first(form.error);
  if (errorCode) {
    return handleError(res, 500, errorCode, first(form.error_description));
  }

  let state;
  try {
    state = JSON.parse(first(form.state));
  } catch (err) {
    return res
      .status(500)
      .type("text/plain; charset=utf-8")
      .send(`unmarshalling state: ${err.message}`);
  }
  if (state === null || typeof state !== "object") state = {};

  const fields = {};
  for (const [key, value] of Object.entries(form)) {
    if (key === "state") continue;
    fields[key] = first(value);
  }

  const out = render(
    returnTemplate,
    escapeHtml(first(state.originalUrl)),
    escapeHtml(first(state.originalState)),
    hiddenFields(fields)
  );
  res.type("text/html; charset=utf-8").send(out);
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.all("/login", loginHandler);
  app.all("/return", returnHandler);
  return app;
}

function start(port = PORT) {
  const server = createApp().listen(port, () => {
    console.log(`ipaffs-redirect-handler ${version} is running on port ${port}`);
  });

  function shutdown() {
    console.log("Shutting down...");
    server.close(() => process.exit(0));
    setTimeout(() => {
      console.error("Forcibly shutting down server");
      process.exit(1);
    }, 5000).unref();
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
