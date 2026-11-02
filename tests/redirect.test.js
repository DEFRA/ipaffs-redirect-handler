const assert = require("node:assert/strict");
const http = require("node:http");
const { after, afterEach, before, beforeEach, test } = require("node:test");
const app = require("../app");

let server;
const originalHost = process.env.HOST;

before(async () => {
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", (error) =>
      error ? reject(error) : resolve(listener)
    );
  });
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  delete process.env.HOST;
});

afterEach(() => {
  if (originalHost === undefined) {
    delete process.env.HOST;
  } else {
    process.env.HOST = originalHost;
  }
});

function request(method, path, { headers = {}, form } = {}) {
  const body = form ? new URLSearchParams(form).toString() : "";
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        hostname: "127.0.0.1",
        port: server.address().port,
        method,
        path,
        agent: false,
        headers: {
          ...(form
            ? {
                "content-type": "application/x-www-form-urlencoded",
                "content-length": Buffer.byteLength(body),
              }
            : {}),
          ...headers,
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode, headers: response.headers, text })
        );
      }
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

function loginPath(overrides = {}) {
  return `/login?${new URLSearchParams({
    login_url: "https://login.microsoftonline.com/example/oauth2/v2.0/authorize",
    redirect_uri: "https://application.example/signin",
    state: "application-state",
    client_id: "example-client",
    response_type: "code",
    response_mode: "form_post",
    scope: "openid profile",
    ...overrides,
  })}`;
}

test("configured HOST uses the public PRD callback despite origin headers", async () => {
  process.env.HOST = "login.import-products-animals-food-feed.service.gov.uk";
  const response = await request("GET", loginPath(), {
    headers: {
      host: "ipaffs-redirect-prd.azure.defra.cloud",
      "x-original-host": "original.example",
      "x-forwarded-host": "forwarded.example",
    },
  });

  assert.equal(response.status, 302);
  assert.equal(
    new URL(response.headers.location).searchParams.get("redirect_uri"),
    "https://login.import-products-animals-food-feed.service.gov.uk/return"
  );
});

const fallbackCases = [
  {
    name: "forwarded host takes precedence over original host and host",
    headers: {
      host: "origin.example",
      "x-original-host": "original.example",
      "x-forwarded-host": "forwarded.example",
    },
    expected: "forwarded.example",
  },
  {
    name: "original host takes precedence over host",
    headers: { host: "origin.example", "x-original-host": "original.example" },
    expected: "original.example",
  },
  {
    name: "request host is the final fallback",
    headers: { host: "origin.example" },
    expected: "origin.example",
  },
];

for (const { name, headers, expected } of fallbackCases) {
  test(name, async () => {
    const response = await request("GET", loginPath(), { headers });
    assert.equal(response.status, 302);
    assert.equal(
      new URL(response.headers.location).searchParams.get("redirect_uri"),
      `https://${expected}/return`
    );
  });
}

test("empty HOST falls back to forwarded host", async () => {
  process.env.HOST = "";
  const response = await request("GET", loginPath(), {
    headers: { "x-forwarded-host": "forwarded.example" },
  });
  assert.equal(response.status, 302);
  assert.equal(
    new URL(response.headers.location).searchParams.get("redirect_uri"),
    "https://forwarded.example/return"
  );
});

test("login preserves provider parameters and wraps the original URL and state", async () => {
  const originalUrl = "https://application.example/signin?next=%2Fpage&lang=en";
  const originalState = 'state-with-<&"-and-unicode-\u00e9';
  const response = await request(
    "GET",
    loginPath({ redirect_uri: originalUrl, state: originalState, nonce: "nonce-123" }),
    { headers: { host: "redirect.example" } }
  );

  assert.equal(response.status, 302);
  const destination = new URL(response.headers.location);
  assert.equal(destination.origin, "https://login.microsoftonline.com");
  assert.equal(destination.pathname, "/example/oauth2/v2.0/authorize");
  assert.equal(destination.searchParams.get("client_id"), "example-client");
  assert.equal(destination.searchParams.get("response_type"), "code");
  assert.equal(destination.searchParams.get("response_mode"), "form_post");
  assert.equal(destination.searchParams.get("scope"), "openid profile");
  assert.equal(destination.searchParams.get("nonce"), "nonce-123");
  assert.equal(destination.searchParams.get("login_url"), null);
  assert.equal(destination.searchParams.get("redirect_uri"), "https://redirect.example/return");
  assert.deepEqual(JSON.parse(destination.searchParams.get("state")), {
    originalState,
    originalUrl,
  });
});

test("return restores state, posts provider fields to the application and escapes HTML", async () => {
  const response = await request("POST", "/return", {
    form: {
      state: JSON.stringify({
        originalUrl: 'https://application.example/signin?a=1&next="value"',
        originalState: 'original<&"state',
      }),
      code: 'code<&"value',
      id_token: "example-id-token",
      error: "example_error",
      error_description: '<script>alert("example")</script>',
    },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /^text\/html; charset=utf-8/);
  assert.ok(
    response.text.includes(
      'action="https://application.example/signin?a=1&amp;next=&quot;value&quot;" method="post"'
    )
  );
  assert.ok(response.text.includes('name="state" value="original&lt;&amp;&quot;state"'));
  assert.ok(response.text.includes('name="code" value="code&lt;&amp;&quot;value"'));
  assert.ok(response.text.includes('name="id_token" value="example-id-token"'));
  assert.ok(response.text.includes('name="error" value="example_error"'));
  assert.ok(
    response.text.includes(
      'name="error_description" value="&lt;script&gt;alert(&quot;example&quot;)&lt;/script&gt;"'
    )
  );
  assert.ok(response.text.includes("document.getElementById('muxForm').submit()"));
  assert.equal((response.text.match(/name="state"/g) || []).length, 1);
  assert.ok(!response.text.includes("originalState"));
  assert.ok(!response.text.includes('<script>alert("example")</script>'));
});

test("malformed wrapped state returns an error", async () => {
  const response = await request("POST", "/return", {
    form: { state: "{broken", code: "example-code" },
  });
  assert.equal(response.status, 500);
  assert.match(response.text, /^unmarshalling state:/);
  assert.ok(!response.text.includes('id="muxForm"'));
});

test("invalid provider URL returns an error instead of redirecting", async () => {
  const response = await request("GET", loginPath({ login_url: "not-an-absolute-url" }));
  assert.equal(response.status, 500);
  assert.match(response.text, /^parsing `login_url`:/);
  assert.equal(response.headers.location, undefined);
});
