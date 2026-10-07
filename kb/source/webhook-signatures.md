---
id: webhook-signatures
title: Webhook Signatures
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - webhooks
  - security
  - signatures
---

# Webhook Signatures

## Verifying signatures

Every webhook delivery includes a `DemoDesk-Signature` header in the form `t=1712345678,v1=hex`. To verify, compute an HMAC-SHA256 over the string `{t}.{raw_body}` using the endpoint's signing secret, then compare it to `v1` in constant time. Verify against the raw request body bytes before parsing JSON, because any reserialization changes the payload and breaks the signature. Reject the delivery if verification fails.

## The signing secret

Each webhook endpoint has its own signing secret, generated when the endpoint is created and displayed exactly once. Store it like an API key, ideally in a secret manager. During secret rotation DemoDesk signs with the new secret while still accepting the old one briefly, so accept a delivery when either active secret validates the signature.

## Timestamp tolerance

The `t` value is the Unix timestamp when the signature was produced. Reject deliveries whose timestamp differs from your server clock by more than 300 seconds, or an attacker could replay a captured payload indefinitely. Keep servers synchronized with NTP. If a delivery was delayed in a queue and fails the tolerance check, replay it manually from the delivery logs rather than loosening the window.
