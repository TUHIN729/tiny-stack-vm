// Tiny Stack VM — make.fun tiny-stack-vm-01-run-20261122.
// Runs each /input/<id>/program.bin on its input.bin, writing
// /output/<id>/stdout.bin + exit.txt per the published ISA.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Opcode table, one char per opcode byte (0x00-0x53): the char is
// 48 + immCode*16 + pops*4 + pushes (immCode 0/1/2/3 = imm 0/1/4/2);
// '!' marks no opcode. 'A' is PUSH8, '9' a binary op, '`' JMP/CALL.
const T = '0AQ46:;?!!!!!!!!999999959995999!999!!!!!!!!!!!!!`dd`0!!!!!!!!!!!58!!!!!!!!!!!!!!4414';
const IMM = [0, 1, 4, 2];

for (const id of readdirSync(IN).sort()) {
  const di = join(IN, id), od = join(OUT, id);
  const p = readFileSync(join(di, 'program.bin'));
  const q = readFileSync(join(di, 'input.bin'));
  const n = p.length;
  const D = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256);
  const O = new Uint8Array(65536);
  let sp = 0, cp = 0, ol = 0, ip = 0, pc = 0, st = 0, ex = 0;
  run: for (;;) {
    if (st === 1e6) { ex = 10; break; }
    if (pc < 0 || pc >= n) { ex = 9; break; }
    const op = p[pc];
    const t = T.charCodeAt(op) - 48;
    if (!(t >= 0 && t <= 63)) { ex = 5; break; }
    const imm = IMM[t >> 4], po = (t >> 2) & 3, pu = t & 3;
    if (pc + imm >= n) { ex = 9; break; }
    st++;
    const nx = pc + 1 + imm;
    if (sp < po) { ex = 2; break; }
    if (sp - po + pu > 256) { ex = 3; break; }
    pc = nx;
    if (op === 0x17 || op === 0x1b) { D[sp - 1] = op === 0x17 ? -D[sp - 1] | 0 : ~D[sp - 1]; continue; }
    if (op >= 0x10 && op < 0x23) {
      const b = D[sp - 1], a = D[sp - 2];
      if (op >= 0x13 && op <= 0x16 && b === 0) { ex = 4; break; }
      let r = 0;
      switch (op) {
        case 0x10: r = a + b | 0; break;
        case 0x11: r = a - b | 0; break;
        case 0x12: r = Math.imul(a, b); break;
        case 0x13: r = a / b | 0; break;
        case 0x14: r = a % b | 0; break;
        case 0x15: r = (a >>> 0) / (b >>> 0) | 0; break;
        case 0x16: r = (a >>> 0) % (b >>> 0) | 0; break;
        case 0x18: r = a & b; break;
        case 0x19: r = a | b; break;
        case 0x1a: r = a ^ b; break;
        case 0x1c: r = a << (b & 31); break;
        case 0x1d: r = a >> (b & 31); break;
        case 0x1e: r = a >>> (b & 31) | 0; break;
        case 0x20: r = a === b ? 1 : 0; break;
        case 0x21: r = a < b ? 1 : 0; break;
        case 0x22: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
      }
      D[sp - 2] = r;
      sp--;
      continue;
    }
    if (op >= 0x30 && op < 0x33) {
      const rel = p.readInt16LE(nx - 2);
      if (op === 0x30 || (op === 0x31 && D[--sp] === 0) || (op === 0x32 && D[--sp] !== 0)) pc += rel;
      continue;
    }
    switch (op) {
      case 0: ex = 0; break run;
      case 1: D[sp++] = p.readInt8(pc - 1); break;
      case 2: D[sp++] = p.readInt32LE(pc - 4); break;
      case 3: sp--; break;
      case 4: D[sp] = D[sp - 1]; sp++; break;
      case 5: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 6: D[sp] = D[sp - 2]; sp++; break;
      case 7: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x33:
        if (cp === 64) { ex = 7; break run; }
        C[cp++] = pc;
        pc = p.readUInt16LE(pc - 2);
        break;
      case 0x34:
        if (cp === 0) { ex = 8; break run; }
        pc = C[--cp];
        break;
      case 0x40: {
        const a = D[sp - 1];
        if (a < 0 || a >= 256) { ex = 6; break run; }
        D[sp - 1] = M[a];
        break;
      }
      case 0x41: {
        const a = D[sp - 1];
        if (a < 0 || a >= 256) { ex = 6; break run; }
        M[a] = D[sp - 2];
        sp -= 2;
        break;
      }
      case 0x50: {
        const b = Buffer.from(String(D[sp - 1]));
        if (ol + b.length > 65536) { ex = 11; break run; }
        sp--;
        O.set(b, ol);
        ol += b.length;
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) { ex = 11; break run; }
        O[ol++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = ip < q.length ? q[ip++] : -1; break;
      case 0x53: ex = D[--sp] & 255; break run;
    }
  }
  mkdirSync(od, { recursive: true });
  writeFileSync(join(od, 'stdout.bin'), O.subarray(0, ol));
  writeFileSync(join(od, 'exit.txt'), ex + '\n');
}
