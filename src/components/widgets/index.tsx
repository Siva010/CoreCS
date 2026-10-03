"use client";
// Maps widget ids (see src/lib/registry.ts) to lazily-loaded components, so a
// lesson only downloads the code for the widgets it actually embeds.
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

function Loading() {
  return <div className="h-64 animate-pulse rounded-xl bg-surface-2" aria-label="Loading interactive widget" />;
}

const lazy = (loader: () => Promise<{ default: ComponentType }>) => dynamic(loader, { ssr: false, loading: Loading });

const WIDGETS: Record<string, ComponentType> = {
  // Operating systems
  "process-lifecycle": lazy(() => import("./os/ProcessLifecycle")),
  "context-switch": lazy(() => import("./os/ContextSwitch")),
  "race-condition": lazy(() => import("./os/RaceCondition")),
  "cpu-scheduler": lazy(() => import("./os/CpuScheduler")),
  "address-translation": lazy(() => import("./os/AddressTranslation")),
  "page-replacement": lazy(() => import("./os/PageReplacement")),
  "memory-allocator": lazy(() => import("./os/MemoryAllocator")),
  bankers: lazy(() => import("./os/Bankers")),
  "deadlock-graph": lazy(() => import("./os/DeadlockGraph")),
  "producer-consumer": lazy(() => import("./os/ProducerConsumer")),
  "disk-scheduling": lazy(() => import("./os/DiskScheduling")),
  "io-models": lazy(() => import("./os/IoModels")),
  // Computer networks
  encapsulation: lazy(() => import("./cn/Encapsulation")),
  "tcp-handshake": lazy(() => import("./cn/TcpHandshake")),
  "sliding-window": lazy(() => import("./cn/SlidingWindow")),
  congestion: lazy(() => import("./cn/Congestion")),
  "dns-resolver": lazy(() => import("./cn/DnsResolver")),
  "tls-handshake": lazy(() => import("./cn/TlsHandshake")),
  "subnet-calculator": lazy(() => import("./cn/SubnetCalculator")),
  routing: lazy(() => import("./cn/Routing")),
  "http-cache": lazy(() => import("./cn/HttpCache")),
  "realtime-transports": lazy(() => import("./cn/RealtimeTransports")),
  "network-calculator": lazy(() => import("./cn/NetworkCalculator")),
  "hol-blocking": lazy(() => import("./cn/HolBlocking")),
  // Databases
  "sql-playground": lazy(() => import("./db/SqlPlayground")),
  "query-plan": lazy(() => import("./db/QueryPlan")),
  btree: lazy(() => import("./db/BTree")),
  "sql-joins": lazy(() => import("./db/JoinTypes")),
  "join-algorithms": lazy(() => import("./db/JoinAlgorithms")),
  isolation: lazy(() => import("./db/Isolation")),
  "db-locks": lazy(() => import("./db/DbLocks")),
  "wal-recovery": lazy(() => import("./db/WalRecovery")),
  replication: lazy(() => import("./db/Replication")),
  "consistent-hashing": lazy(() => import("./db/ConsistentHashing")),
  quorum: lazy(() => import("./db/Quorum")),
  lsm: lazy(() => import("./db/Lsm")),
  normalization: lazy(() => import("./db/Normalization")),
};

export function WidgetById({ id }: { id: string }) {
  const C = WIDGETS[id];
  if (!C) {
    return (
      <div className="grid h-40 place-items-center rounded-xl border border-dashed border-border text-sm text-subtle">
        Interactive widget “{id}” is not available yet.
      </div>
    );
  }
  return <C />;
}
