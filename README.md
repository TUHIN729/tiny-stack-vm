# Tiny Stack VM

A small, exact implementation of make.fun's tiny stack ISA: 32-bit wrapping
arithmetic, a 256-value data stack, a 64-deep call stack, 256 words of
memory, input, output, and all ten traps with their exact exit codes.
One run of `node main.ts` answers every instance in the input directory,
writing each program's `stdout.bin` and `exit code` under the output
directory. Deterministic, no network, no clock.
