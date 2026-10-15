import { selectCapture } from './select.js';

const replayPipelineCapture = async function replayPipelineCapture({ capture, concurrency = 4 }) {
  const started = performance.now(), errors = [], resources = new Map(), timings = [];
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter || adapter.info?.isFallbackAdapter || /swiftshader|software|llvmpipe/i.test(adapter.info?.description ?? '')) throw Error('Hardware WebGPU required');
  const device = await adapter.requestDevice(capture.device.descriptor);
  const adapterInfo = Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(key => [key, adapter.info?.[key] ?? null]));
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  function hydrate(value) {
    if (!value || typeof value !== 'object') return value;
    if (Object.hasOwn(value, '__number')) return -0;
    if (Object.hasOwn(value, '__gpuObject')) {
      if (!resources.has(value.__gpuObject)) throw Error(`Missing resource ${value.__gpuObject}`);
      return resources.get(value.__gpuObject);
    }
    if (Array.isArray(value)) return value.map(hydrate);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrate(item)]));
  }
  const deviceReadyMs = performance.now() - started;
  device.pushErrorScope('validation');
  const resourceStart = performance.now(), resourceTimes = [];
  for (const resource of capture.resources) {
    const descriptor = hydrate(resource.descriptor), start = performance.now();
    resources.set(resource.id, device[resource.method](descriptor));
    resourceTimes.push({ id: resource.id, method: resource.method, ms: performance.now() - start });
  }
  const resourceMs = performance.now() - resourceStart;
  const descriptors = capture.pipelines.map(pipeline => hydrate(pipeline.descriptor));
  const pipelines = [], batchStart = performance.now();
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < capture.pipelines.length) {
      const i = index++, pipeline = capture.pipelines[i], start = performance.now();
      const method = pipeline.kind === 'compute' ? 'createComputePipelineAsync' : 'createRenderPipelineAsync';
      try {
        pipelines.push(await device[method](descriptors[i]));
        timings.push({ key: pipeline.key, kind: pipeline.kind, start: start - batchStart, ms: performance.now() - start });
      } catch (error) { errors.push({ key: pipeline.key, message: error.message }); }
    }
  }));
  const batchMs = performance.now() - batchStart;
  const validation = await device.popErrorScope();
  if (validation) errors.push(validation.message);
  // Keep all objects alive through measurement and an idle period for browser writes.
  window.__replayOwners = { device, resources, pipelines };
  const result = { adapter: adapterInfo, features: [...device.features], concurrency, deviceReadyMs, resourceMs,
    batchMs, totalMs: performance.now() - started, timings, resourceTimes, errors };
  document.querySelector('pre').textContent = JSON.stringify({ pipelines: pipelines.length, batchMs, resourceMs, errors }, null, 2);
  return result;
};
const compressed = await (await fetch('./capture.bin')).arrayBuffer();
const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', compressed))].map(b => b.toString(16).padStart(2, '0')).join('');
if (digest !== '1e116db6b2d8847d3638509b4755d43d9ddc20a126e15b6ebd12c47dad556b98') throw Error('Capture checksum mismatch');
const source = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const original = JSON.parse(source);
const count = Number(new URL(location.href).searchParams.get('count') ?? original.pipelines.length);
const capture = selectCapture(original, count);
window.capture = capture;
window.runReplay = async () => {
  if (window.__running) return;
  window.__running = true;
  document.querySelector('button').disabled = true;
  document.querySelector('pre').textContent = 'Creating captured WebGPU pipelines…';
  try {
    window.replayResult = await replayPipelineCapture({ capture, concurrency: 4 });
    const r = window.replayResult;
    document.querySelector('pre').textContent = JSON.stringify({
      pipelines: r.timings.length, pipelineBatchMs: r.batchMs,
      deviceReadyMs: r.deviceReadyMs, moduleLayoutSubmissionMs: r.resourceMs,
      requiredFeatures: capture.device.descriptor.requiredFeatures,
      adapter: r.adapter, errors: r.errors,
    }, null, 2);
  } catch (error) { document.querySelector('pre').textContent = error.stack; throw error; }
  finally { window.__running = false; document.querySelector('button').disabled = false; }
};
document.querySelector('button').onclick = window.runReplay;
document.querySelector('button').disabled = false;
document.querySelector('pre').textContent = capture.pipelines.length + ' pipelines loaded; checksum verified. Ready.';
