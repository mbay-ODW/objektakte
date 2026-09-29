/**
 * Erzeugt ein minimales ICC-v2-Monitorprofil (RGB, sRGB-Primärvalenzen, Gamma 2.2) für den
 * PDF/A-OutputIntent. Selbst erzeugt, damit keine Profildatei mit eigener Lizenz im Projekt liegt.
 */

function s15Fixed16(v: number): number {
  return Math.round(v * 65536) | 0;
}

class Writer {
  readonly bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  u16(v: number) {
    this.u8(v >>> 8);
    this.u8(v);
  }
  u32(v: number) {
    this.u16((v >>> 16) & 0xffff);
    this.u16(v & 0xffff);
  }
  ascii(s: string) {
    for (const ch of s) this.u8(ch.charCodeAt(0));
  }
  zeros(n: number) {
    for (let i = 0; i < n; i++) this.u8(0);
  }
  align4() {
    while (this.bytes.length % 4 !== 0) this.u8(0);
  }
}

function xyzTag(x: number, y: number, z: number): number[] {
  const w = new Writer();
  w.ascii("XYZ ");
  w.u32(0);
  w.u32(s15Fixed16(x));
  w.u32(s15Fixed16(y));
  w.u32(s15Fixed16(z));
  return w.bytes;
}

function descTag(text: string): number[] {
  const w = new Writer();
  w.ascii("desc");
  w.u32(0);
  w.u32(text.length + 1);
  w.ascii(text);
  w.u8(0);
  w.u32(0); // Unicode-Sprachcode
  w.u32(0); // Unicode-Länge
  w.u16(0); // ScriptCode-Code
  w.u8(0); // ScriptCode-Länge
  w.zeros(67);
  return w.bytes;
}

function textTag(text: string): number[] {
  const w = new Writer();
  w.ascii("text");
  w.u32(0);
  w.ascii(text);
  w.u8(0);
  return w.bytes;
}

function curveTag(gamma: number): number[] {
  const w = new Writer();
  w.ascii("curv");
  w.u32(0);
  w.u32(1);
  w.u16(Math.round(gamma * 256));
  return w.bytes;
}

export function buildSrgbLikeIcc(): Uint8Array {
  const trc = curveTag(2.2);
  const tags: [string, number[]][] = [
    ["desc", descTag("sRGB-like (objektakte)")],
    ["cprt", textTag("No copyright, use freely")],
    ["wtpt", xyzTag(0.9642, 1.0, 0.8249)],
    ["rXYZ", xyzTag(0.436, 0.2225, 0.0139)],
    ["gXYZ", xyzTag(0.3851, 0.7169, 0.0971)],
    ["bXYZ", xyzTag(0.1431, 0.0606, 0.7141)],
    ["rTRC", trc],
    ["gTRC", trc],
    ["bTRC", trc],
  ];

  // Tag-Daten anordnen (TRC-Daten werden gemeinsam genutzt)
  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const placed = new Map<number[], number>();
  const entries: { sig: string; offset: number; size: number }[] = [];
  const data = new Writer();
  for (const [sig, bytes] of tags) {
    let at = placed.get(bytes);
    if (at === undefined) {
      at = offset;
      placed.set(bytes, at);
      data.bytes.push(...bytes);
      data.align4();
      offset = 128 + tableSize + data.bytes.length;
    }
    entries.push({ sig, offset: at, size: bytes.length });
  }
  const size = 128 + tableSize + data.bytes.length;

  const w = new Writer();
  w.u32(size);
  w.u32(0); // CMM
  w.u32(0x02100000); // Version 2.1
  w.ascii("mntr");
  w.ascii("RGB ");
  w.ascii("XYZ ");
  for (const v of [2026, 1, 1, 0, 0, 0]) w.u16(v);
  w.ascii("acsp");
  w.u32(0); // Plattform
  w.u32(0); // Flags
  w.u32(0); // Hersteller
  w.u32(0); // Modell
  w.zeros(8); // Attribute
  w.u32(0); // Rendering Intent: perceptual
  w.u32(s15Fixed16(0.9642));
  w.u32(s15Fixed16(1.0));
  w.u32(s15Fixed16(0.8249));
  w.u32(0); // Creator
  w.zeros(44);
  w.u32(tags.length);
  for (const e of entries) {
    w.ascii(e.sig);
    w.u32(e.offset);
    w.u32(e.size);
  }
  w.bytes.push(...data.bytes);
  return Uint8Array.from(w.bytes);
}
