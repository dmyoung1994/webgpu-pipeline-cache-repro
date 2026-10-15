// Keep only resources reachable from the selected pipeline descriptors. The
// control must not submit the full workload's shader modules in the background.
export function selectCapture(capture, count) {
  if (!Number.isInteger(count) || count < 1 || count > capture.pipelines.length)
    throw new Error('Invalid pipeline count');
  const pipelines = capture.pipelines.slice(0, count);
  const byId = new Map(capture.resources.map(resource => [resource.id, resource]));
  const needed = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, '__gpuObject')) {
      const id = value.__gpuObject;
      if (needed.has(id)) return;
      const resource = byId.get(id);
      if (!resource) throw new Error(`Missing resource ${id}`);
      needed.add(id); visit(resource.descriptor);
    } else for (const child of Object.values(value)) visit(child);
  }
  for (const pipeline of pipelines) visit(pipeline.descriptor);
  return { ...capture, pipelines, resources: capture.resources.filter(resource => needed.has(resource.id)),
    render: pipelines.filter(pipeline => pipeline.kind === 'render').length,
    compute: pipelines.filter(pipeline => pipeline.kind === 'compute').length };
}
