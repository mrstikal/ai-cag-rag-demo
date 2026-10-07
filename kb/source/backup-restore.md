---
id: backup-restore
title: Backups and Restore
category: data
locale: en
status: active
valid_from: 2025-01-01
tags:
  - data
  - backup
  - recovery
---

# Backups and Restore

## Automatic backups

DemoDesk runs automatic backups of all workspaces. Incremental backups are taken every six hours, and a full backup is taken weekly. Backups are encrypted at rest and stored in the workspace's data region. No action is required from you to enable them.

## Retention of backups

Incremental backups are retained for 30 days, and weekly full backups for 90 days. Retention windows may be longer on Enterprise plans. When a backup reaches the end of its window it is destroyed automatically.

## Restoring data

Admins can restore individual items from trash for 30 days after deletion. For larger recoveries, contact support with the workspace ID and the time range to restore. We aim to start restore jobs within one business day. Restores are performed from the most recent suitable backup.

## Restore limitations

Restores are point-in-time and replace the current state of the affected data, so changes made after the backup are not included. We cannot restore a single field inside an item. Audit log entries created after the backup are preserved separately. Restores across regions are not supported; data is restored in its original region.
