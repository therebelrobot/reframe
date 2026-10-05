// RFC 4648 base32 (no padding), used for TOTP secrets and recovery codes.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function encodeBase32(bytes: Uint8Array): string {
  let bitBuffer = 0
  let bitsInBuffer = 0
  let encoded = ''
  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte
    bitsInBuffer += 8
    while (bitsInBuffer >= 5) {
      encoded += BASE32_ALPHABET[(bitBuffer >>> (bitsInBuffer - 5)) & 31]
      bitsInBuffer -= 5
    }
  }
  if (bitsInBuffer > 0) {
    encoded += BASE32_ALPHABET[(bitBuffer << (5 - bitsInBuffer)) & 31]
  }
  return encoded
}

export function decodeBase32(encodedText: string): Buffer {
  const cleaned = encodedText.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bitBuffer = 0
  let bitsInBuffer = 0
  const bytes: number[] = []
  for (const character of cleaned) {
    const characterValue = BASE32_ALPHABET.indexOf(character)
    bitBuffer = (bitBuffer << 5) | characterValue
    bitsInBuffer += 5
    if (bitsInBuffer >= 8) {
      bytes.push((bitBuffer >>> (bitsInBuffer - 8)) & 255)
      bitsInBuffer -= 8
    }
  }
  return Buffer.from(bytes)
}
