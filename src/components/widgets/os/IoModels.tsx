"use client";
import { useState } from "react";
import { Explain, Panel, Segmented, Stat, StepControls, useStepper } from "../ui";
import { cn } from "@/lib/utils";

type Model = "blocking" | "nonblocking" | "epoll" | "iouring";

interface Msg {
  from: "app" | "kernel";
  text: string;
  note?: string;
  wait?: "app-blocked" | "app-free";
}

const FLOWS: Record<Model, { title: string; msgs: Msg[]; summary: string }> = {
  blocking: {
    title: "Blocking read()",
    summary: "Simple straight-line code, but the thread is parked for the whole wait. N connections → N threads.",
    msgs: [
      { from: "app", text: "read(sock, buf, 4096)", note: "system call" },
      { from: "kernel", text: "socket buffer empty → put thread on socket wait queue", wait: "app-blocked" },
      { from: "kernel", text: "… packet arrives (NIC interrupt → TCP stack → socket buffer) …", wait: "app-blocked" },
      { from: "kernel", text: "wake thread; copy data kernel → user buffer", wait: "app-blocked" },
      { from: "kernel", text: "return n bytes", note: "thread resumes" },
    ],
  },
  nonblocking: {
    title: "Non-blocking read() + polling",
    summary: "Never sleeps, but spinning on EAGAIN wastes CPU and each attempt is a syscall. Useful only when paired with a readiness mechanism.",
    msgs: [
      { from: "app", text: "read(sock) [O_NONBLOCK]" },
      { from: "kernel", text: "−1, errno = EAGAIN (no data)", wait: "app-free" },
      { from: "app", text: "…do other work… read(sock) again" },
      { from: "kernel", text: "−1, EAGAIN", wait: "app-free" },
      { from: "app", text: "read(sock) again" },
      { from: "kernel", text: "data present: copy kernel → user, return n", note: "copy still on the app's time" },
    ],
  },
  epoll: {
    title: "I/O multiplexing with epoll",
    summary: "One thread waits on thousands of sockets at once and only touches the ready ones. Still synchronous: the app performs the read (copy) itself.",
    msgs: [
      { from: "app", text: "epoll_ctl(ADD sock1…sock10000) — once" },
      { from: "app", text: "epoll_wait(ep, events, 128, -1)" },
      { from: "kernel", text: "sleep until ANY registered fd becomes ready", wait: "app-blocked" },
      { from: "kernel", text: "packet on sock742 → callback adds it to the ready list → wake" },
      { from: "kernel", text: "return [sock742 readable]" },
      { from: "app", text: "read(sock742) — non-blocking, data is there" },
      { from: "kernel", text: "copy kernel → user, return n", note: "then back to epoll_wait" },
    ],
  },
  iouring: {
    title: "Asynchronous I/O with io_uring",
    summary: "Completion-based: the app describes the I/O and moves on; the kernel does the wait AND the copy, then posts a completion. Works for files too.",
    msgs: [
      { from: "app", text: "write SQE: recv(sock, buf, 4096) into the submission ring" },
      { from: "app", text: "io_uring_enter(submit=1) — or no syscall at all with SQPOLL" },
      { from: "app", text: "…continues other work, submits more requests…", wait: "app-free" },
      { from: "kernel", text: "data arrives → kernel copies directly into buf", wait: "app-free" },
      { from: "kernel", text: "post CQE {user_data, res = n} to the completion ring" },
      { from: "app", text: "reap CQE: buf already holds the data", note: "no read() call needed" },
    ],
  },
};

const PER_THREAD_KB = 64; // typical resident stack + kernel structures for an idle blocked thread (order of magnitude)

export default function IoModels() {
  const [model, setModel] = useState<Model>("blocking");
  const flow = FLOWS[model];
  const s = useStepper(flow.msgs.length, { interval: 1300 });
  const [conns, setConns] = useState(10000);

  const threads = model === "blocking" ? conns : model === "nonblocking" ? Math.min(conns, 8) : 8;
  const memMB = Math.round((threads * PER_THREAD_KB) / 1024);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="I/O model"
          value={model}
          onChange={(m) => {
            setModel(m);
            s.reset();
          }}
          options={[
            { value: "blocking", label: "Blocking" },
            { value: "nonblocking", label: "Non-blocking" },
            { value: "epoll", label: "epoll" },
            { value: "iouring", label: "io_uring" },
          ]}
        />
        <StepControls s={s} total={flow.msgs.length} />
      </div>

      <Panel title={flow.title}>
        <div className="grid grid-cols-[1fr_1fr] gap-x-4 text-[12px] font-semibold tracking-wide text-subtle uppercase">
          <div className="border-b border-border pb-1">Application thread</div>
          <div className="border-b border-border pb-1">Kernel</div>
        </div>
        <ol className="mt-2 space-y-1.5">
          {flow.msgs.map((m, i) => {
            const vis = i <= s.step;
            return (
              <li key={i} className={cn("grid grid-cols-[1fr_1fr] gap-x-4 transition-opacity", vis ? "opacity-100" : "opacity-20")}>
                <div>
                  {m.from === "app" ? (
                    <div className={cn("rounded-lg border px-3 py-1.5 font-mono text-[12.5px]", i === s.step ? "border-accent bg-accent/10" : "border-border bg-surface-2")}>{m.text}</div>
                  ) : m.wait === "app-blocked" ? (
                    <div className="rounded-lg border border-dashed border-warn/60 bg-warn/5 px-3 py-1.5 text-[12px] text-warn">thread blocked — using no CPU, but holding a stack</div>
                  ) : m.wait === "app-free" ? (
                    <div className="rounded-lg border border-dashed border-ok/60 bg-ok/5 px-3 py-1.5 text-[12px] text-ok">thread free to do other work</div>
                  ) : null}
                </div>
                <div>
                  {m.from === "kernel" && (
                    <div className={cn("rounded-lg border px-3 py-1.5 font-mono text-[12.5px]", i === s.step ? "border-accent bg-accent/10" : "border-border bg-surface-2")}>{m.text}</div>
                  )}
                  {m.note && <div className="mt-0.5 text-[11.5px] text-subtle">{m.note}</div>}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-4">
          <Explain>{flow.summary}</Explain>
        </div>
      </Panel>

      <Panel title="Scaling to many connections">
        <label className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
          Concurrent (mostly idle) connections:
          <input type="range" min={10} max={100000} step={10} value={conns} onChange={(e) => setConns(Number(e.target.value))} className="w-56 accent-[var(--accent)]" />
          <span className="font-mono text-fg">{conns.toLocaleString()}</span>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Threads needed" value={threads.toLocaleString()} sub={model === "blocking" ? "one per connection" : "≈ one per core"} />
          <Stat label="Thread memory" value={`~${memMB.toLocaleString()} MB`} sub={`~${PER_THREAD_KB} KB resident per idle thread`} />
          <Stat
            label="Wakeups per event"
            value={model === "nonblocking" ? "polling!" : "1"}
            sub={model === "nonblocking" ? "CPU burned on EAGAIN" : model === "blocking" ? "context switch per event" : "batched per wait"}
          />
        </div>
        <p className="mt-2 text-[12px] text-subtle">Order-of-magnitude illustration; exact per-thread cost depends on stack usage and kernel structures.</p>
      </Panel>
    </div>
  );
}
