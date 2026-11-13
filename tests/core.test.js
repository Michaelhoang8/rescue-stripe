import test from "node:test";
import assert from "node:assert/strict";
import {
  mul,
  inverse,
  invert,
  product,
  generator,
  encode,
  recover,
  validateSet,
  shardChecksum,
  toBase64,
  MAX_BYTES,
} from "../core.js";
function slowMul(a, b) {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) r ^= a;
    b >>= 1;
    a <<= 1;
    if (a & 256) a ^= 0x11d;
  }
  return r;
}
function combinations(n, k, start = 0, prefix = []) {
  if (!k) return [prefix];
  return Array.from({ length: n - start - k + 1 }, (_, i) => start + i).flatMap(
    (i) => combinations(n, k - 1, i + 1, [...prefix, i]),
  );
}
test("all 65,536 field products match independent polynomial multiplication", () => {
  for (let a = 0; a < 256; a++)
    for (let b = 0; b < 256; b++) assert.equal(mul(a, b), slowMul(a, b));
  for (let a = 1; a < 256; a++) assert.equal(mul(a, inverse(a)), 1);
  assert.throws(() => inverse(0));
});
test("every allowed systematic generator and every recovery subset is invertible", () => {
  for (let k = 2; k <= 8; k++)
    for (let n = k; n <= 12; n++) {
      const g = generator(k, n),
        identity = Array.from({ length: k }, (_, i) =>
          Array.from({ length: k }, (_, j) => Number(i === j)),
        );
      assert.deepEqual(g.slice(0, k), identity);
      for (const indices of combinations(n, k)) {
        const matrix = indices.map((i) => g[i]);
        assert.deepEqual(product(matrix, invert(matrix)), identity);
      }
    }
  assert.throws(() =>
    invert([
      [1, 1],
      [1, 1],
    ]),
  );
});
test("every three-of-five subset recovers all byte values and recreates identical shards", async () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i),
    result = await encode(bytes, 3, 5);
  for (const indices of combinations(5, 3)) {
    const recovered = await recover(indices.map((i) => result.shards[i]));
    assert.deepEqual(recovered.bytes, bytes);
    assert.deepEqual(recovered.repaired, result.shards);
  }
  const recovered = await recover(result.shards);
  assert.equal(recovered.checkedShards, 5);
});
test("maximum payload with mixed data/parity shards and empty payload recover exactly", async () => {
  for (const bytes of [
    new Uint8Array(),
    Uint8Array.from({ length: MAX_BYTES }, (_, i) => (i * 17 + 31) % 256),
  ]) {
    const result = await encode(bytes, 8, 12);
    const recovered = await recover(
      [0, 2, 4, 6, 8, 9, 10, 11].map((i) => result.shards[i]),
    );
    assert.deepEqual(recovered.bytes, bytes);
  }
});
test("checksums, identity, duplicates, insufficiency, and bounds are enforced", async () => {
  const a = await encode(new Uint8Array([1, 2, 3, 4]), 3, 5),
    b = await encode(new Uint8Array([1, 2, 3, 4]), 3, 5);
  await assert.rejects(() => recover(a.shards.slice(0, 2)), /Need 3/);
  await assert.rejects(
    () => validateSet([a.shards[0], a.shards[0]]),
    /Duplicate/,
  );
  await assert.rejects(
    () => validateSet([a.shards[0], b.shards[1]]),
    /different/,
  );
  await assert.rejects(() =>
    recover([{ ...a.shards[0], data: "AAAA" }, ...a.shards.slice(1, 3)]),
  );
  await assert.rejects(() => encode(new Uint8Array(MAX_BYTES + 1), 3, 5));
  for (const [k, n] of [
    [1, 5],
    [9, 12],
    [3, 2],
    [3, 13],
  ])
    assert.throws(() => generator(k, n));
  await assert.rejects(() => validateSet([{ ...a.shards[0], extra: true }]));
});
test("a rechecksummed corrupt extra shard is detected by consistency verification", async () => {
  const result = await encode(new Uint8Array([1, 2, 3, 4, 5, 6]), 3, 5),
    bad = { ...result.shards[4], data: toBase64(new Uint8Array([55, 66])) };
  bad.shardHash = await shardChecksum(bad);
  await assert.rejects(
    () => recover([...result.shards.slice(0, 4), bad]),
    /inconsistent/,
  );
  await assert.rejects(
    () => recover([result.shards[0], result.shards[1], bad]),
    /payload hash/,
  );
});
test("systematic data shards concatenate to original bytes with zero padding", async () => {
  const bytes = new Uint8Array([17, 18, 19, 20, 21]),
    result = await encode(bytes, 3, 5);
  const raw = result.shards
    .slice(0, 3)
    .flatMap((s) => Array.from(atob(s.data), (c) => c.charCodeAt(0)));
  assert.deepEqual(raw, [17, 18, 19, 20, 21, 0]);
});
