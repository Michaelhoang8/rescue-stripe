import { encode, recover, validateSet, generator } from "./core.js";
self.onmessage = async ({ data }) => {
  try {
    if (data.mode === "encode")
      self.postMessage({
        id: data.id,
        result: await encode(new Uint8Array(data.bytes), data.k, data.n),
      });
    else if (data.mode === "recover") {
      const result = await recover(data.shards);
      self.postMessage(
        { id: data.id, result: { ...result, bytes: result.bytes.buffer } },
        [result.bytes.buffer],
      );
    } else if (data.mode === "load") {
      const validated = await validateSet(data.shards);
      self.postMessage({
        id: data.id,
        result: {
          metadata: validated.metadata,
          matrix: generator(validated.metadata.k, validated.metadata.n),
          shards: validated.decoded.map((item) => item.shard),
        },
      });
    } else throw Error("Unknown operation.");
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
