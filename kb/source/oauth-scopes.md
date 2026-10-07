---
id: oauth-scopes
title: OAuth Scopes
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - api
  - oauth
  - scopes
---

# OAuth Scopes

## Scope model

A scope is a lowercase string of the form `resource:action`, such as `tickets:read` or `webhooks:write`. Scopes restrict what an OAuth access token can do: a token can perform only the actions its scopes allow, regardless of the issuing user's role. Wildcards, prefixes, and implicit hierarchy are not supported — `tickets:write` does not imply `tickets:read`.

## Available scopes

The current scope set covers the public API: `tickets:read`, `tickets:write`, `comments:write`, `webhooks:read`, `webhooks:write`, `workspaces:read`, and `admin:keys`. Request each scope you need explicitly; the authorization request fails if any scope is unknown or not registered on your OAuth application.

## Requesting scopes

Pass a space-separated `scope` parameter when exchanging credentials at the OAuth token endpoint. The requested set must be a subset of the scopes registered on the application, otherwise the request is rejected before a token is issued. A token cannot be widened after issuance, so if requirements change, update the application registration and obtain a new token.

## Least privilege

Grant the smallest scope set that lets the integration work. Read-only dashboards should request only the `:read` scopes, and no integration should hold `admin:keys` unless it manages credentials. Review registered scopes quarterly and remove any that have not been used; a stolen token can do exactly what its scopes permit, and nothing more.
