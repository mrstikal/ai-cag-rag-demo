---
id: api-pagination
title: API Pagination
category: developers
locale: en
status: active
valid_from: 2025-01-01
tags:
  - api
  - pagination
  - lists
---

# API Pagination

## Cursor-based pagination

All list endpoints use cursor-based pagination. A response contains a `data` array and a `next_cursor` string; pass that cursor back as the `cursor` query parameter to retrieve the next page. When `next_cursor` is null you have reached the end of the collection. Cursors point at a stable position in a fixed sort order, so they remain correct even when records are created or deleted while you iterate.

## Page size limits

The `limit` parameter controls how many records a page contains. The default is 25 and the maximum is 100; values above 100 are clamped to the maximum, and values below 1 return 422. Individual endpoints may impose a lower ceiling, such as 50 for event logs. Changing `limit` between requests is allowed and does not invalidate an existing cursor.

## Iterating all results

To read a full collection, request the first page without a cursor, process the returned records, then follow `next_cursor` until it is null. Do not construct, decode, or modify cursor values: they are opaque, versioned, and may change format. Add a short delay between pages for very large exports, and prefer the asynchronous export endpoint when a collection exceeds roughly 100,000 records.
