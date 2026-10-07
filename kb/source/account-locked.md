---
id: account-locked
title: Locked Accounts
category: account
locale: en
status: active
valid_from: 2025-06-01
tags:
  - account
  - security
  - lockout
---

# Locked Accounts

## Why accounts get locked
DemoDesk temporarily locks an account after ten failed sign-in attempts within fifteen minutes. Locking protects your workspace from password guessing and credential-stuffing attacks. A lock is triggered by failed passwords only; it is unrelated to billing or policy reviews.

## Automatic unlock window
Most locks clear automatically after 30 minutes. During the lock window, even the correct password is rejected, and password reset emails are paused for that address. This behavior is intentional: it prevents attackers from using a lockout to confirm that an account exists.

## Manual unlock
If you cannot wait for the automatic window, a workspace administrator can unlock a member from **Members > More > Unlock**. Administrators can also shorten the lock window for their whole workspace under **Settings > Security**. If no administrator is available, contact support, confirm the account email, and support will release the lock after verifying ownership.
