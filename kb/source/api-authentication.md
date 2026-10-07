---
id: api-authentication
title: API Authentication
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - api
  - authentication
  - security
  - tokens
---

# API Authentication

## Overview

Every request to the DemoDesk API must be authenticated. The API accepts two credential types: static API keys for server-to-server integrations and OAuth 2.0 access tokens obtained with the client credentials grant for applications acting on behalf of a workspace. Credentials travel in request headers, never in query strings, so they are not captured by proxies or access logs. A request with no valid credential fails with HTTP 401 and an error code in the response body.

## API keys

API keys are long-lived credentials bound to a single workspace. Production keys begin with `ddk_live_` and sandbox keys with `ddk_test_`, which makes accidental production access from a test environment easy to spot. A key inherits the permissions of the user who created it, so treat it with the same care as that user's password and store it in a secret manager rather than in source control.

## Creating an API key

Create a key in Settings > Developer > API keys, or programmatically with `POST /v1/api-keys` using a credential that holds the `admin:keys` scope. The response includes the plaintext secret exactly once. DemoDesk stores only a hash and cannot display or recover the value later, so copy the secret into secure storage immediately; if it is lost, create a replacement and revoke the old key.

## Using the Authorization header

Send credentials in the `Authorization` header as a bearer token, for example `Authorization: Bearer ddk_live_abc123`. A request with a missing or malformed header returns 401. An expired credential also returns 401, with error code ERR-A17 in the body. Never place credentials in query strings, because URLs are routinely written to proxy and server logs.

## Bearer tokens

Bearer tokens are opaque strings: clients must not parse, decode, or depend on their structure. Whoever holds a token can use it, so transmit tokens only over TLS 1.2 or newer and never embed them in browser-side JavaScript. Load tokens from environment variables or a secret manager at runtime instead of compiling them into application code.

## OAuth 2.0 client credentials

Register an application in Settings > Developer > OAuth apps to receive a client ID and client secret. The client ID is public and safe to embed in configuration, but the client secret is a password and must be stored only on a server you control. Each OAuth app is bound to exactly one workspace, and its credentials stop working if that workspace is cancelled or moved to a different region. You may register up to twenty OAuth apps per workspace on the Pro plan and up to one hundred on Enterprise.

To obtain a token, send a form-encoded POST to the token endpoint with the client credentials grant. The request must use the `application/x-www-form-urlencoded` content type, must authenticate with the client ID and secret, and must include both `grant_type=client_credentials` and a space-separated `scope` list. Authenticate either by passing the client ID and secret as the username and password of HTTP Basic authentication, or by sending `client_id` and `client_secret` as form fields. Basic authentication is preferred because it keeps the secret out of request bodies, which some proxies log verbatim.

A successful token response contains an `access_token`, a `token_type` of `bearer`, an `expires_in` value of 3600 seconds, and an echoed `scope` string listing the scopes actually granted. The granted scopes may be narrower than the scopes you requested if an administrator later reduced the application's permissions; always inspect the returned `scope` instead of assuming your request was honored in full. If any requested scope is not permitted for the application, the request fails with an `invalid_scope` error and no token is issued, so validate your scope configuration before deploying.

Access tokens are valid for one hour from the moment they are issued. The client credentials grant does not issue refresh tokens and does not support silent renewal, so your integration must track the `expires_in` value, treat the token as invalid slightly before it actually expires to allow for clock skew of up to sixty seconds, and request a fresh token when needed. Request one token per application and share it across processes rather than requesting a new token for every call; token issuance is rate limited separately from the API itself, and a busy integration that mints a token per request will exhaust the token endpoint's quota even when its data calls are well within limits.

Scopes follow the pattern `resource:action`, such as `tickets:read`, `tickets:write`, `webhooks:write`, or `users:manage`. A token can perform only the actions its scopes allow, and every request is additionally limited by the role of the user the token acts for. When a token is issued on behalf of the workspace rather than a specific user, the effective permission is the union of the scopes it holds intersected with the workspace's service permissions. Adding a scope to an application does not grant it retroactively to tokens that were already issued; existing tokens keep their original scope set until they expire.

Rotate the client secret on the same schedule as other production credentials, at least every ninety days and immediately after any suspected exposure. Create the new secret, deploy it to your servers, confirm the token endpoint is issuing tokens with the new credential, and only then delete the old secret. During the overlap window both secrets are valid, which lets you roll out the change without downtime. The OAuth app record shows the timestamp of the last successful token request so you can confirm no service is still using a retired secret.

Common failures are easy to diagnose from the error code. `invalid_client` means the client ID or secret is wrong or the secret has been deleted; `invalid_grant` usually means the grant type or scope parameters are malformed; `invalid_scope` means the requested scope is not permitted; and `unauthorized_client` means the application type is not allowed to use the client credentials grant. A `429` from the token endpoint means you are requesting tokens too frequently, not that your data calls are over quota. A `503` is transient; retry with exponential backoff and jitter.

Finally, treat the client secret with the same care as a database password. Never ship it in a mobile app, a browser bundle, or a desktop client, because anyone who can read the binary can extract it. Restrict the source IP ranges allowed to use the credential, prefer short-lived tokens over static API keys for anything that talks to a public network, and enable workspace-level alerts so that an unusual spike in token requests or a burst of 401 responses is reported to your security team rather than discovered during an incident review.

## Token expiration and refresh

Static API keys do not expire unless you set an expiry date when creating them. OAuth access tokens expire after 3,600 seconds. The client credentials grant does not issue refresh tokens; when a call returns ERR-A17 or the local expiry time passes, request a new access token with the same client credentials and continue. Cache the token until it expires to avoid unnecessary token requests.

## Scopes and permissions

OAuth tokens carry an explicit scope list such as `tickets:read` or `webhooks:write`, and a token can do only what its scopes allow. API keys are not scoped and instead carry the full permission set of their creating user. For any request, the effective permission is the intersection of the credential's permissions and the requesting user's workspace role, so demoting a user immediately reduces what their keys can do.

## Rotating keys

Rotate production keys at least every 90 days and immediately after any suspected exposure. Create the replacement key first, deploy it everywhere, confirm traffic has moved, and only then revoke the previous key. Each key record exposes a `last_used_at` timestamp so you can verify that no service is still using the old credential before removing it.

## Revoking access

Revoke a key from the dashboard or with `DELETE /v1/api-keys/{id}`. Revocation propagates within 60 seconds, and requests made with a revoked key fail with 401. When you revoke a compromised key, review the workspace audit log for requests made with it, revoke any OAuth tokens issued to the same application, and rotate any secrets that the key could have reached.
