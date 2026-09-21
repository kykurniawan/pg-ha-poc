# pg-ha-poc

A proof-of-concept PostgreSQL High Availability cluster using **Patroni** for automated failover and **etcd** as the distributed consensus store (DCS), fronted by **HAProxy** for read/write routing.

## Architecture

Each of the 3 nodes runs its own `etcd` member plus a `Patroni`-managed PostgreSQL instance:

| Node | etcd member | Postgres/Patroni | REST API |
|------|-------------|-------------------|----------|
| node-1 | etcd1 | pg-node1 | :8008 |
| node-2 | etcd2 | pg-node2 | :8008 |
| node-3 | etcd3 | pg-node3 | :8008 |

- **etcd** (3-member cluster) holds the leader lock and cluster state. Tolerates 1 node loss (needs 2/3 for quorum).
- **Patroni** on each node watches that lock, runs PostgreSQL, and promotes a replica to primary automatically if the current primary disappears.
- **HAProxy** exposes a single write endpoint (`:5432`, routes only to whichever node is currently primary via the `/primary` health check) and a load-balanced read endpoint (`:5433`, routes to replicas via `/replica`).

```mermaid
flowchart TB
    clients(["clients"]) --> haproxy

    subgraph haproxy["HAProxy"]
        write["5432 write - primary only"]
        read["5433 read - replicas round robin"]
        stats["7001 stats"]
    end

    subgraph node1["node-1"]
        etcd1["etcd1"]
        pgnode1["pg-node1"]
    end

    subgraph node2["node-2"]
        etcd2["etcd2"]
        pgnode2["pg-node2"]
    end

    subgraph node3["node-3"]
        etcd3["etcd3"]
        pgnode3["pg-node3"]
    end

    write --> pgnode1
    write --> pgnode2
    write --> pgnode3
    read --> pgnode1
    read --> pgnode2
    read --> pgnode3

    etcd1 <--> etcd2
    etcd2 <--> etcd3
    etcd1 <--> etcd3
```

Config split:
- `infrastructure/node-{1,2,3}/docker-compose.yml` — per-node etcd + Patroni/Postgres containers, identified only by `PATRONI_NAME`/`PATRONI_*_CONNECT_ADDRESS` env vars.
- `infrastructure/patroni-bootstrap.yml` — shared Patroni config mounted into every node. Holds the `bootstrap` section (initdb options, `pg_hba`, DCS timing) that Patroni can only read from a config file, never from `PATRONI_*` env vars.
- `infrastructure/haproxy.cfg` / `infrastructure/haproxy/docker-compose.yml` — routing + stats.

## Prerequisites

- Docker + Docker Compose
- `make`

## Quickstart

```bash
make create-network   # one-time: external docker network the nodes share
make up-all            # etcd1-3, pg-node1-3, haproxy
```

Bring individual pieces up/down:

```bash
make up-node-1 / down-node-1
make up-node-2 / down-node-2
make up-node-3 / down-node-3
make up-haproxy / down-haproxy
make down-all
```

Connect through HAProxy:

```bash
psql "postgresql://postgres:postgres_password@localhost:5432/postgres"  # writes → primary
psql "postgresql://postgres:postgres_password@localhost:5433/postgres"  # reads  → replicas
```

## Monitoring — which node is primary?

**HAProxy stats page** (browser, auto-refreshes every 5s):
http://localhost:7001/ — user `admin` / pass `admin`.
Whichever server is **UP** under `pg_write_back` is the current primary.

> Stats are published on host port **7001**, not 7000 — macOS's Control Center (AirPlay Receiver) permanently occupies port 7000 on all interfaces, so 7000 is unusable for local Docker port publishing on Mac.

**`patronictl list`** (CLI, names the role explicitly):

```bash
docker exec pg-node1 patronictl -c /tmp/patroni.yml list
```

```
+ Cluster: pg-cluster (7688036738653155347) ---+-----------+
| Member | Host     | Role    | State     | TL | Lag in MB |
+--------+----------+---------+-----------+----+-----------+
| node1  | pg-node1 | Replica | streaming |  1 |         0 |
| node2  | pg-node2 | Leader  | running   |  1 |           |
| node3  | pg-node3 | Replica | streaming |  1 |         0 |
+--------+----------+---------+-----------+----+-----------+
```

Can be run against any of the 3 nodes — they all read the same etcd-backed cluster state.

## Simulating failover

Stop the current primary's Postgres/Patroni process only, leaving its etcd member up:

```bash
docker stop pg-node2   # if node2 is currently the leader
```

This simulates a Postgres crash while the host/etcd stays reachable — the cleanest way to observe Patroni's failover logic in isolation. Watch it happen with `patronictl list` on a surviving node.

To simulate a full node/host failure instead (etcd member + Postgres both gone), stop the whole node stack, e.g. `make down-node-2`. Only ever take down **one** node's stack at a time — etcd needs 2 of 3 members for quorum; losing two nodes freezes the whole DCS and failover stops working entirely.

### Failover timing

Time-to-promote is governed by `infrastructure/patroni-bootstrap.yml`:

- `ttl` — how long the leader's lock lease lives in etcd before it's considered dead if not renewed. This is the dominant factor in failover time.
- `loop_wait` — how often each node's HA loop runs; bounds how quickly a replica notices the lock is free and grabs it.
- HAProxy's `inter`/`fall`/`rise` in `haproxy.cfg` add on top of that: time to mark the old primary DOWN, and time for the new primary to pass enough consecutive health checks to be marked UP.

Current profile is tuned for fast failover (`ttl: 10`, `loop_wait: 2`, `retry_timeout: 5`). Lower values fail over faster but make the cluster more sensitive to transient blips (brief network hiccups, GC pauses) triggering an unwanted failover — it's a real tradeoff, not free.

## Notes / gotchas

- The `ongres/patroni` image's default `CMD` is a bare `/bin/bash`, which exits immediately with no TTY — every node compose file must explicitly set `command: ["patroni", "/tmp/patroni.yml"]`.
- Patroni's `bootstrap` config section only loads from a config file (`PATRONI_CONFIGURATION` env var or a mounted YAML like `patroni-bootstrap.yml`); there is no `PATRONI_BOOTSTRAP_*` env var scheme, so without that file no node ever attempts `initdb`.
- The image doesn't create `/run/postgresql`, so `postgresql.parameters.unix_socket_directories` is pinned to `/tmp` in `patroni-bootstrap.yml`.
- Periodic `ConnectionResetError` warnings in `pg-node*` logs from HAProxy's IP are benign — HAProxy's `httpchk` only reads the HTTP status line and closes the connection before Patroni finishes writing the full JSON body.
