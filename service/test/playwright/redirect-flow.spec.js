const { test, expect } = require("@playwright/test");

// Stand-ins for Microsoft and the calling application, served via page.route
// so the full browser round trip runs without network access.
const AUTHORIZE_URL = "https://login.microsoftonline.test/common/oauth2/v2.0/authorize";
const APP_CALLBACK = "https://app1.example.test/auth/microsoft/callback";

function loginPath(extra = {}) {
  const query = new URLSearchParams({
    login_url: AUTHORIZE_URL,
    client_id: "00000000-0000-0000-0000-000000000000",
    response_type: "code",
    response_mode: "form_post",
    scope: "openid profile email",
    redirect_uri: APP_CALLBACK,
    state: "app1-generated-state",
    nonce: "app1-generated-nonce",
    ...extra,
  });
  return `/login?${query}`;
}

// Playwright does not route the target of a server redirect, so follow the
// /login 302 by hand; the browser then loads the (stubbed) Microsoft page.
async function startLogin(page, request) {
  const res = await request.get(loginPath(), { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  await page.goto(res.headers().location);
}

// Microsoft responds with an auto-submitting form_post to the redirect handler.
// redirect_uri points at https://<host>/return; the test server is plain http.
async function stubMicrosoft(page, baseURL, responseFields) {
  const seen = {};
  await page.route(`${AUTHORIZE_URL}**`, async (route) => {
    const url = new URL(route.request().url());
    seen.redirectUri = url.searchParams.get("redirect_uri");
    seen.state = url.searchParams.get("state");
    seen.clientId = url.searchParams.get("client_id");

    const fields = { state: seen.state, ...responseFields };
    const inputs = Object.entries(fields)
      .map(([k, v]) => `<input type="hidden" name="${k}" value='${String(v).replace(/'/g, "&#39;")}'>`)
      .join("");
    await route.fulfill({
      contentType: "text/html",
      body: `<form id="f" method="post" action="${baseURL}/return">${inputs}</form>
             <script>document.getElementById("f").submit()</script>`,
    });
  });
  return seen;
}

test("completes sign-in and posts the response back to the original application", async ({ page, request, baseURL }) => {
  const microsoft = await stubMicrosoft(page, baseURL, {
    code: "auth-code-from-microsoft",
    session_state: "session-state-from-microsoft",
  });

  const callback = new Promise((resolve) => {
    page.route(`${APP_CALLBACK}**`, async (route) => {
      resolve({
        method: route.request().method(),
        form: Object.fromEntries(new URLSearchParams(route.request().postData() || "")),
      });
      await route.fulfill({ contentType: "text/html", body: "<h1>App signed in</h1>" });
    });
  });

  await startLogin(page, request);

  const received = await callback;
  await expect(page.getByRole("heading", { name: "App signed in" })).toBeVisible();

  expect(microsoft.clientId).toBe("00000000-0000-0000-0000-000000000000");
  expect(microsoft.redirectUri).toBe(`https://${new URL(baseURL).host}/return`);
  expect(JSON.parse(microsoft.state)).toEqual({
    originalState: "app1-generated-state",
    originalUrl: APP_CALLBACK,
  });

  expect(received.method).toBe("POST");
  expect(received.form).toEqual({
    state: "app1-generated-state",
    code: "auth-code-from-microsoft",
    session_state: "session-state-from-microsoft",
  });
});

test("shows an error page with expandable details when Microsoft returns an error", async ({ page, request, baseURL }) => {
  await stubMicrosoft(page, baseURL, {
    error: "access_denied",
    error_description: "The user cancelled the sign-in flow.",
  });

  let appCalled = false;
  await page.route(`${APP_CALLBACK}**`, (route) => {
    appCalled = true;
    return route.abort();
  });

  await startLogin(page, request);

  await expect(page.getByRole("heading", { name: "Login Error" })).toBeVisible();
  const details = page.locator("#errorDetails");
  await expect(details).toContainText("access_denied");

  const toggle = page.getByRole("button", { name: "Show Error Details" });
  await expect(toggle).not.toHaveClass(/active/);
  await toggle.click();
  await expect(toggle).toHaveClass(/active/);
  await expect(details.getByText("The user cancelled the sign-in flow.")).toBeVisible();

  expect(appCalled).toBe(false);
});
