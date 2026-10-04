---
title: "Subnetting in Practice: Splitting Networks and VLSM"
subject: cn
level: 3
order: 2
summary: "A fast, reliable method for subnetting questions — block sizes, splitting a network into equal subnets, sizing subnets by host count (VLSM), and aggregating — with graded exercises."
depth: core
difficulty: 3
minutes: 40
relevance: high
stage: 1
prerequisites: [cn-ipv4-addressing]
related: [cn-routing, cn-ipv4-addressing, cn-container-networking]
labs: [subnet-calculator]
tags: [subnetting, vlsm, block size, magic number, supernetting, route summarization, cidr exercises]
---

## Mental Model

Subnetting is **cutting a cake into slices of power-of-two sizes**. Borrowing one bit from the host part halves each slice and doubles the number of slices. You never need to convert everything to binary if you remember one number: the **block size** — how many addresses each slice holds in the "interesting" octet.

## Definition

- **Subnetting**: dividing a network into smaller subnetworks by extending the prefix length.
- **Block size** (a.k.a. "magic number"): `256 − (mask value in the interesting octet)`, or equivalently `2^(host bits in that octet)`. Subnets start at multiples of the block size.
- **VLSM (Variable-Length Subnet Masking)**: using different prefix lengths within one network to size each subnet to its needs.
- **Supernetting / summarization**: combining contiguous networks into a shorter prefix.

## Why It Exists

**The problem.** Networks are allocated in chunks; organizations must divide them among sites, VLANs, VPC subnets, or Kubernetes node pools — without wasting addresses and with room to grow. Each piece needs its own subnet — so it can have its own routing and firewall rules — but the pieces need different sizes.

**The idea.** A prefix can always be cut in half by moving the split one bit to the right. Keep halving until each piece is the right size. Since every piece is a power of two and starts at a multiple of its size, all the arithmetic reduces to one number: the block size. Interviews test it because it proves comfort with binary prefixes, which you need to read firewall rules, route tables and cloud network plans.

:::callout[That's all it is]{type=insight}
Find the block size (256 minus the mask octet). Subnets start at multiples of it. Round the IP down to a multiple to get the network; the next multiple minus one is the broadcast.
:::

## How It Works

### The fast method

1. Find the **interesting octet** — the one where the mask isn't 255 or 0.
2. **Block size** = 256 − mask value in that octet.
3. **Network address**: round the IP's interesting octet **down** to a multiple of the block size; octets to the right become 0.
4. **Broadcast**: next network − 1.
5. **Usable hosts**: 2^(host bits) − 2.

| Prefix (last octet) | /25 | /26 | /27 | /28 | /29 | /30 |
|---|---|---|---|---|---|---|
| Mask value | 128 | 192 | 224 | 240 | 248 | 252 |
| Block size | 128 | 64 | 32 | 16 | 8 | 4 |
| Usable hosts | 126 | 62 | 30 | 14 | 6 | 2 |

Same idea in the third octet: /17 → 128, /18 → 64, /19 → 32, /20 → 16, /21 → 8, /22 → 4, /23 → 2.

**Worked example** — `192.168.5.77/27`:

- Interesting octet: 4th, mask 224 → block **32**.
- 77 rounds down to **64** → network `192.168.5.64`.
- Next network 96 → broadcast `192.168.5.95`.
- Hosts `.65–.94` (30 usable).

**Third-octet example** — `10.14.93.7/20`:

- Mask 255.255.240.0 → interesting octet 3rd, block **16**.
- 93 rounds down to **80** → network `10.14.80.0`; broadcast `10.14.95.255`.
- Usable: 2^12 − 2 = 4,094.

### Splitting into equal subnets

Split `192.168.1.0/24` into 4 equal subnets: 4 = 2² → borrow **2** bits → `/26`, block 64:

| Subnet | Range | Broadcast |
|---|---|---|
| 192.168.1.0/26 | .1 – .62 | .63 |
| 192.168.1.64/26 | .65 – .126 | .127 |
| 192.168.1.128/26 | .129 – .190 | .191 |
| 192.168.1.192/26 | .193 – .254 | .255 |

Rule: to get at least N subnets, borrow `ceil(log2 N)` bits. To give each subnet at least H hosts, keep `h` host bits where `2^h − 2 ≥ H`.

### VLSM: size by need, largest first

Equal slices waste space when needs differ (a 2-host link doesn't need a /26). So cut each slice to fit. Network `172.16.0.0/24`; needs: Sales 100 hosts, Engineering 50, Ops 20, two point-to-point links (2 each).

1. **Sort by size, allocate the largest first** (keeps blocks aligned).
2. Sales 100 → needs 7 host bits (126) → `/25`: `172.16.0.0/25` (.0–.127).
3. Engineering 50 → 6 bits (62) → `/26`: `172.16.0.128/26` (.128–.191).
4. Ops 20 → 5 bits (30) → `/27`: `172.16.0.192/27` (.192–.223).
5. Link 1 → `/30`: `172.16.0.224/30`; Link 2 → `172.16.0.228/30`.
6. Remaining free: `172.16.0.232` – `.255` for growth.

### Summarization

Networks `10.1.4.0/24`, `10.1.5.0/24`, `10.1.6.0/24`, `10.1.7.0/24`: third octets 4–7 = `000001|00` to `000001|11` → first 22 bits common → **`10.1.4.0/22`**. A summary is valid only if the block is aligned (4 is a multiple of 4) and contiguous.

::lab{id=subnet-calculator}

## Internal Mechanism

Everything reduces to bit operations: network = IP AND mask; the block size is the place value of the lowest network bit; aligned blocks are those whose starting address has zeros in all host bits. The "round down to a multiple of the block size" trick is AND-ing the interesting octet with the mask.

## Example

Kubernetes example: a cluster with 50 nodes, each allotted a `/24` of pod IPs (up to 110 pods per node by default) from a pod CIDR. You need at least 50 /24s → 64 = 2⁶ → a `/18` pod CIDR (e.g., `10.244.0.0/18`) gives exactly 64 /24s. Planning for 200 nodes? Use a `/16`.

## Complexity & Performance

Mental arithmetic in seconds once block sizes are memorized; tools (`ipcalc`, `sipcalc`, the calculator above) for real work.

## Trade-offs

- Many small subnets: isolation and tight security rules vs more routes and risk of running out.
- Few large subnets: simple vs larger blast radius and broadcast domains.
- VLSM: efficient use of space vs more complex planning.

## Failure Modes

- Overlapping subnets from misaligned VLSM allocations (allocating small blocks first and then a large one that can't align).
- Forgetting network/broadcast (and cloud-reserved) addresses in capacity math.
- Undersized subnets for autoscaling groups or pod networks.

## In Production

- Terraform/Cloud tools often use `cidrsubnet(prefix, newbits, netnum)` — exactly "borrow newbits bits and take subnet number netnum".
- Firewall rules and security groups are CIDR lists; summarization keeps them short.

## Deeper Connections

- Routing uses longest-prefix match over these prefixes ([Routing](lesson:cn-routing)).
- Container and Kubernetes networking consumes subnets per node/pod ([Container Networking](lesson:cn-container-networking)).

## Common Misconceptions

- **"Subnets must all be the same size."** VLSM allows mixed sizes if they don't overlap and stay aligned.
- **"A /30 has 4 usable hosts."** It has 4 addresses, 2 usable.
- **"Any four consecutive /24s can be summarized as a /22."** Only if the first is aligned to a multiple of 4.

## Interview Questions

### [L1 · numerical] How many usable hosts does a /27 provide, and what is its mask?

2^5 − 2 = 30 usable hosts; mask 255.255.255.224.

### [L2 · numerical] Split 192.168.10.0/24 into 8 equal subnets. What is the new prefix and the range of the third subnet?

8 = 2³ → /27 (block 32). Subnets start at 0, 32, 64… The third is **192.168.10.64/27**: hosts .65–.94, broadcast .95.

### [L2 · numerical] Which subnet does 10.50.130.9/19 belong to?

/19 → third-octet mask 224, block 32. 130 rounds down to 128 → network **10.50.128.0/19**, broadcast 10.50.159.255.

### [L3 · design] Design subnets from 10.0.0.0/22 for: 400 hosts, 120 hosts, 60 hosts, and 4 point-to-point links.

Largest first: 400 → 9 host bits (510) → /23: 10.0.0.0/23 (10.0.0.0–10.0.1.255). 120 → /25: 10.0.2.0/25. 60 → /26: 10.0.2.128/26. Links → /30s (or /31s): 10.0.2.192/30, .196/30, .200/30, .204/30. Remaining 10.0.2.208–10.0.3.255 is free for growth.

### [L3 · numerical] Can 192.168.14.0/24 through 192.168.17.0/24 be summarized as one /22?

No. A /22 covers blocks of 4 in the third octet starting at a multiple of 4: 12–15 or 16–19. 14–17 spans two /22 blocks; the smallest single summary covering it is 192.168.0.0/19 (which also includes many other networks) — or advertise 192.168.14.0/23 + 192.168.16.0/23.

## Practice

### [exercise] Find network, broadcast and usable range for 172.20.200.77/21.

:::solution
/21 → 255.255.248.0; third-octet block 8. 200 → 200 (multiple of 8). Network **172.20.200.0**, broadcast **172.20.207.255**, hosts 172.20.200.1 – 172.20.207.254 (2,046 usable).
:::

### [numeric 26] You need at least 50 subnets from a /20. What prefix length do you use? (enter the prefix number)

:::answer
50 → 2⁶ = 64 ≥ 50 → borrow 6 bits: /20 + 6 = **/26**.
:::

### [numeric 16] What is the block size (in the third octet) for a /20?

:::answer
Mask 255.255.240.0 → 256 − 240 = **16**.
:::

## Quick Revision

- Block size = 256 − mask octet value; networks start at multiples of it.
- Network = round down; broadcast = next network − 1; hosts = 2^h − 2.
- N subnets → borrow ceil(log2 N) bits; H hosts → h bits with 2^h − 2 ≥ H.
- VLSM: allocate largest first, keep aligned.
- Summarize only aligned, contiguous blocks.
