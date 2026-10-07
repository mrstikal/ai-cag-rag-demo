---
id: sdks
title: Official SDKs
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - api
  - sdk
  - libraries
---

# Official SDKs

## Available SDKs

DemoDesk maintains official SDKs for Python, Node.js, Go, Java, and Ruby. Each SDK is written and supported by DemoDesk, tracks API versions on the same schedule, and is published under the `demodesk` name in its ecosystem's package registry. Community libraries exist but are not audited or supported; use them at your own risk.

## Installation

Install with your language's package manager: `pip install demodesk` for Python, `npm install @demodesk/sdk` for Node.js, the Go module path for Go, the Maven coordinates `com.demodesk:demodesk-java` for Java, and `gem install demodesk` for Ruby. All SDKs require a supported runtime version; Python 3.9+, Node.js 18+, Go 1.21+, Java 17+, and Ruby 3.1+ are the current floors.

## Client configuration

Construct a client with an API key or OAuth token, then optionally set a base URL override, request timeout (default 30 seconds), maximum retries (default 2, applied to 429 and 5xx responses only), and the pinned API version. Configuration is immutable after creation in most SDKs; create a new client to change credentials.

## Common patterns

SDKs handle cursor pagination with iterators that fetch pages lazily, raise typed exceptions that expose the API `error.code`, attach an idempotency key automatically to retried writes, provide webhook signature verification helpers, and log the `request_id` on failures. Clients are safe to share across threads and reuse for the lifetime of your process.
