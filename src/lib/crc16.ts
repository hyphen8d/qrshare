// CRC-16/CCITT-FALSE — cheap per-chunk integrity check. A misread camera
// frame decodes to *some* string; without a checksum we'd happily splice
// garbage into the reassembled file. This just tells us to keep waiting for
// a clean read of that chunk instead.
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc;
}

export function crc16Hex(bytes: Uint8Array): string {
  return crc16(bytes).toString(16).padStart(4, '0');
}
