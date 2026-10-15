# WebGPU pipeline-cache reload repro

One page replays 212 fixed pipeline descriptors and their WGSL from a golf
simulator. No Three.js runtime, textures, geometry, uploads, draws or game logic.
The compressed capture is 893 KB. A 32-pipeline control is on the same page.

## Run

From this directory:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

1. Open `http://127.0.0.1:8000/?count=212` in a fresh, dedicated Chrome profile.
2. Click **Run exact replay** once. Wait four seconds after completion.
3. Reload the page and click Run again. The inputs remain identical.
4. Close that Chrome process completely, reopen the same profile and URL, and run.

Repeat with a separate fresh profile and `?count=32` for the smaller control.
Keep the origin, profile, backend and concurrency unchanged within each series.
OS/driver caches are not cleared. Incognito is not the restart control.

Requires hardware WebGPU, `subgroups`, `texture-formats-tier1`, and a limit of 24
sampled textures per stage. Tested without `--enable-unsafe-webgpu`. Unsupported
requests fail visibly; no software fallback or feature substitution is used.

## What is timed

`pipelineBatchMs` measures asynchronous creation at concurrency four. Fetching,
decompression, parsing and device acquisition are excluded. Shader-module and
layout *submission* precede the batch, so their queued native work can overlap it.
The 32 control also removes unreachable modules/layouts. Nothing is dispatched
or rendered. Full results are available as `window.replayResult`.

To distinguish compiler work from API calls, trace `gpu`, `gpu.dawn`,
`gpu.dawn.validation`, `gpu.dawn.recording`, and count `CompileShaderDXC` on D3D12.
See `results.json` for the verified standalone-page measurements.

Windows, Chrome 155.0.8059.41, RTX 4090 / driver 595.95, D3D12:

| Case | First run | Reload | Restart | DXC calls, first / reload / restart |
| --- | ---: | ---: | ---: | ---: |
| 212 pipelines, default | 7.713 s | 7.622 s | 4.474 s | 334 / 322 / 220 |
| 32-pipeline control | 2.220 s | 0.064 s | 0.064 s | 56 / 0 / 0 |
| 212, browser-only 64 MiB switch | 8.255 s | 8.154 s | 4.441 s | 333 / 322 / 218 |
| 212, aggressive policy | 7.761 s | 7.481 s | 1.387 s | 318 / 289 / 48 |

These are single traced series, with four seconds idle after each batch and
graceful browser exits. They establish repeated compiler work, not a guaranteed
timing on other machines. `AggressiveShaderCacheLimits` does not eliminate it.

## Cache-size diagnostic

We tested `--gpu-disk-cache-size-kb=65536` with another dedicated browser profile.
The flag was present in the browser command line and absent from the actual GPU
child's command line. This does **not** establish the result of a 64 MiB Dawn
resident-cache budget. The effective budget was not instrumented.

The matching Chromium source reads the switch from the calling process in
[gpu_preferences.cc](https://chromium.googlesource.com/chromium/src/+/155.0.8059.41/gpu/config/gpu_preferences.cc).
The GPU-process switch forwarding is in
[gpu_process_host.cc](https://chromium.googlesource.com/chromium/src/+/155.0.8059.41/content/browser/gpu/gpu_process_host.cc).
`AggressiveShaderCacheLimits` is a separate diagnostic, changing capacity and
retention together. Neither flag is a proposed player requirement.

## Why so many shaders? Can they be shared?

This frozen capture contains **158 render pipelines and 54 compute pipelines**.
Its 321 shader-module objects contain 317 distinct WGSL sources (6.11 MB before
compression). A pipeline is not a material: loading, vegetation, terrain, shadows,
reflections and post-processing require different stages and pipeline states.
Application constants and instance-array sizes also create avoidable variants.

| Candidate | What the capture shows | Possible change |
| --- | --- | --- |
| Procedural trees | 72 sources, in 12 groups of six with matching structure after numeric-literal normalization; 1.45 MB total | Move height, canopy shading and collar-fade values into uniforms; share compatible instance-buffer layouts rather than specializing array lengths |
| Grass compaction | Five 149 KB compute sources, specialized by partition and distance level | One shared program with per-dispatch uniforms, potentially removing four pipelines |
| Retained grass wind | Three compute sources differing in counter and record offsets | One shared program with uniform offsets, potentially removing two pipelines |

These are source-audit candidates, **not implemented optimizations or measured
speedups**. Tree stages cannot be counted as pipelines saved: layouts, vertex
inputs and pass state still need checking. Grass specialization currently permits
constant folding; replacing it with uniforms needs a runtime performance check.

Four module objects are exact source duplicates. There are also eight additional
pipelines sharing stage programs with another pipeline; their fixed state or
layouts differ, so uniforms alone do not make them interchangeable. Separately,
the application has already consolidated its terrain-nap seed/bounds variants
using uniforms (54 to 53 startup compute pipelines in matched app captures). That
change is intentionally absent from this fixed repro; no end-to-end timing gain
has been established for it.

Run the dependency-free audit with Node.js:

```sh
node audit.mjs
```

It verifies the capture checksum and reproduces the inventory and numeric
similarity groups in `shader-audit.json`. Numeric similarity is a search aid,
not proof that two shaders are semantically interchangeable. These counts describe
this capture, not every course or the current application's pipeline inventory.

## Sources and license

`capture.bin` is gzip-compressed **JSON source**, with WGSL strings and descriptors.
Its checksum and counts are in `capture-metadata.json`. It contains no compiled
binaries, asset payloads, credentials or browser-profile data. The 212 pipelines
cover loading, terrain/vegetation, shadow/reflection and presentation passes.

To inspect the JSON with Python:

```python
import gzip, json
with gzip.open("capture.bin", "rt", encoding="utf-8") as f:
    capture = json.load(f)
```

The replay and included shader sources are MIT licensed within this directory.
Generated WGSL includes Three.js r185.1 code; its license is retained in
`THREE-LICENSE.txt`. This license does not apply to the surrounding simulator.
