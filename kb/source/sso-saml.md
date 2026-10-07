---
id: sso-saml
title: SSO with SAML
category: workspace
locale: en
status: active
valid_from: 2025-01-01
tags:
  - sso
  - saml
  - security
---

# SSO with SAML

## Enabling SAML SSO

SAML single sign-on is available on Business and Enterprise plans. An admin starts from Settings > Security > SSO, verifies ownership of the company domain, and downloads our service provider metadata. Once configured, you can require SSO for all members of the domain. Keep at least one password-based admin account as a recovery path.

## Identity provider configuration

In your identity provider, create a SAML application and paste our Entity ID and ACS URL from the SSO settings page. Map the email, first name, and last name attributes. Upload the IdP metadata or enter the certificate and sign-on URL manually. Save, then run the test button to confirm a successful assertion.

## Just-in-time provisioning

When just-in-time provisioning is enabled, accounts are created the first time a user signs in through SSO. The new member receives the default role you configure, usually member. You can restrict creation to verified domains so outsiders cannot self-provision. SCIM is recommended when you also need automatic deprovisioning.

## Troubleshooting SSO

Common issues include expired IdP certificates, mismatched attribute names, and clock skew on the IdP server. Test failures usually report the exact SAML error code. If you lock yourself out after enforcing SSO, use a break-glass admin account or contact support to disable enforcement.
