---
title: "What Happens When You Power On a Computer"
summary: "From power button to login prompt: firmware self-test, UEFI and the boot loader, the kernel decompressing itself, mode switches and page tables, device discovery, the initramfs, PID 1 and the services that make a machine useful."
subjects: [os]
order: 1
related: [os-what-an-os-does, os-hardware-model, os-syscalls-interrupts, os-address-spaces, os-process-creation]
---

The CPU starts with almost no context: no memory map, no drivers, no filesystem. Booting is a chain of increasingly capable programs, each loading the next.

## [cpu] Reset vector

When power stabilizes, the CPU resets into a minimal mode and starts executing at a fixed address (the reset vector) mapped to firmware flash. Only one core (the bootstrap processor) runs; caches may be used as temporary RAM because DRAM isn't initialized yet.

## [firmware] Firmware initializes the hardware

UEFI firmware (older machines: BIOS) runs power-on self tests, trains and initializes DRAM, enumerates buses (PCIe), initializes enough devices to boot (storage controllers, keyboard, display), and builds the memory map and ACPI tables the OS will later read ([Hardware Model](lesson:os-hardware-model)).

## [firmware] Find something to boot

UEFI reads its boot entries (NVRAM variables), finds the EFI System Partition (a FAT filesystem), and loads a boot application such as `grubx64.efi` or `systemd-bootx64.efi`. With Secure Boot, each stage's signature is verified before it runs.

## [bootloader] The boot loader loads the kernel

GRUB (or systemd-boot) reads its configuration, lets you choose an entry, loads the compressed kernel image (`vmlinuz`) and the initial RAM filesystem (`initramfs`) into memory, passes the kernel command line (`root=…`, `quiet`), and jumps to the kernel's entry point.

## [kernel] The kernel sets up its own world

The kernel decompresses itself, switches to 64-bit long mode with its own page tables (turning on virtual memory — [Address Spaces](lesson:os-address-spaces)), sets up the interrupt descriptor table, initializes memory management from the firmware's memory map, starts the other CPU cores, and calibrates timers.

## [kernel] Drivers and the initramfs

The kernel initializes built-in drivers and mounts the initramfs as a temporary root filesystem. Programs inside it load the modules needed to reach the real root disk (NVMe/RAID/LVM/encryption), then mount the real root filesystem and switch to it (`switch_root`).

## [kernel] Starting PID 1

The kernel executes `/sbin/init` — today usually systemd — as process 1, the ancestor of every user-space process. If PID 1 dies, the kernel panics. From here on, everything else is created by fork/exec ([Process Creation](lesson:os-process-creation)).

## [app] systemd brings the system up

systemd reads unit files and starts services in parallel according to dependencies: udev (device events), journald (logging), networking (DHCP, DNS resolver), mounts, sshd, container runtime, your application services. Targets like `multi-user.target` mark milestones.

## [user] Login

A getty or display manager presents a login prompt. You authenticate; a session and a shell are created — and the system is ready for the next walkthrough: [running a program](uth:process-start).
