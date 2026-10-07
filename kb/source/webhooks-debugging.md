---
id: webhooks-debugging
title: Debugging Webhooks
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - webhooks
  - debugging
  - troubleshooting
---

# Debugging Webhooks

## Delivery logs

Every webhook delivery attempt is recorded for 30 days in Settings > Developer > Webhooks > Delivery logs. Each entry shows the event type and id, the target URL, the response status and duration, and any transport error such as a TLS failure or timeout. The redeliver action resends a stored event with the same event id but a new signature timestamp, which is useful for replaying after a fix.

## Testing with a local endpoint

To test before building the real handler, expose a local server through a tunnel service and register the tunnel's HTTPS URL as a sandbox webhook endpoint. Sandbox endpoints may use plain HTTP, so a local listener such as `http://localhost:4000/hooks` works when the webhook tool runs on the same machine. Trigger test events from the dashboard and inspect the raw request body, headers, and signature.

## Common delivery failures

The most frequent failures are TLS handshakes rejected because the endpoint's certificate is self-signed or expired, timeouts when the handler takes longer than 10 seconds, and 5xx responses from application errors. Redirects are not followed, so a 301 from an HTTP to HTTPS upgrade fails the delivery. Also check that the endpoint is reachable from the public internet and that no firewall or IP allowlist blocks DemoDesk. Inspect the delivery log's response snippet first; it usually identifies the cause immediately.
