---
id: api-rate-limits
title: API Rate Limits
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - api
  - rate-limits
  - quotas
---

# API Rate Limits

## Default limits per plan

DemoDesk enforces request limits per workspace, not per API key, so traffic from all keys and OAuth tokens in a workspace shares one budget. The Free plan allows 60 requests per minute and 10,000 requests per day. The Team plan allows 600 per minute and 500,000 per day. Enterprise workspaces negotiate custom limits, typically starting at 3,000 requests per minute.

## Rate limit headers

Every API response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. The reset value is a Unix timestamp in seconds marking when the current minute window refills. Read these headers and pace requests proactively; they are the supported way to avoid 429 responses. A separate daily counter resets at 00:00 UTC.

## Handling 429 responses

When a limit is exceeded the API returns HTTP 429 with error code ERR-B04 and a `Retry-After` header containing the number of seconds to wait. Back off exponentially with jitter rather than retrying immediately, and cap retries at five attempts before alerting. Do not retry in a tight loop.

## Burst allowances

Short bursts may exceed the per-minute figure by up to 50% for windows under ten seconds, as long as the daily quota is not exhausted. Sustained overage is throttled regardless of burst headroom. If you regularly rely on bursts, contact support to raise the per-minute limit instead.
