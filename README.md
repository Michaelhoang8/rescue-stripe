# Rescue Stripe

A systematic Reed–Solomon erasure-coding workbench over GF(256). Encode a local file into data/parity shards, simulate missing pieces, recover from any sufficient subset, verify the reconstruction, and regenerate every missing shard.

![Recovery from a partial bundle](docs/workbench.png)

The shard rack shows a byte-intensity preview of the first 32 bytes of each available payload. An availability meter marks the recovery threshold; successful recovery highlights the verified result. Unavailable slots remain visible and keyboard selection preserves focus. Motion respects reduced-motion settings.

## Run

```sh
python run.py --port 8000
```

Open http://127.0.0.1:8000 in a modern browser with module workers, WebCrypto, and typed arrays. Python 3.10+ serves static assets; all file coding runs locally in a worker. Node 22+ runs tests. There are no package dependencies or network uploads.

## Try a recovery

The sample record is 68 bytes. With k=3 and n=5, each shard has 23 bytes, with 1 padding bytes across the three data blocks. The encoded payload totals 115 bytes before JSON/base64 overhead.

1. Mark the first two shards unavailable.
2. Recover from shards 3, 4, and 5. The payload hash and supplied-shard consistency checks must pass before downloading.
3. Save the available bundle, then reopen it. Shards 1 and 2 are genuinely absent from that imported bundle.
4. Recover and choose **Restore all rebuilt shards**. All five shard payloads and checksums are regenerated identically.

Checkboxes only simulate availability; they do not delete downloaded files. An imported missing index stays disabled until reconstructed. Fewer than k available pieces disables recovery. Each shard can be saved separately, and the import chooser accepts multiple individual shard files and/or bundles. Selecting a new source does not replace the current stripe until **Encode stripe** is pressed.

## Coding construction

Arithmetic uses GF(2^8) with reduction polynomial `0x11d`. The encoder forms an n×k Vandermonde matrix with row evaluation points 1 through n, then right-multiplies it by the inverse of its first k rows. This makes the first k generator rows the identity while preserving invertibility of every k-row subset.

The file is split into k contiguous blocks of `ceil(length/k)` bytes and padded with zeros. The first k shards contain those blocks directly; remaining shards are field-linear combinations. For the default 3-of-5 configuration the generator is:

```text
01 00 00
00 01 00
00 00 01
07 09 0f
07 08 0e
```

Recovery chooses the lowest k supplied indices, inverts their generator rows, and reconstructs the original data blocks. It verifies zero padding and the payload SHA-256, then re-encodes and compares **every supplied shard**, including extras beyond the recovery basis. The matrix and recovery inverse are inspectable and included in recovery evidence.

Parameters: 2≤k≤8, k≤n≤12, and source size 0–256 KiB. k=n is valid but offers no erasure tolerance. Distinct observations here are shard indices; duplicate indices and mixed set IDs are rejected. Empty source files are supported.

## Portable shards

Each shard is a JSON object with exactly these fields: `format`, `setId`, `k`, `n`, `length`, `size`, `payloadHash`, `index`, `data`, and `shardHash`. The format is `rescue-stripe-v1`, indices are zero-based in files, and the UI displays one-based indices. `data` is canonical base64. A random 128-bit set ID distinguishes separate encodings even when their source bytes match.

`shardHash` is SHA-256 of compact JSON containing the preceding fields in the listed order, excluding `shardHash`. Numeric values are integers and strings in that body are ASCII. `payloadHash` is SHA-256 of the original unpadded bytes. A bundle is `{format: "rescue-stripe-bundle-v1", shards: [...]}`. Imports allow 1–12 shards, at most 12 files totaling 3 MB, and validate exact metadata, dimensions, canonical base64, hashes, and set consistency.

Recovery evidence contains metadata, generator, inverse, selected basis, and the number of checked shards. It excludes raw shard/file bytes and is not a restorable backup. Use shard files or bundles for recovery. Original filenames are not stored; recovered bytes download as `rescue-stripe-recovered.bin`.

## Boundaries

This corrects **known erasures**, not unknown errors. Corrupt shards are rejected rather than automatically located/corrected. Exclude a damaged shard and supply another valid one. Recomputed checksums on inconsistent extra shards are caught by reconstruction checks, but checksums are not signatures: a malicious party that replaces the whole set and its metadata can create a different internally consistent file.

Erasure coding is not encryption or secret sharing. Data shards directly reveal portions of the file; parity and payload hashes also expose information. The app has no accounts, cloud distribution, encryption, automatic persistence, or protection against losing every shard in one failure domain. Save independent pieces where their failures are independent. Browser previews decode at most 512 bytes as UTF-8 and can show replacement characters for binary files; downloaded bytes remain exact.

## Verification

```sh
npm test
npm run check
python -m unittest discover -s tests -v
```

Seven JavaScript tests exhaust all 65,536 field products against independent polynomial multiplication, verify every allowed k-row recovery subset for every supported k/n generator, recover all three-of-five subsets of all 256 byte values, rebuild identical shard packages, recover the full 256 KiB boundary and empty files, and reject malformed/mixed/duplicate/corrupt inputs. A recomputed-checksum extra shard is specifically tested for consistency rejection. The Python test checks HTTP static-asset isolation. CI covers Node 22/24 on Linux and Node 24 on Windows.

Browser verification covers insufficient shards, two missing data shards, partial-bundle save/import, actual missing-index controls, full shard repair, corrupt import rejection, and a separate uploaded binary file using 2-of-3 coding. Prior verification used an independent Python polynomial-field decoder to check matrices, rebuilt shards, padding, and checksums.

Reference: Plank and Ding, [Note: Correction to the 1997 Tutorial on Reed–Solomon Coding](https://web.eecs.utk.edu/~jplank/plank/papers/CS-03-504.html), published in _Software: Practice and Experience_ 35(2), 2005. The construction here transforms a full Vandermonde matrix; it does not simply append arbitrary Vandermonde parity rows to an identity matrix.
