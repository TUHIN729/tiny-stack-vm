// Tiny stack VM: runs every instance in MAKEFUN_INPUT_DIR on the ISA in
// program/generator/subject/ISA.md, writing each program's stdout and exit
// code under MAKEFUN_OUTPUT_DIR. Node 22, no dependencies, deterministic.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Opcode tables, indexed by opcode byte (0x00-0x53): immediate bytes, values
// popped, values pushed, and whether the byte is a real opcode at all.
const IMM = '014000000000000000000000000000000000000000000000222200000000000000000000000000000000';
const POP = '000112230000000022222221222122202220000000000000011000000000000012000000000000001101';
const PSH = '011022330000000011111111111111101110000000000000000000000000000010000000000000000010';
const VAL = '111111110000000011111111111111111110000000000000111110000000000011000000000000001111';

function run(prog: Buffer, input: Buffer): { out: Buffer; code: number } {
  const n = prog.length;
  const st = new Int32Array(256);
  const cs = new Int32Array(64);
  const mem = new Int32Array(256);
  const out: number[] = [];
  let sp = 0, cp = 0, pc = 0, steps = 0, ip = 0;
  const end = (code: number) => ({ out: Buffer.from(out), code });

  for (;;) {
    if (steps >= 1e6) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = prog[pc];
    if (VAL[op] !== '1') return end(5);
    const imm = IMM.charCodeAt(op) - 48;
    const pops = POP.charCodeAt(op) - 48;
    const pushes = PSH.charCodeAt(op) - 48;
    if (pc + imm >= n) return end(9);
    steps++;
    if (sp < pops) return end(2);
    if (sp - pops + pushes > 256) return end(3);
    const next = pc + 1 + imm;
    pc = next;

    switch (op) {
      case 0x00: return end(0); // HALT
      case 0x01: st[sp++] = (prog[pc - 1] << 24) >> 24; break; // PUSH8
      case 0x02: // PUSH32, little-endian signed
        st[sp++] = prog[pc - 4] | (prog[pc - 3] << 8) | (prog[pc - 2] << 16) | (prog[pc - 1] << 24);
        break;
      case 0x03: sp--; break; // POP
      case 0x04: st[sp] = st[sp - 1]; sp++; break; // DUP
      case 0x05: { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; break; } // SWAP
      case 0x06: st[sp] = st[sp - 2]; sp++; break; // OVER
      case 0x07: { const a = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = a; break; } // ROT
      case 0x17: st[sp - 1] = -st[sp - 1] | 0; break; // NEG
      case 0x1b: st[sp - 1] = ~st[sp - 1]; break; // NOT
      case 0x30: case 0x31: case 0x32: { // JMP / JZ / JNZ
        let rel = prog[pc - 2] | (prog[pc - 1] << 8);
        if (rel & 0x8000) rel -= 0x10000;
        let take = true;
        if (op !== 0x30) { const v = st[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = next + rel;
        break;
      }
      case 0x33: // CALL: push next address, jump to unsigned target
        if (cp === 64) return end(7);
        cs[cp++] = next;
        pc = prog[pc - 2] | (prog[pc - 1] << 8);
        break;
      case 0x34: if (cp === 0) return end(8); pc = cs[--cp]; break; // RET
      case 0x40: { // LOAD
        const a = st[sp - 1];
        if (a < 0 || a >= 256) return end(6);
        st[sp - 1] = mem[a];
        break;
      }
      case 0x41: { // STORE: ( v addr -- )
        const a = st[sp - 1], v = st[sp - 2];
        if (a < 0 || a >= 256) return end(6);
        sp -= 2;
        mem[a] = v;
        break;
      }
      case 0x50: { // PRINT: decimal ASCII, no newline
        const t = String(st[sp - 1]);
        if (out.length + t.length > 65536) return end(11);
        sp--;
        for (let i = 0; i < t.length; i++) out.push(t.charCodeAt(i));
        break;
      }
      case 0x51: // PUTC: low byte
        if (out.length + 1 > 65536) return end(11);
        out.push(st[--sp] & 255);
        break;
      case 0x52: st[sp++] = ip < input.length ? input[ip++] : -1; break; // IN
      case 0x53: return end(st[--sp] & 255); // EXIT
      default: { // two-operand arithmetic, logic and comparison
        const b = st[sp - 1], a = st[sp - 2];
        let r: number;
        switch (op) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13: // DIV, signed truncating; INT_MIN / -1 stays INT_MIN
            if (b === 0) return end(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 0x14: // MOD, sign of a; x % -1 is 0
            if (b === 0) return end(4);
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 0x15: if (b === 0) return end(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break; // DIVU
          case 0x16: if (b === 0) return end(4); r = ((a >>> 0) % (b >>> 0)) | 0; break; // MODU
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU
        }
        sp -= 2;
        st[sp++] = r;
      }
    }
  }
}

for (const id of readdirSync(INPUT).sort()) {
  const prog = readFileSync(join(INPUT, id, 'program.bin'));
  const input = readFileSync(join(INPUT, id, 'input.bin'));
  const { out, code } = run(prog, input);
  mkdirSync(join(OUTPUT, id), { recursive: true });
  writeFileSync(join(OUTPUT, id, 'stdout.bin'), out);
  writeFileSync(join(OUTPUT, id, 'exit.txt'), `${code}\n`);
}
