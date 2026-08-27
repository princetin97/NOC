// Express's res.json() calls JSON.stringify() internally, which throws on BigInt
// values (Prisma returns BigInt for our 64-bit counter columns). Patching
// BigInt.prototype.toJSON lets every API response serialize those as strings.
export function patchBigIntSerialization(): void {
  (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
    return this.toString();
  };
}
