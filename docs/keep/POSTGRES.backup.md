
# High-Availability PostgreSQL Cluster: pgBackRest, Monitoring & Recovery Runbook

This document details the configuration, SSH authorization, automated backup runner with email notifications, log rotation, cleanup practices, and the procedure for performing a non-disruptive test restore.

---

## 1. Infrastructure Architecture

* **Database Nodes (Patroni Cluster):**
  * `APDB1`: `196.251.146.221` (Primary / Leader)
  * `APDB2`: `196.251.146.222` (Standby / Replica)
  * `APDB3`: `196.251.146.223` (Standby / Replica)
* **Backup Repository Host:**
  * `DB1`: `196.251.144.14` (Dedicated pgBackRest Server)
* **Database Version:** PostgreSQL 15
* **Stanza Name:** `cluster`

---

## 2. Key Configurations

### A. Backup Server Configuration (`DB1`)

File: `/var/lib/postgresql/pgbackrest.conf` (or `/etc/pgbackrest.conf`)

```ini
[global]
repo1-path=/var/lib/pgbackrest
repo1-type=posix
repo1-retention-full=4
repo1-retention-diff=14
process-max=4
log-level-console=info
log-level-file=detail
start-fast=y
compress-type=zst
compress-level=3

[cluster]
pg1-host=196.251.146.221
pg1-host-user=postgres
pg1-path=/var/lib/postgresql/15/main

pg2-host=196.251.146.222
pg2-host-user=postgres
pg2-path=/var/lib/postgresql/15/main

pg3-host=196.251.146.223
pg3-host-user=postgres
pg3-path=/var/lib/postgresql/15/main
```
