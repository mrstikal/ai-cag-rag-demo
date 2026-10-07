---
id: audit-log
title: Audit Log
category: workspace
locale: en
status: active
valid_from: 2025-01-01
tags:
  - audit
  - security
  - compliance
---

# Audit Log

## What is logged

The audit log records security-relevant events, including sign-ins and failed sign-ins, SSO and SCIM configuration changes, member invitations and removals, role and permission changes, data exports, workspace setting updates, and ownership transfers. Each entry includes the actor, the action, the target, and a timestamp.

## Viewing the audit log

Admins can open the audit log from Settings > Security > Audit Log. Filter by date range, actor, event type, or target to narrow results. Entries are immutable, and searching does not modify them. Guest users cannot access the audit log.

## Exporting audit events

You can export filtered results as CSV or JSON for compliance reviews. Scheduled exports can be sent to a storage destination on Enterprise plans. An API is available for streaming events into a SIEM system. The export itself is recorded as an audit event.

## Retention

Audit logs are retained for 30 days on Free plans, 12 months on Team and Business plans, and up to five years on Enterprise plans. After the retention window, entries are deleted automatically. Data included in backups follows the backup retention cycle.
