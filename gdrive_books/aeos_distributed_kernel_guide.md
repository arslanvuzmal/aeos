# AEOS Distributed Kernel Architecture & Memory Management

## Core Invariants
The AEOS Distributed Kernel enforces time-sliced cooperative preemption across all autonomous agent swarms.
Memory allocation quotas are strictly bounded to 1,024 megabytes per worker node, eliminating out-of-memory cascades.

## Zero-API Remote Storage Mounting
Filesystem events are observed via kernel notify interfaces. Incoming textbooks and engineering specifications
are chunked into 800-character segments with 150-character margins, producing zero external API overhead and zero token cost.
