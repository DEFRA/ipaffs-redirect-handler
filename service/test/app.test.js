/* eslint-env mocha */
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp } = require("../app");

let server;
let port;

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  port = server.address().port;
});

after(() => new Promise((resolve) => server.close(resolve)));

afterEach(() => {
  delete process.env.HOST;
});

function request({ method = "GET", path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: data })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function postForm(path, form) {
  const body = new URLSearchParams(form).toString();
  return request({
    method: "POST",
    path,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  });
}

const entraQuery = {
  login_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  client_id: "00000000-0000-0000-0000-000000000000",
  response_type: "code",
  response_mode: "form_post",
  scope: "openid profile email",
  redirect_uri: "https://app1.example.com/auth/microsoft/callback",
  state: "app1-generated-state",
  nonce: "app1-generated-nonce",
};

describe("GET /login", () => {
  it("redirects to Entra ID authorize endpoint", async () => {
    const query = new URLSearchParams({ ...entraQuery, prompt: "select_account" });
    const res = await request({
      path: `/login?${query}`,
      headers: { "X-Forwarded-For": "identity.example.com" },
    });

    assert.equal(res.status, 302);
    const url = new URL(res.headers.location);
    assert.equal(url.protocol, "https:");
    assert.equal(url.host, "login.microsoftonline.com");
    assert.equal(url.pathname, "/common/oauth2/v2.0/authorize");

    const p = url.searchParams;
    assert.equal(p.get("client_id"), "00000000-0000-0000-0000-000000000000");
    assert.equal(p.get("response_type"), "code");
    assert.equal(p.get("response_mode"), "form_post");
    assert.equal(p.get("scope"), "openid profile email");
    assert.equal(p.get("nonce"), "app1-generated-nonce");
    assert.equal(p.get("prompt"), "select_account");
    assert.equal(p.get("redirect_uri"), "https://identity.example.com/return");
    assert.equal(p.has("login_url"), false);

    assert.deepEqual(JSON.parse(p.get("state")), {
      originalState: "app1-generated-state",
      originalUrl: "https://app1.example.com/auth/microsoft/callback",
    });
  });

  it("redirects to B2C authorize endpoint", async () => {
    const query = new URLSearchParams({
      login_url:
        "https://contoso.b2clogin.com/contoso.onmicrosoft.com/B2C_1_signupsignin/oauth2/v2.0/authorize",
      client_id: "11111111-1111-1111-1111-111111111111",
      response_type: "code",
      response_mode: "form_post",
      scope: "openid offline_access",
      redirect_uri: "https://app2.example.com/auth/b2c/callback",
      state: "app2-generated-state",
      nonce: "app2-generated-nonce",
    });
    const res = await request({
      path: `/login?${query}`,
      headers: { "X-Forwarded-For": "identity.example.com" },
    });

    assert.equal(res.status, 302);
    const url = new URL(res.headers.location);
    assert.equal(url.protocol, "https:");
    assert.equal(url.host, "contoso.b2clogin.com");
    assert.equal(
      url.pathname,
      "/contoso.onmicrosoft.com/B2C_1_signupsignin/oauth2/v2.0/authorize"
    );

    const p = url.searchParams;
    assert.equal(p.get("client_id"), "11111111-1111-1111-1111-111111111111");
    assert.equal(p.get("response_type"), "code");
    assert.equal(p.get("response_mode"), "form_post");
    assert.equal(p.get("scope"), "openid offline_access");
    assert.equal(p.get("nonce"), "app2-generated-nonce");
    assert.equal(p.get("redirect_uri"), "https://identity.example.com/return");

    assert.deepEqual(JSON.parse(p.get("state")), {
      originalState: "app2-generated-state",
      originalUrl: "https://app2.example.com/auth/b2c/callback",
    });
  });

  describe("determines return host", () => {
    const cases = [
      {
        name: "uses HOST environment variable first",
        envHost: "env.identity.example.com",
        headers: {
          "X-Forwarded-For": "forwarded.identity.example.com",
          "X-Original-Host": "original.identity.example.com",
        },
        wantHost: "env.identity.example.com",
      },
      {
        name: "uses X-Forwarded-For header",
        headers: {
          "X-Forwarded-For": "forwarded.identity.example.com",
          "X-Original-Host": "original.identity.example.com",
        },
        wantHost: "forwarded.identity.example.com",
      },
      {
        name: "uses X-Original-Host header when forwarded header is missing",
        headers: { "X-Original-Host": "original.identity.example.com" },
        wantHost: "original.identity.example.com",
      },
      {
        name: "uses request Host when proxy headers are missing",
        headers: {},
        wantHost: "request.identity.example.com",
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        if (tc.envHost) process.env.HOST = tc.envHost;
        const res = await request({
          path: `/login?${new URLSearchParams(entraQuery)}`,
          headers: { Host: "request.identity.example.com", ...tc.headers },
        });

        assert.equal(res.status, 302);
        const url = new URL(res.headers.location);
        assert.equal(
          url.searchParams.get("redirect_uri"),
          `https://${tc.wantHost}/return`
        );
      });
    }
  });

  it("returns error page for invalid login_url", async () => {
    const res = await request({
      path: "/login?login_url=not-a-url",
      headers: { "X-Forwarded-For": "identity.example.com" },
    });
    assert.equal(res.status, 500);
    assert.match(res.body, /Login Error/);
    assert.match(res.body, /Could not parse `login_url`/);
  });

  it("rejects unsupported method", async () => {
    const res = await request({ method: "POST", path: "/login" });
    assert.equal(res.status, 405);
    assert.match(res.body, /Method not allowed/);
  });
});

describe("POST /return", () => {
  it("posts successful response back to original application", async () => {
    const res = await postForm("/return", {
      state: JSON.stringify({
        originalState: "app1-generated-state",
        originalUrl: "https://app1.example.com/auth/microsoft/callback",
      }),
      code: "auth-code-from-microsoft",
      session_state: "session-state-from-microsoft",
    });

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /^text\/html/);
    const body = res.body;
    assert.ok(
      body.includes(
        '<form id="muxForm" action="https://app1.example.com/auth/microsoft/callback" method="post">'
      )
    );
    assert.ok(body.includes('<input type="hidden" name="state" value="app1-generated-state">'));
    assert.ok(body.includes('<input type="hidden" name="code" value="auth-code-from-microsoft">'));
    assert.ok(
      body.includes('<input type="hidden" name="session_state" value="session-state-from-microsoft">')
    );
    assert.ok(body.includes("Login Successful"));
  });

  it("displays Microsoft login error", async () => {
    const res = await postForm("/return", {
      state: JSON.stringify({
        originalState: "app1-generated-state",
        originalUrl: "https://app1.example.com/auth/microsoft/callback",
      }),
      error: "access_denied",
      error_description: "The user cancelled the sign-in flow.",
    });

    assert.equal(res.status, 500);
    const body = res.body;
    assert.ok(body.includes("Login Error"));
    assert.ok(body.includes("access_denied"));
    assert.ok(body.includes("The user cancelled the sign-in flow."));
    assert.ok(!body.includes("Login Successful"));
    assert.ok(!body.includes('action="https://app1.example.com/auth/microsoft/callback"'));
  });

  it("escapes values from state and form fields", async () => {
    const res = await postForm("/return", {
      state: JSON.stringify({
        originalState: '"><script>alert(1)</script>',
        originalUrl: 'https://app.example.com/cb"><script>',
      }),
      code: "<b>code</b>",
    });

    assert.equal(res.status, 200);
    assert.ok(!res.body.includes("<script>alert(1)"));
    assert.ok(!res.body.includes('cb"><script>'));
    assert.ok(res.body.includes("&lt;b&gt;code&lt;/b&gt;"));
  });

  it("returns 500 for invalid state", async () => {
    const res = await postForm("/return", { state: "not-json", code: "x" });
    assert.equal(res.status, 500);
    assert.match(res.body, /unmarshalling state/);
  });

  it("rejects unsupported method", async () => {
    const res = await request({ path: "/return" });
    assert.equal(res.status, 405);
    assert.match(res.body, /Method not allowed/);
  });
});
