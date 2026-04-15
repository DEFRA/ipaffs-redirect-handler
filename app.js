const express = require("express");
const bodyParser = require("body-parser");

const PORT = 8000;
const version = "dev";

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hiddenFields(fields) {
  return Object.entries(fields)
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`
    )
    .join("");
}

app.get("/login", (req, res) => {
  let hostname =
    req.headers["x-forwarded-host"] ||
    req.headers["x-original-host"] ||
    req.headers["host"];

  if (!hostname) {
    return res
      .status(400)
      .send("Unable to determine hostname from HTTP headers");
  }

  let loginUrl;
  try {
    loginUrl = new URL(req.query.login_url);
  } catch (err) {
    return res
      .status(500)
      .send(`parsing \`login_url\`: ${err.message}`);
  }

  const params = new URLSearchParams();

  const skipFields = ["login_url", "redirect_uri", "state"];

  for (const [key, value] of Object.entries(req.query)) {
    if (skipFields.includes(key)) continue;
    if (value) params.set(key, value);
  }

  const state = {
    originalState: req.query.state || "",
    originalUrl: req.query.redirect_uri || "",
  };

  let stateVal;
  try {
    stateVal = JSON.stringify(state);
  } catch (err) {
    return res
      .status(500)
      .send(`marshalling state: ${err.message}`);
  }

  params.set("redirect_uri", `https://${hostname}/return`);
  params.set("state", stateVal);

  loginUrl.search = params.toString();

  res.redirect(302, loginUrl.toString());
});

app.post("/return", (req, res) => {
  let state;
  try {
    state = JSON.parse(req.body.state || "{}");
  } catch (err) {
    return res
      .status(500)
      .send(`unmarshalling state: ${err.message}`);
  }

  const fields = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (key === "state") continue;
    fields[key] = value;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Login Successful</title>
  <script type="text/javascript">
    window.onload = function() {
      document.getElementById('muxForm').submit();
    };
  </script>
</head>
<body>
  <form id="muxForm" action="${escapeHtml(
    state.originalUrl || ""
  )}" method="post">
    <input type="hidden" name="state" value="${escapeHtml(
      state.originalState || ""
    )}">
    ${hiddenFields(fields)}
    <noscript>
      <h2>Login Successful</h2>
      <input type="submit" value="Continue">
    </noscript>
  </form>
</body>
</html>`;

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

const server = app.listen(PORT, () => {
  console.log(
    `ipaffs-redirect-handler ${version} is running on port ${PORT}`
  );
});

function shutdown() {
  console.log("Shutting down...");
  server.close(() => {
    process.exit(0);
  });

  // Force shutdown after 5s
  setTimeout(() => {
    console.error("Forcibly shutting down");
    process.exit(1);
  }, 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
