---
title: "What Happens When a Server Opens a Listening Socket"
summary: "socket(), bind(), listen(), accept() and epoll: the kernel objects behind a file descriptor, the SYN and accept queues, and how a single thread learns that thousands of connections are ready."
subjects: [os, cn]
order: 6
related: [cn-sockets, os-file-descriptors, os-epoll-event-loops, cn-tcp-handshake, os-io-models, os-syscalls-interrupts]
---

A web server starts and prepares to accept connections on port 8080.

## [app] socket(AF_INET, SOCK_STREAM, 0)

The application asks for a TCP socket. The kernel allocates a socket structure with TCP protocol state (CLOSED), send/receive buffers, and a `struct file`, and returns the lowest free **file descriptor** number (say 3) — an index into the process's descriptor table ([File Descriptors](lesson:os-file-descriptors)).

## [app] setsockopt(SO_REUSEADDR)

Allows binding the port even if old connections from a previous run are in TIME_WAIT, so restarts don't fail with "address already in use". (`SO_REUSEPORT` would let several processes bind the same port with kernel load balancing.)

## [kernel] bind(3, 0.0.0.0:8080)

The kernel checks the port isn't in use (and that the process may bind ports below 1024 if applicable), then records the local address in the socket and in the TCP lookup tables.

## [kernel] listen(3, backlog = 4096)

The socket moves to the LISTEN state. The kernel now completes handshakes on its own: incoming SYNs get SYN-ACKs; half-open connections wait in the **SYN queue**; completed ones move to the **accept queue**, bounded by the backlog (and `net.core.somaxconn`). No application code runs for any of this ([TCP Handshake](lesson:cn-tcp-handshake)).

## [app] epoll_create1() and epoll_ctl(ADD, 3, EPOLLIN)

The server creates an epoll instance (another fd) and registers the listening socket for readability. The kernel attaches a callback to the socket's wait queue so that events append the socket to epoll's **ready list** ([epoll & Event Loops](lesson:os-epoll-event-loops)).

## [scheduler] epoll_wait() — sleep

The event-loop thread calls `epoll_wait()`; the ready list is empty, so the thread sleeps. It uses no CPU while waiting.

## [nic] A client connects

SYN arrives → NIC interrupt → kernel TCP replies SYN-ACK → client's ACK arrives → connection complete, placed in the accept queue. The listening socket becomes readable; its epoll callback adds it to the ready list and wakes the sleeping thread.

## [app] accept4() — a new descriptor

`epoll_wait()` returns "fd 3 readable". The server calls `accept4(3, …, SOCK_NONBLOCK)`, which dequeues the connection and returns a **new** descriptor (say 7) representing this one connection (ESTABLISHED), then registers fd 7 with epoll for reads. The listening socket keeps listening.

## [app] One thread, thousands of connections

The loop repeats: `epoll_wait()` returns only the descriptors that are ready; the server reads/writes them without blocking and goes back to waiting. The cost scales with active connections, not total connections — how a single thread handles tens of thousands of sockets. If the application can't accept fast enough, the accept queue fills and new SYNs are dropped (visible in `ss -lnt` Recv-Q and `netstat -s` "listen queue overflows").
