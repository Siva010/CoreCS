---
title: "Container and Kubernetes Networking: Namespaces, veth, Bridges, Overlays and Services"
subject: cn
level: 11
order: 3
summary: "How a container gets its own network stack, how packets leave it (veth pairs, bridges, NAT), how pods on different nodes reach each other (routing vs overlays), and how Kubernetes Services, DNS and Ingress fit on top."
depth: senior
difficulty: 4
minutes: 45
relevance: medium
stage: 4
prerequisites: [cn-nat, cn-routing, os-virtualization-containers]
related: [cn-service-networking, cn-mtu-congestion, cn-ethernet-switching, cn-dns-fundamentals]
tags: [network namespace, veth, linux bridge, docker networking, port publishing, overlay network, vxlan, cni, calico, cilium, flannel, kube-proxy, iptables, ipvs, ebpf, clusterip, nodeport, loadbalancer, ingress, coredns, ndots]
---

## Mental Model

A container's **network namespace** is a **private network stack in a box**: its own interfaces, routing table, iptables rules and `localhost`. To connect the box to the world, you run a **virtual cable** (a **veth pair**) from inside the box to the host. The host end plugs into a **virtual switch** (a Linux bridge) or is routed directly, and traffic leaving the host goes through **NAT**.

Kubernetes adds one rule that shapes everything: **every pod gets its own IP, and every pod can reach every other pod without NAT**, on any node. How the underlying network achieves that (routing, overlays, eBPF) is the CNI plugin's job. On top, **Services** give stable virtual IPs and DNS names to changing sets of pods.

## Definition

- **Network namespace**: a Linux kernel feature giving processes an isolated network stack ([VMs & Containers](lesson:os-virtualization-containers)).
- **veth pair**: two virtual interfaces connected back-to-back; packets entering one exit the other.
- **Linux bridge**: a software Layer-2 switch (e.g., `docker0`, `cni0`).
- **Overlay network**: encapsulating pod traffic inside host-to-host packets (VXLAN, Geneve, IP-in-IP) so pod IPs don't need to be routable on the physical network.
- **CNI (Container Network Interface)**: the plugin standard Kubernetes uses to wire pod networking (Calico, Cilium, Flannel, cloud VPC CNIs).
- **Service types**: ClusterIP (internal VIP), NodePort (port on every node), LoadBalancer (cloud LB), plus **Ingress/Gateway API** for L7 HTTP routing.

## Why It Exists

**The problem.** Containers need isolation (their own ports and IPs, no port conflicts) and connectivity (to each other, to the host, to the internet), at high density and with constantly changing membership. Those two goals pull in opposite directions.

**The idea.** Give each container its own complete, private network stack (a namespace) — that solves isolation. Then connect the stacks back together with the ordinary building blocks from earlier lessons, just in software: virtual cables (veth), a virtual switch (bridge), routes, NAT and tunnels. Kubernetes' flat pod network makes service-to-service communication simple for applications.

:::callout[That's all it is]{type=insight}
Each container gets a private network stack; a virtual cable connects it to the host; the host switches, routes or tunnels packets between containers and NATs them to the outside. A Kubernetes Service IP is just a NAT rule that picks a pod.
:::

## How It Works

### Single host: Docker bridge networking

```text
 container A netns            container B netns
 eth0 172.17.0.2              eth0 172.17.0.3
     │ veth                        │ veth
     └──────────┬──────────────────┘
            docker0 bridge 172.17.0.1  (host)
                │ routing + iptables MASQUERADE
              eth0 (host, 192.168.1.50) → internet
```

- Container-to-container on the same bridge: L2 switching.
- Container → internet: routed via the bridge, **SNAT/masquerade** to the host IP ([NAT](lesson:cn-nat)).
- Internet → container: **port publishing** `-p 8080:80` = a **DNAT** rule from host:8080 to 172.17.0.2:80.

### Multi-node: pod-to-pod across nodes

On one host, a bridge is enough. Across hosts, the physical network doesn't know pod addresses exist — so either teach it (routing) or hide pod packets inside host packets (overlay). Two main approaches:

| | Routed (no encapsulation) | Overlay (encapsulation) |
|---|---|---|
| How | Each node owns a pod CIDR; routes for other nodes' pod CIDRs installed (BGP with Calico, cloud route tables, or cloud VPC-native pod IPs) | Pod packet wrapped in VXLAN/Geneve (UDP) between node IPs |
| MTU | Full | Reduced (e.g., 1,450 with VXLAN) ([MTU](lesson:cn-mtu-congestion)) |
| Performance | Better (no encap/decap) | Encapsulation CPU cost (offloads help) |
| Requirements | Underlay must route pod CIDRs | Works over any IP network |

Cloud "VPC-native" CNIs (AWS VPC CNI, GKE VPC-native) give pods real VPC IPs — no overlay, but pods consume subnet addresses ([Subnetting](lesson:cn-subnetting)).

### Services: stable virtual IPs

Pods die and get new IPs constantly, so clients can't use pod IPs directly. A Service gives them one address that never changes and quietly maps each new connection to a current pod.

```mermaid
%%{init: {"sequence": {"width": 100, "actorMargin": 20}}}%%
sequenceDiagram
    participant C as Client pod
    participant DNS as CoreDNS
    participant K as kube-proxy rules<br/>on client node
    participant P as Backend pod<br/>10.244.3.17
    C->>DNS: A? payments.prod.svc.<br/>cluster.local
    DNS-->>C: 10.96.41.12<br/>(ClusterIP)
    C->>K: SYN to 10.96.41.12:80
    Note over K: DNAT to a ready endpoint<br/>chosen at connection start
    K->>P: SYN to 10.244.3.17:8080
    P-->>C: SYN-ACK (reverse NAT via conntrack)
```

- The ClusterIP isn't assigned to any interface — it only exists as NAT rules (iptables/IPVS) or eBPF maps on every node.
- Balancing happens **per connection** at SYN time.
- **NodePort** exposes the service on a port of every node; **LoadBalancer** provisions a cloud LB pointing at node ports (or directly at pod IPs).
- **Ingress / Gateway API** controllers (Nginx, Envoy-based) do L7 routing by host/path into Services.

### Cluster DNS

CoreDNS answers `service.namespace.svc.cluster.local`. Pods' `/etc/resolv.conf` includes search domains and `options ndots:5`: any name with fewer than 5 dots is first tried with each search suffix. So resolving `api.stripe.com` may generate several NXDOMAIN lookups first (`api.stripe.com.default.svc.cluster.local`, …), multiplying DNS load and latency. Fixes: fully qualified names with a trailing dot, lower `ndots`, NodeLocal DNSCache ([DNS](lesson:cn-dns-fundamentals)).

## Internal Mechanism

:::depth{level=senior}
### iptables vs IPVS vs eBPF

kube-proxy in **iptables** mode creates chains per service and endpoint; with tens of thousands of services, rule updates and per-packet chain traversal become slow (sequential probability-based matching). **IPVS** uses in-kernel hash tables — O(1) lookups and more algorithms. **eBPF** data planes (Cilium) replace kube-proxy entirely with hash-map lookups at the socket or TC layer, enabling socket-level load balancing (translate at `connect()` time, no per-packet NAT), better observability and network policy enforcement.

### Conntrack pressure

Every Service connection creates conntrack entries on the node; high connection churn (short-lived HTTP/1.0-style calls, DNS over UDP) can fill `nf_conntrack_max` → dropped packets. UDP DNS through DNAT has also suffered races (conntrack insertion conflicts) causing sporadic 5-second DNS timeouts — a famous Kubernetes issue mitigated by NodeLocal DNSCache and kernel fixes.

### NetworkPolicy

By default all pods can talk to all pods. **NetworkPolicy** objects (enforced by the CNI) restrict ingress/egress by labels, namespaces and ports — the Kubernetes firewall. Start with default-deny per namespace and explicit allows.
:::

## Example

Inspecting the plumbing on a node:

```bash
$ ip netns list                      # (docker/containerd namespaces may need nsenter)
$ nsenter -t <pid> -n ip addr        # the container's interfaces
3: eth0@if27: <...> mtu 1450 inet 10.244.2.9/24
$ ip link | grep -A1 "^27:"          # host side of the veth pair
27: vethc3a1@if3: <...> master cni0
$ iptables -t nat -L KUBE-SERVICES | grep payments
KUBE-SVC-XYZ  tcp -- 0.0.0.0/0  10.96.41.12  /* prod/payments cluster IP */ tcp dpt:80
$ conntrack -S                       # insert_failed / drop counters
```

## Complexity & Performance

- Same-node pod traffic: veth + bridge — microseconds.
- Cross-node: + routing or encapsulation; overlay costs CPU and MTU.
- Service translation cost: iptables O(rules) per new connection vs IPVS/eBPF O(1).

## Trade-offs

- Overlays: work anywhere, simpler underlay vs MTU and encap overhead.
- VPC-native IPs: performance and direct routability vs IP address consumption.
- kube-proxy iptables: simple, default vs scaling limits; eBPF: performance/features vs newer kernels and complexity.

## Failure Modes

- MTU mismatches in overlays (large responses hang).
- Conntrack table exhaustion and UDP DNS races.
- DNS latency from `ndots` search expansion; CoreDNS overload.
- Pod IP exhaustion in VPC-native setups.
- Uneven balancing for long-lived connections through ClusterIPs.
- Missing NetworkPolicies (flat, fully open cluster network).

## In Production

- Choose the CNI deliberately (performance, policy, observability, IP planning); size pod CIDRs and subnets for growth.
- Monitor CoreDNS latency/errors, conntrack usage, and per-node network drops.

## Deeper Connections

- Namespaces and cgroups: [VMs & Containers](lesson:os-virtualization-containers). NAT and conntrack: [NAT](lesson:cn-nat). L2 bridges: [Ethernet & Switching](lesson:cn-ethernet-switching). Mesh on top: [Service Networking](lesson:cn-service-networking).

## Common Misconceptions

- **"A ClusterIP is a real interface or load balancer."** It's NAT rules/eBPF maps on every node.
- **"Services load-balance each request."** kube-proxy balances connections.
- **"Containers get network isolation automatically from other containers."** They get separate stacks, but connectivity is open unless NetworkPolicies/firewalls restrict it.

## Interview Questions

### [L2 · how] How does a Docker container reach the internet, and how does port publishing work?

The container's network namespace has one end of a veth pair; the other end is attached to the docker0 bridge on the host. Outbound packets are routed through the bridge and SNAT'ed (masqueraded) to the host's IP. Publishing `-p 8080:80` adds a DNAT rule mapping host port 8080 to the container's IP and port 80.

### [L3 · how] How does traffic to a Kubernetes ClusterIP reach a pod?

The client resolves the Service name via CoreDNS to the ClusterIP. When the client opens a connection, kube-proxy's iptables/IPVS rules (or an eBPF program) on the client's node DNAT the destination to one ready endpoint pod IP, recording the mapping in conntrack for return traffic. The packet then travels over the pod network (routed or overlay) to the pod's node and into its namespace via a veth pair.

### [L3 · compare] Overlay vs routed pod networking?

Overlays encapsulate pod packets (e.g., VXLAN) between node IPs, so pod IPs needn't be routable on the physical network — easy to deploy anywhere, but with encapsulation overhead and reduced MTU. Routed approaches make pod CIDRs routable (BGP, cloud routes, VPC-native IPs) — better performance and full MTU, but they depend on underlay routing and IP capacity.

### [L4 · debugging] Pods intermittently see 5-second delays resolving external hostnames. What would you investigate?

Known causes: UDP DNS packets dropped due to conntrack insertion races or table pressure when parallel A/AAAA queries share a socket through DNAT (resolver retries after a 5 s timeout), ndots search expansion multiplying queries, CoreDNS overload or upstream resolver slowness. Check conntrack `insert_failed` counters, CoreDNS metrics, packet captures; mitigate with NodeLocal DNSCache, `single-request-reopen`/TCP for DNS, lower ndots/FQDNs, and scaling CoreDNS.

### [L2 · how] How does an external client reach a pod through a Service of type LoadBalancer?

The cloud provider creates a load balancer whose targets are the cluster's nodes on the Service's **NodePort** (or, with VPC-native setups, the pod IPs directly). A packet arrives at some node's NodePort; kube-proxy's rules (or eBPF) DNAT it to one of the Service's ready pods, which may be on a different node, in which case it is forwarded again. `externalTrafficPolicy: Local` sends traffic only to nodes running a pod for the Service, avoiding the extra hop and preserving the client's source IP, at the cost of uneven balancing.

### [L2 · debugging] Why does resolving `api.example.com` from a pod sometimes take several lookups, and how do you fix it?

With `ndots:5`, any name with fewer than 5 dots is tried with each search domain first: `api.example.com.default.svc.cluster.local`, `api.example.com.svc.cluster.local`, `api.example.com.cluster.local`, and only then `api.example.com` itself, each for both A and AAAA records. That is up to 8 queries, and conntrack races on UDP can make some of them time out after 5 s. Fixes: use fully qualified names with a trailing dot (`api.example.com.`), lower `ndots` in the pod's `dnsConfig`, or run NodeLocal DNSCache.

## Practice

### [mcq] What connects a container's network namespace to the host?

- [ ] A TUN device
- [x] A veth pair
- [ ] A VLAN tag
- [ ] An ARP entry

One end inside the namespace, the other on the host (often attached to a bridge).

### [mcq] With ndots:5 and search domains, why can resolving "api.example.com" from a pod be slow?

- [ ] CoreDNS doesn't support external names
- [x] The resolver first tries the name with each cluster search suffix, generating extra failing queries
- [ ] Pods can't use UDP
- [ ] External DNS requires a NodePort

Names with fewer than 5 dots are treated as relative first.

### [numeric 4] A pod with `ndots:5` and the search domains `default.svc.cluster.local`, `svc.cluster.local` and `cluster.local` resolves `api.example.com`, which only exists as an external name. How many different names does it try for each record type before finding the answer?

:::answer
`api.example.com` has 2 dots, fewer than 5, so the 3 search domains are tried first, and the name itself last: **4** names. With A and AAAA queries for each, that is up to 8 DNS queries for one lookup.
:::

### [numeric 256] A cluster's pod CIDR is a /16, and each node is given a /24 of it. At most how many nodes can the cluster have?

:::answer
From /16 to /24 is 8 bits: 2⁸ = **256** nodes, each with 256 addresses for pods (110 pods per node by default). Planning a bigger cluster means a bigger pod CIDR or smaller per-node blocks.
:::

### [mcq] What does `kubectl port-forward` or a ClusterIP Service's virtual IP have in common with a Docker port publish `-p 8080:80`?

- [ ] They all create a new network interface
- [x] They all rely on address translation (DNAT or a proxy) to map an address and port that nothing listens on to a real container's address and port
- [ ] They all use VXLAN
- [ ] They all require NodePorts

The ClusterIP and the host's published port aren't assigned to any process; rules (iptables/IPVS/eBPF) or a proxy rewrite the destination to a real pod or container.

### [exercise] A pod can reach another pod by its IP, but not through the Service name `payments.prod`. List, in order, the layers you would check and the command or object for each.

:::solution
1. **DNS**: does `payments.prod` resolve to the Service's ClusterIP? `nslookup payments.prod` (or `payments.prod.svc.cluster.local`) from the pod; check CoreDNS pods and logs.
2. **Service definition**: `kubectl get svc payments -n prod`: the right port and targetPort?
3. **Endpoints**: `kubectl get endpointslices -n prod -l kubernetes.io/service-name=payments`. Empty means no pod matches the Service's selector, or none passes its readiness probe.
4. **Service rules on the node**: kube-proxy (iptables/IPVS) or the eBPF datapath running and in sync; `iptables -t nat -L KUBE-SERVICES | grep payments`.
5. **NetworkPolicy**: does a policy allow traffic from the client's namespace and labels to the payments pods on that port?
6. **The app**: is it listening on the targetPort, on `0.0.0.0` rather than `127.0.0.1`?

Pod-to-pod by IP already works, so the overlay and routing are fine; the fault is in the Service layer above them.
:::

### [exercise] In the [routing lab](lab:routing), send a packet from host A to the web server (93.184.215.14) and read what R1 does. Map each part of that path onto a Docker container reaching the internet: what plays host A, what plays R1, and which rule does R1's job?

:::solution
R1 rewrites the source from 192.168.1.20:51514 to its public 198.51.100.7:40001, records the mapping in its connection-tracking table, and updates the checksums. The web server only ever sees the public address.

For a container, host A is the container, with a private address such as 172.17.0.2 on the docker0 bridge. R1 is the host, which routes the packet from the bridge out of its real interface. The iptables **MASQUERADE** rule does R1's NAT, rewriting the source to the host's own address, and conntrack maps the replies back. Port publishing (`-p 8080:80`) is the other direction: a DNAT rule rewrites the *destination* of incoming packets to the container.
:::

## Quick Revision

- Network namespace = private stack; veth pair = virtual cable; bridge = virtual switch; NAT out, DNAT for published ports.
- K8s model: every pod has an IP, pod-to-pod without NAT; CNI implements (routed/BGP, VPC-native, or overlay VXLAN with smaller MTU).
- Services: ClusterIP = NAT rules/eBPF (per-connection balancing), NodePort, LoadBalancer, Ingress/Gateway for L7.
- CoreDNS + ndots search expansion pitfalls; conntrack limits; NetworkPolicy for isolation.
- kube-proxy iptables → IPVS → eBPF (Cilium) for scale.
- ndots:5 → names with < 5 dots try every search domain first (use FQDNs with a trailing dot). Pod CIDR /16 with /24 per node → 256 nodes. LoadBalancer → NodePort → DNAT to a pod.
