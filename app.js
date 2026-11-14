import { MAX_BYTES } from "./core.js";
const $ = (id) => document.getElementById(id),
  worker = new Worker("/worker.js", { type: "module" }),
  sample =
    "Rescue Stripe sample\nRecord: DEMO-2048\nPayload: file recovery check\n";
let source = new TextEncoder().encode(sample),
  sourceName = "sample-record.txt",
  stripe = null,
  available = new Set(),
  recovered = null,
  busy = false,
  sequence = 0,
  pending = "";
function el(tag, text) {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function download(name, data, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function clearRecovery() {
  recovered = null;
  document.querySelector(".recovery").classList.remove("verified");
  $("recovery-title").textContent = "No recovery attempted.";
  $("recovery-note").textContent = "Choose at least k distinct shards.";
  $("preview").textContent =
    "Recovered UTF-8 preview appears here. Binary files may contain replacement characters.";
  $("inverse").textContent = "";
}
function controls() {
  for (const id of ["choose", "example", "import", "k", "n"])
    $(id).disabled = busy;
  $("encode-button").disabled = busy || !source;
  $("recover").disabled = busy || !stripe || available.size < stripe.metadata.k;
  $("bundle").disabled = busy || !available.size;
  $("lose").disabled = busy || !stripe;
  $("download").disabled =
    $("repair").disabled =
    $("evidence").disabled =
      busy || !recovered;
  document
    .querySelectorAll(".shard input,.shard button")
    .forEach(
      (n) =>
        (n.disabled =
          busy ||
          (n.tagName === "INPUT" &&
            !stripe?.shards.some((s) => s.index === Number(n.dataset.index)))),
    );
  $("filename").textContent = sourceName;
  $("source-size").textContent = source
    ? `${source.length.toLocaleString()} source bytes · local computation`
    : "Imported shards · choose a source file to encode another stripe.";
}
function render() {
  controls();
  $("shards").replaceChildren();
  if (!stripe) return;
  const { metadata, matrix } = stripe;
  const selected = available.size;
  $("availability-label").textContent =
    `${selected} / ${metadata.n} available · ${metadata.k} required`;
  $("availability-fill").style.width = `${(100 * selected) / metadata.n}%`;
  $("required-mark").style.left = `${(100 * metadata.k) / metadata.n}%`;
  document
    .querySelector(".availability")
    .classList.toggle("insufficient", selected < metadata.k);
  $("stripe-info").textContent =
    `${metadata.k} required / ${metadata.n} total · ${selected} available · ${metadata.size} bytes per shard · ${metadata.length} original bytes · ${(metadata.n * metadata.size).toLocaleString()} encoded payload bytes (before JSON).`;
  for (let i = 0; i < metadata.n; i++) {
    const shard = stripe.shards.find((s) => s.index === i),
      card = el("article", "");
    card.className =
      "shard" +
      (i >= metadata.k ? " parity" : "") +
      (!available.has(i) ? " unavailable" : "");
    const label = el("label", ""),
      check = document.createElement("input");
    check.type = "checkbox";
    check.dataset.index = String(i);
    check.checked = available.has(i);
    check.disabled = busy || !shard;
    check.setAttribute("aria-label", "Shard " + (i + 1) + " available");
    check.onchange = () => {
      if (check.checked) available.add(i);
      else available.delete(i);
      clearRecovery();
      render();
      $("shards").querySelector(`input[data-index="${i}"]`)?.focus();
      message(
        available.size >= metadata.k
          ? "Enough shards selected for recovery."
          : `Need ${metadata.k - available.size} more distinct shards.`,
      );
    };
    label.append(check, document.createTextNode("Shard " + (i + 1)));
    card.append(
      label,
      el("strong", i < metadata.k ? "Data" : "Parity"),
      el(
        "p",
        shard
          ? available.has(i)
            ? "Available"
            : "Marked unavailable"
          : "Not imported",
      ),
    );
    if (shard) {
      const bytes = atob(shard.data).slice(0, 32),
        canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 64;
      canvas.className = "shard-bytes";
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        `First ${bytes.length} payload bytes; cell brightness indicates byte value`,
      );
      const ctx = canvas.getContext("2d");
      for (let j = 0; j < bytes.length; j++) {
        const lightness = 23 + (bytes.charCodeAt(j) / 255) * 55;
        ctx.fillStyle = `hsl(${i < metadata.k ? 188 : 35} 35% ${lightness}%)`;
        ctx.fillRect((j % 8) * 16, Math.floor(j / 8) * 16, 14, 14);
      }
      card.append(canvas);
      const b = el("button", "Save shard");
      b.disabled = busy;
      b.onclick = () =>
        download(
          `stripe-${metadata.setId}-${i + 1}.json`,
          JSON.stringify(shard, null, 2) + "\n",
        );
      card.append(b);
    }
    $("shards").append(card);
  }
  $("matrix").textContent =
    "Generator rows (hex):\n" +
    matrix
      .map(
        (row, i) =>
          String(i + 1).padStart(2, " ") +
          "  " +
          row.map((x) => x.toString(16).padStart(2, "0")).join(" "),
      )
      .join("\n");
  controls();
}
function send(mode, data) {
  if (busy) return;
  pending = mode;
  busy = true;
  clearRecovery();
  controls();
  message(
    mode === "recover"
      ? "Solving from the selected shards and checking every available shard…"
      : mode === "encode"
        ? "Encoding data and parity blocks…"
        : "Checking shard identities and checksums…",
  );
  worker.postMessage({ id: ++sequence, mode, ...data });
}
worker.onmessage = ({ data }) => {
  if (data.id !== sequence) return;
  busy = false;
  if (data.error) {
    controls();
    message(data.error, true);
    return;
  }
  if (pending === "recover") {
    recovered = { ...data.result, bytes: new Uint8Array(data.result.bytes) };
    document.querySelector(".recovery").classList.add("verified");
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      $("preview").animate(
        [
          { opacity: 0.4, transform: "translateY(5px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 350, easing: "ease-out" },
      );
    $("recovery-title").textContent =
      `${recovered.bytes.length} bytes recovered.`;
    $("recovery-note").textContent =
      `Used shards ${recovered.basis.map((i) => i + 1).join(", ")}; checked ${recovered.checkedShards} available shards. Payload SHA-256: ${recovered.metadata.payloadHash}`;
    $("preview").textContent =
      new TextDecoder().decode(recovered.bytes.slice(0, 512)) || "(empty file)";
    $("inverse").textContent =
      "Recovery inverse (hex):\n" +
      recovered.inverseMatrix
        .map((row) => row.map((x) => x.toString(16).padStart(2, "0")).join(" "))
        .join("\n");
    controls();
    message("Reconstruction matches the payload hash and all provided shards.");
  } else {
    stripe = data.result;
    available = new Set(stripe.shards.map((s) => s.index));
    if (pending === "load") {
      source = null;
      sourceName = "Imported shard set";
      $("k").value = stripe.metadata.k;
      $("n").value = stripe.metadata.n;
    }
    render();
    message(
      pending === "load"
        ? "Shard set loaded. Missing indices remain unavailable."
        : "Stripe encoded. Uncheck pieces to simulate missing shards.",
    );
  }
};
worker.onerror = () => {
  busy = false;
  controls();
  message("Coding worker failed. Reload to restart.", true);
};
$("encode").onsubmit = (e) => {
  e.preventDefault();
  if (source)
    send("encode", {
      bytes: source.slice().buffer,
      k: Number($("k").value),
      n: Number($("n").value),
    });
};
$("choose").onclick = () => $("file").click();
$("file").onchange = async () => {
  const file = $("file").files[0];
  $("file").value = "";
  if (!file) return;
  try {
    if (file.size > MAX_BYTES) throw Error("Files are limited to 256 KiB.");
    source = new Uint8Array(await file.arrayBuffer());
    sourceName = file.name;
    controls();
    message("Source loaded. Encode to replace the current stripe.");
  } catch (error) {
    message(error.message, true);
  }
};
$("example").onclick = () => {
  source = new TextEncoder().encode(sample);
  sourceName = "sample-record.txt";
  controls();
  message("Example loaded. Encode to replace the current stripe.");
};
$("lose").onclick = () => {
  available.delete(0);
  available.delete(1);
  clearRecovery();
  render();
  message(
    available.size >= stripe.metadata.k
      ? "First two shards are unavailable. Recover from the remaining pieces."
      : "Too few shards remain. Restore checkboxes or import more pieces.",
  );
};
$("recover").onclick = () => {
  if (stripe)
    send("recover", {
      shards: stripe.shards.filter((s) => available.has(s.index)),
    });
};
$("bundle").onclick = () => {
  if (stripe)
    download(
      "rescue-stripe-bundle.json",
      JSON.stringify(
        {
          format: "rescue-stripe-bundle-v1",
          shards: stripe.shards.filter((s) => available.has(s.index)),
        },
        null,
        2,
      ) + "\n",
    );
};
$("download").onclick = () => {
  if (recovered)
    download(
      "rescue-stripe-recovered.bin",
      recovered.bytes,
      "application/octet-stream",
    );
};
$("repair").onclick = () => {
  if (recovered) {
    stripe = {
      metadata: recovered.metadata,
      matrix: recovered.matrix,
      shards: recovered.repaired,
    };
    available = new Set(stripe.shards.map((s) => s.index));
    render();
    message(
      "All shards rebuilt from the recovered data, including missing indices.",
    );
  }
};
$("evidence").onclick = () => {
  if (recovered) {
    const { bytes, repaired, ...evidence } = recovered;
    download(
      "rescue-stripe-evidence.json",
      JSON.stringify(
        { format: "rescue-stripe-evidence-v1", ...evidence },
        null,
        2,
      ) + "\n",
    );
  }
};
$("import").onclick = () => $("shard-files").click();
$("shard-files").onchange = async () => {
  const files = [...$("shard-files").files];
  $("shard-files").value = "";
  if (!files.length) return;
  try {
    if (
      files.length > 12 ||
      files.reduce((sum, f) => sum + f.size, 0) > 3000000
    )
      throw Error("Import at most 12 files totaling 3 MB.");
    const shards = [];
    for (const file of files) {
      const parsed = JSON.parse(await file.text());
      if (parsed?.format === "rescue-stripe-bundle-v1") {
        if (
          Object.keys(parsed).sort().join(",") !== "format,shards" ||
          !Array.isArray(parsed.shards)
        )
          throw Error("Invalid shard bundle.");
        shards.push(...parsed.shards);
      } else shards.push(parsed);
    }
    send("load", { shards });
  } catch (error) {
    message(error.message, true);
  }
};
controls();
send("encode", { bytes: source.slice().buffer, k: 3, n: 5 });
