---
title: "What Happens When an HTTP Request Reaches the Server"
summary: "From the NIC's interrupt to your handler and back: DMA and softirqs, TCP reassembly into the socket buffer, epoll waking the event loop, the proxy hop, parsing and routing, a worker thread, the database call, and the response's path back through the kernel."
subjects: [os, cn]
order: 10
related: [os-syscalls-interrupts, os-epoll-event-loops, os-thread-pools, cn-proxies-load-balancers, cn-http-fundamentals, x-website-journey]
---

A `GET /orders` request (already decrypted by the load balancer) arrives at an application server over a keep-alive connection.

## [nic] Packets land in memory

The NIC receives the frames, checks CRCs, and **DMA**s them into ring buffers in RAM without CPU involvement. It raises an interrupt (coalesced: one interrupt per batch of packets).

## [kernel] Interrupt and softirq processing

The interrupt handler does almost nothing — it schedules a softirq. The NAPI poll loop then pulls packets off the ring, and the IP layer and TCP layer process them: checksum, find the socket by 4-tuple, place payload bytes in order into the socket's **receive buffer**, and send ACKs ([Syscalls & Interrupts](lesson:os-syscalls-interrupts)).

## [kernel] Wake the waiter

The socket becomes readable. Its wait queue callback adds it to the epoll instance's ready list and wakes the thread sleeping in `epoll_wait()` ([epoll](lesson:os-epoll-event-loops)).

## [server] Event loop reads the request

`epoll_wait()` returns the ready fd; the server calls `read()`/`recv()`, copying bytes from the kernel buffer into user space. The HTTP parser assembles the request line and headers; if the body is incomplete, it waits for more readiness events.

## [app] Routing and middleware

The framework matches `GET /orders` to a handler, runs middleware (request id, auth — verifying a session token, maybe a Redis lookup — rate limiting), and dispatches the handler: on the event loop (async frameworks) or onto a worker thread from a bounded pool ([Thread Pools](lesson:os-thread-pools)).

## [driver] Database call

The handler borrows a pooled connection and sends the query; the worker's thread or coroutine waits (blocking thread, or yields to the event loop). The database does its part ([SQL Execution](uth:sql-execution)).

## [app] Build the response

Rows come back; the handler serializes JSON, the framework adds headers (`Content-Type`, `Cache-Control`, compression), and writes the response.

## [kernel] The response goes out

`write()`/`send()` copies the bytes into the socket's send buffer and returns; TCP segments them within the congestion and receive windows, the NIC DMAs them out, and ACKs from the client free the buffer. Large files may use `sendfile()` to skip the user-space copy.

## [lb] Back through the proxy

The load balancer receives the response on its backend connection, forwards it over the client's connection (encrypting it with TLS), logs the request with its latency and status, and returns the backend connection to its pool ([Proxies & Load Balancers](lesson:cn-proxies-load-balancers)). The keep-alive connection stays open for the next request.
