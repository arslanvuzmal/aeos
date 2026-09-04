# PG-Boss Architecture & Connection Pool Specification

## Overview
PG-Boss is a job queue for Node.js built on top of PostgreSQL, utilizing SKIP LOCKED for ultra-high concurrency and zero-lock contention worker processing.

## Connection Pool Settings
- `max`: Set pool maximum between 10 and 50 connections depending on vCPU capacity.
- `idleTimeoutMillis`: 30000 ms.
- `connectionTimeoutMillis`: 5000 ms.
- `schema`: Default to `pgboss` isolated schema to prevent pollution of domain tables.

## Retention & Archival Invariants
Completed jobs must be archived with `archiveCompletedJobsEvery: 3600` (1 hour) and purged via `deleteArchivedJobsEvery: 86400` (24 hours) to eliminate dead tuple bloat on active queue tables.
