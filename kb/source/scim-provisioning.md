---
id: scim-provisioning
title: SCIM Provisioning
category: workspace
locale: en
status: active
valid_from: 2025-01-01
tags:
  - scim
  - provisioning
  - sso
---

# SCIM Provisioning

## What SCIM does

SCIM keeps your workspace membership in sync with your identity provider. When you assign a user or group in your IdP, DemoDesk creates or updates the matching account and role. When you unassign them, access is revoked automatically. This removes the manual work of inviting and removing members.

## Connecting your IdP

SCIM is available on Business and Enterprise plans with SSO enabled. Generate a SCIM token from Settings > Security > SSO > Provisioning and paste the base URL and token into your IdP. We provide setup guides for common providers including Okta and Microsoft Entra ID. Use the test connection button to verify the token before enabling sync.

## Deprovisioning users

When a user is unassigned or deactivated in the IdP, SCIM deactivates their DemoDesk account and ends active sessions. Content they created remains in the workspace; reassign it before the account is deactivated if needed. Group memberships sync continuously, so role changes made in the IdP apply within minutes. Deprovisioning events appear in the audit log.
