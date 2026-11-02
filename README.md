## OAuth2 Redirect Handler for Microsoft Identity Platform

A redirect URI wrapper to enable multiple instances of an application to work with a single Redirect URI for a Microsoft Identity Platform registered application.

The Node service listens on port `8000`. `GET /login` wraps the application's
original `redirect_uri` and `state`, then redirects to the provider supplied in
`login_url`. `POST /return` restores that state and submits the provider's form
fields to the original application. The wrapper does not exchange or validate
tokens or create application sessions.

### Public callback hostname

Set `HOST` to the public hostname registered with the identity provider, without
a scheme or path. The provider callback is always `https://<HOST>/return`.
`HOST` takes precedence over `x-forwarded-host`, `x-original-host` and `host`,
in that order; those headers provide the fallback when `HOST` is unset or empty.

The platform chart supplies `HOST` from `redirectorDomain`. Keep this override:
PRD's public callback hostname is different from the cluster ingress hostname.
The callback paths and the wrapped `originalUrl` / `originalState` fields match
the existing manifest-managed Go redirect handler.

### Build and deployment

`pipeline.yaml` installs dependencies, runs the callback tests and builds the
`ipaffs/redirect-handler` container image. This pipeline builds and publishes
the image; `ipaffs-manifest` owns platform deployment and environment promotion.
Changes to this repository do not deploy the service directly.

Run the HTTP contract tests locally with:

```sh
npm ci
npm test
```
