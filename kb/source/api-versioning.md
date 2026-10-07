---
id: api-versioning
title: API Versioning
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - api
  - versioning
  - compatibility
---

# API Versioning

## Version header

API behavior is pinned with the `DemoDesk-Version` header, whose value is a date such as `2025-03-01`. A version is a stable snapshot of request and response shapes and error semantics. Requests that omit the header use the workspace's default version, which admins set in Settings > Developer. Official SDKs send a pinned version automatically and expose it as a client option.

## Deprecation policy

Versions are supported for at least twelve months after a deprecation announcement, and most live considerably longer. Announcements are sent to workspace admins, recorded in the changelog, and surfaced through a `DemoDesk-Deprecation` response header on affected versions. Endpoints set a `Sunset` header once a removal date is fixed. Plan migrations early; the twelve-month floor is a minimum, not a guarantee.

## Breaking changes

Adding a new endpoint, field, enum member, or optional parameter is not a breaking change, so clients must tolerate unknown fields. Removing a field, changing a type, altering validation strictness, or changing error codes is breaking and only ships in a new version. Test upgrades in the sandbox by pointing test credentials at the preview version before updating production traffic.
