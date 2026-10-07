---
id: two-factor-auth
title: Two-Factor Authentication
category: account
locale: en
status: active
valid_from: 2025-06-01
tags:
  - security
  - 2fa
  - login
---

# Two-Factor Authentication

## Enabling two-factor authentication
Two-factor authentication (2FA) adds a second step to sign-in. Open **Settings > Security** and select **Enable 2FA**. DemoDesk supports authenticator apps and hardware security keys. Enabling 2FA is strongly recommended for administrators and for any account with access to billing.

## Authenticator apps
Install a TOTP authenticator app such as Google Authenticator, Authy, or 1Password on your mobile device. Scan the QR code shown in settings, then enter the six-digit code to confirm pairing. Codes rotate every 30 seconds. If your device's clock is inaccurate, codes may be rejected; enable automatic time sync in your device settings.

## Backup codes
When you enable 2FA, DemoDesk generates ten single-use backup codes. Store them in a password manager or print them and keep them somewhere secure. Each code works once, and the list can be regenerated from **Settings > Security** if you use it up or believe it was exposed.

## Recovering access when two-factor authentication is unavailable
If you no longer have access to your verification device — for example, you replaced your mobile device and your authenticator app is gone — you have two options. First, sign in with your password and select **Use a backup code**; enter one of the saved codes to complete sign-in, then re-enroll 2FA with your new device. Second, if no backup codes remain, contact support. Support verifies your identity through your account email, your recent billing details, and the workspace name before removing 2FA from the account.
