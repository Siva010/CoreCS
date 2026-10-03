import { PageHeader } from "@/components/ui/badges";

export const metadata = { title: "About & sources" };

const SOURCES: [string, string[]][] = [
  [
    "Operating systems",
    [
      "Arpaci-Dusseau & Arpaci-Dusseau, Operating Systems: Three Easy Pieces (OSTEP)",
      "Silberschatz, Galvin & Gagne, Operating System Concepts",
      "Bovet & Cesati, Understanding the Linux Kernel; the Linux kernel documentation (kernel.org/doc) and man-pages",
      "Brendan Gregg, Systems Performance (2nd ed.) and the USE method",
      "Drepper, What Every Programmer Should Know About Memory",
    ],
  ],
  [
    "Computer networks",
    [
      "Kurose & Ross, Computer Networking: A Top-Down Approach",
      "RFC 9293 (TCP), RFC 5681 (TCP congestion control), RFC 6298 (RTO), RFC 7323 (window scaling), RFC 2018 (SACK)",
      "RFC 1034/1035 (DNS), RFC 9110/9111/9112 (HTTP semantics, caching, HTTP/1.1), RFC 9113 (HTTP/2), RFC 9000/9114 (QUIC, HTTP/3)",
      "RFC 8446 (TLS 1.3), RFC 5280 (X.509), RFC 6797 (HSTS), RFC 6455 (WebSocket)",
      "Ilya Grigorik, High Performance Browser Networking",
    ],
  ],
  [
    "Databases",
    [
      "Kleppmann, Designing Data-Intensive Applications",
      "Petrov, Database Internals",
      "Ramakrishnan & Gehrke, Database Management Systems; Silberschatz, Korth & Sudarshan, Database System Concepts",
      "PostgreSQL documentation (MVCC, transaction isolation, EXPLAIN, indexes, WAL) and MySQL/InnoDB reference manual",
      "Mohan et al., ARIES (1992); Berenson et al., A Critique of ANSI SQL Isolation Levels (1995); Cahill et al., Serializable Isolation for Snapshot Databases (2008)",
      "Ongaro & Ousterhout, In Search of an Understandable Consensus Algorithm (Raft); DeCandia et al., Dynamo (2007); Corbett et al., Spanner (2012)",
    ],
  ],
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow="About"
        title="How this academy is built"
        description="Explanations are written from the underlying mechanisms and checked against primary sources — RFCs, official documentation, textbooks and the original papers — then rewritten as engineering explanations rather than copied definitions."
      />
      <div className="prose prose-academy">
        <h2>Principles</h2>
        <ul>
          <li>Every concept page answers what, why, how, trade-offs, failure modes, production usage, interview angle and deeper connections.</li>
          <li>The curriculum is a dependency graph. Every lesson declares its prerequisites; a validator checks the graph for missing references and cycles on every build.</li>
          <li>Depth is explicit: 🟢 Beginner, 🔵 Interview Core, 🟣 Advanced, 🔴 Senior Touch. Stop where your target role stops.</li>
          <li>Specific version claims are kept to stable facts (e.g., TLS 1.3 handshake structure, PostgreSQL&apos;s snapshot-based Repeatable Read). Where behavior differs by engine or version, lessons say so.</li>
          <li>No claim that studying advanced material makes someone senior. Conceptual exposure and production experience are different things.</li>
        </ul>
        <h2>Primary references</h2>
        {SOURCES.map(([title, items]) => (
          <div key={title}>
            <h3>{title}</h3>
            <ul>
              {items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        ))}
        <h2>Privacy</h2>
        <p>
          There are no accounts and no tracking. Your progress, grades, bookmarks and history live in your browser&apos;s localStorage. The SQL labs run PostgreSQL entirely
          inside your browser via WebAssembly (PGlite); your queries never leave your machine.
        </p>
      </div>
    </div>
  );
}
