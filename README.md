## OAuth2 Redirect Handler for Microsoft Identity Platform

A redirect URI wrapper to enable multiple instances of an application to work with a single Redirect URI for a Microsoft Identity Platform registered application.

Node.js port of [ms-identity-redirect-handler](https://github.com/manicminer/ms-identity-redirect-handler).

### Endpoints

- `GET /login?login_url=<authorize-url>&redirect_uri=<app-callback>&state=<app-state>&...` wraps the
  original `state` and `redirect_uri` into a JSON state value, sets `redirect_uri` to
  `https://<host>/return`, and redirects to `login_url` with all other query parameters passed through.
- `POST /return` receives the `form_post` response from Microsoft, restores the original state and
  posts the response back to the original application callback via an auto-submitting form. If
  Microsoft returns an `error`, an error page is shown instead.

### Configuration

The service listens on port `8000`. The public hostname used for the `/return` redirect URI is taken from,
in order:

1. `HOST` environment variable
2. `X-Forwarded-For` header
3. `X-Original-Host` header
4. `Host` header

`VERSION` may be set to change the version reported at startup.

### Running locally

```bash
cd service
npm ci
npm start
npm test                          # mocha unit tests with c8 coverage
npx playwright install chromium   # first time only
npm run test:playwright           # browser tests of the full redirect round trip
```

The shared `ipaffs-infra` Node pipeline runs `build`, `test-jenkins`, `posttest-jenkins` and
`test:playwright` from `service/`.

HTML for the success and error pages lives in `service/templates/`, which matches the upstream Go project.
