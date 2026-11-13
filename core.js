export const MAX_BYTES = 262144;
const EXP = new Uint8Array(510),
  LOG = new Uint8Array(256);
let value = 1;
for (let i = 0; i < 255; i++) {
  EXP[i] = value;
  LOG[value] = i;
  value <<= 1;
  if (value & 256) value ^= 0x11d;
}
for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255];
export const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
export function inverse(a) {
  if (!Number.isInteger(a) || a < 1 || a > 255)
    throw Error("A nonzero field byte is required.");
  return EXP[255 - LOG[a]];
}
function parameters(k, n) {
  if (
    !Number.isInteger(k) ||
    k < 2 ||
    k > 8 ||
    !Number.isInteger(n) ||
    n < k ||
    n > 12
  )
    throw Error("Use 2–8 data shards and between k and 12 total shards.");
}
export function invert(matrix) {
  const n = matrix.length;
  if (
    !n ||
    n > 12 ||
    matrix.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== n ||
        row.some((x) => !Number.isInteger(x) || x < 0 || x > 255),
    )
  )
    throw Error("Expected a square field matrix of at most 12 rows.");
  const a = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => Number(i === j)),
  ]);
  for (let col = 0; col < n; col++) {
    const pivot = a.findIndex((row, i) => i >= col && row[col] !== 0);
    if (pivot < 0) throw Error("Matrix is singular.");
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const scale = inverse(a[col][col]);
    a[col] = a[col].map((x) => mul(x, scale));
    for (let row = 0; row < n; row++)
      if (row !== col && a[row][col]) {
        const factor = a[row][col];
        for (let j = 0; j < 2 * n; j++) a[row][j] ^= mul(factor, a[col][j]);
      }
  }
  return a.map((row) => row.slice(n));
}
export function product(a, b) {
  return a.map((row) =>
    b[0].map((_, j) => row.reduce((sum, x, i) => sum ^ mul(x, b[i][j]), 0)),
  );
}
export function generator(k, n) {
  parameters(k, n);
  const v = Array.from({ length: n }, (_, i) => {
    const row = [1];
    for (let j = 1; j < k; j++) row.push(mul(row[j - 1], i + 1));
    return row;
  });
  return product(v, invert(v.slice(0, k)));
}
const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export async function hash(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}
export function toBase64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function fromBase64(text) {
  if (
    typeof text !== "string" ||
    text.length > 174764 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      text,
    )
  )
    throw Error("Invalid or oversized shard base64.");
  const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  if (toBase64(bytes) !== text) throw Error("Shard base64 must be canonical.");
  return bytes;
}
function body(shard) {
  return {
    format: shard.format,
    setId: shard.setId,
    k: shard.k,
    n: shard.n,
    length: shard.length,
    size: shard.size,
    payloadHash: shard.payloadHash,
    index: shard.index,
    data: shard.data,
  };
}
export async function shardChecksum(shard) {
  return hash(new TextEncoder().encode(JSON.stringify(body(shard))));
}
function codeBlocks(blocks, matrix, size) {
  return matrix.map((row) => {
    const output = new Uint8Array(size);
    for (let j = 0; j < blocks.length; j++)
      if (row[j])
        for (let b = 0; b < size; b++) output[b] ^= mul(row[j], blocks[j][b]);
    return output;
  });
}
async function packageShards(meta, blocks) {
  return Promise.all(
    blocks.map(async (bytes, index) => {
      const shard = { ...meta, index, data: toBase64(bytes) };
      return { ...shard, shardHash: await shardChecksum(shard) };
    }),
  );
}
export async function encode(bytes, k = 3, n = 5) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES)
    throw Error("Use a file of at most 256 KiB.");
  parameters(k, n);
  const size = Math.ceil(bytes.length / k),
    blocks = Array.from({ length: k }, (_, i) => {
      const block = new Uint8Array(size);
      block.set(bytes.slice(i * size, (i + 1) * size));
      return block;
    });
  const meta = {
      format: "rescue-stripe-v1",
      setId: hex(crypto.getRandomValues(new Uint8Array(16))),
      k,
      n,
      length: bytes.length,
      size,
      payloadHash: await hash(bytes),
    },
    matrix = generator(k, n);
  return {
    metadata: meta,
    matrix,
    shards: await packageShards(meta, codeBlocks(blocks, matrix, size)),
  };
}
export async function validateShard(shard) {
  const keys = [
    "format",
    "setId",
    "k",
    "n",
    "length",
    "size",
    "payloadHash",
    "index",
    "data",
    "shardHash",
  ]
    .sort()
    .join(",");
  if (
    !shard ||
    typeof shard !== "object" ||
    Array.isArray(shard) ||
    Object.keys(shard).sort().join(",") !== keys ||
    shard.format !== "rescue-stripe-v1"
  )
    throw Error("Unsupported shard format.");
  parameters(shard.k, shard.n);
  if (
    typeof shard.setId !== "string" ||
    !/^[0-9a-f]{32}$/.test(shard.setId) ||
    typeof shard.payloadHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(shard.payloadHash) ||
    typeof shard.shardHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(shard.shardHash)
  )
    throw Error("Invalid shard identifiers or hashes.");
  if (
    !Number.isInteger(shard.length) ||
    shard.length < 0 ||
    shard.length > MAX_BYTES ||
    shard.size !== Math.ceil(shard.length / shard.k) ||
    !Number.isInteger(shard.index) ||
    shard.index < 0 ||
    shard.index >= shard.n
  )
    throw Error("Invalid shard dimensions or index.");
  const bytes = fromBase64(shard.data);
  if (bytes.length !== shard.size)
    throw Error("Shard payload length mismatch.");
  if ((await shardChecksum(shard)) !== shard.shardHash)
    throw Error(`Shard ${shard.index + 1} checksum mismatch.`);
  return bytes;
}
export async function validateSet(shards) {
  if (!Array.isArray(shards) || !shards.length || shards.length > 12)
    throw Error("Provide 1–12 shards.");
  const indices = new Set(),
    decoded = [];
  let meta;
  for (const shard of shards) {
    const bytes = await validateShard(shard),
      current = {
        format: shard.format,
        setId: shard.setId,
        k: shard.k,
        n: shard.n,
        length: shard.length,
        size: shard.size,
        payloadHash: shard.payloadHash,
      };
    if (meta && JSON.stringify(meta) !== JSON.stringify(current))
      throw Error("Shards belong to different sets or metadata.");
    meta = current;
    if (indices.has(shard.index)) throw Error("Duplicate shard index.");
    indices.add(shard.index);
    decoded.push({ shard, bytes });
  }
  decoded.sort((a, b) => a.shard.index - b.shard.index);
  return { metadata: meta, decoded };
}
export async function recover(shards) {
  const { metadata, decoded } = await validateSet(shards),
    { k, n, size, length } = metadata;
  if (decoded.length < k)
    throw Error(
      `Need ${k} distinct shards; only ${decoded.length} are available.`,
    );
  const matrix = generator(k, n),
    basis = decoded.slice(0, k),
    inverseMatrix = invert(basis.map((item) => matrix[item.shard.index])),
    blocks = codeBlocks(
      basis.map((item) => item.bytes),
      inverseMatrix,
      size,
    ),
    padded = new Uint8Array(k * size);
  blocks.forEach((block, i) => padded.set(block, i * size));
  if (padded.slice(length).some((b) => b !== 0))
    throw Error("Recovered padding is inconsistent.");
  const bytes = padded.slice(0, length);
  if ((await hash(bytes)) !== metadata.payloadHash)
    throw Error("Recovered payload hash mismatch.");
  const rebuilt = codeBlocks(blocks, matrix, size);
  for (const item of decoded)
    if (item.bytes.some((b, i) => b !== rebuilt[item.shard.index][i]))
      throw Error(
        `Shard ${item.shard.index + 1} is inconsistent with the reconstruction.`,
      );
  return {
    bytes,
    metadata,
    matrix,
    inverseMatrix,
    basis: basis.map((item) => item.shard.index),
    checkedShards: decoded.length,
    repaired: await packageShards(metadata, rebuilt),
  };
}
