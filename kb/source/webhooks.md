---
id: webhooks
title: Webhooks
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - webhooks
  - events
  - integration
---

# Webhooks

## What webhooks are

Webhooks push event notifications from DemoDesk to an HTTPS endpoint you control, so integrations do not need to poll for changes. When a subscribed event occurs, DemoDesk sends an HTTP POST with a JSON payload describing the event. Delivery is at-least-once: the same event may arrive more than once, so handlers must be idempotent and deduplicate on the event `id`.

## Subscribing to events

Register an endpoint in Settings > Developer > Webhooks, or create one with `POST /v1/webhook-endpoints` by supplying an HTTPS URL and a list of event types. Each endpoint receives only the events it subscribes to, and you can update subscriptions at any time. Endpoints created in sandbox may use plain HTTP, while production endpoints must present a valid TLS certificate.

## Event payloads

Every payload has an `id`, a `type`, an ISO 8601 `created_at`, and a `data` object with the affected resource. Common types include `ticket.created`, `ticket.updated`, and `comment.created`. Payloads are point-in-time snapshots, not live objects; re-fetch the resource if you need its current state. Unknown event types should be ignored rather than treated as errors.

## Retry behavior

Your endpoint must return a 2xx response within 10 seconds or the delivery counts as failed. Failed deliveries are retried with exponential backoff for roughly 24 hours, up to eight attempts. An endpoint that fails every delivery for 72 consecutive hours is disabled automatically and the workspace admins are notified. Process payloads asynchronously: acknowledge first, then do the work.
