// Optional source audit: node audit.mjs. No dependencies or application imports.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const digest = value => createHash('sha256').update(value).digest('hex');
const bytes = await readFile(new URL('capture.bin', import.meta.url));
const metadata = JSON.parse(await readFile(new URL('capture-metadata.json', import.meta.url)));
assert.equal(digest(bytes), metadata.compressedCaptureSha256);
const capture = JSON.parse(gunzipSync(bytes));
const resources = new Map(capture.resources.map(resource => [resource.id, resource]));
const modules = capture.resources.filter(resource => resource.method === 'createShaderModule');
const group = (items, key) => {
  const result = new Map();
  for (const item of items) {
    const value = key(item);
    if (!result.has(value)) result.set(value, []);
    result.get(value).push(item);
  }
  return [...result.values()];
};
// Similarity detector only. Replacing literals is not a semantic equivalence test.
const shape = source => source.replace(/\b(?:\d+(?:\.\d*)?(?:[eE][+-]?\d+)?[ufih]?)\b/g, 'NUMBER');
const exact = group(modules, module => digest(module.descriptor.code));
const families = group(modules, module => digest(shape(module.descriptor.code)))
  .filter(family => new Set(family.map(module => digest(module.descriptor.code))).size > 1);
const treeModules = new Set();
for (const pipeline of capture.pipelines) {
  const vertex = pipeline.descriptor.vertex?.module.__gpuObject;
  if (!resources.get(vertex)?.descriptor.code?.includes('treeInstance')) continue;
  treeModules.add(vertex);
  const fragment = pipeline.descriptor.fragment?.module.__gpuObject;
  if (fragment !== undefined) treeModules.add(fragment);
}
const treeFamilies = families.filter(family => family.length === 6 && family.every(module => treeModules.has(module.id)));
const stagePrograms = group(capture.pipelines, pipeline => JSON.stringify(
  ['vertex', 'fragment', 'compute'].filter(stage => pipeline.descriptor[stage]).map(stage => {
    const { module, ...state } = pipeline.descriptor[stage];
    return [stage, digest(resources.get(module.__gpuObject).descriptor.code), state];
  })));
const describe = family => ({ moduleIds: family.map(module => module.id),
  sourceBytes: family.map(module => Buffer.byteLength(module.descriptor.code)),
  labels: [...new Set(family.map(module => module.descriptor.label ?? null))] });
console.log(JSON.stringify({ pipelines: capture.pipelines.length,
  render: capture.render, compute: capture.compute,
  moduleObjects: modules.length, distinctWGSL: exact.length,
  uniqueWGSLBytes: exact.reduce((sum, family) => sum + Buffer.byteLength(family[0].descriptor.code), 0),
  duplicateModuleObjects: modules.length - exact.length,
  stageProgramGroups: stagePrograms.length,
  additionalPipelinesSharingStagePrograms: capture.pipelines.length - stagePrograms.length,
  grassCompaction: describe(modules.filter(module => module.descriptor.label === 'compute_Grass blade compact')),
  grassRetainedWind: describe(modules.filter(module => module.descriptor.label === 'compute_Grass retained wind motion')),
  treeFamilies: treeFamilies.map(describe),
  treeIdentification: 'Vertex code contains treeInstance; fragment modules are paired with those vertices by captured pipelines.',
  limit: 'These counts describe the frozen capture. Similarity groups suggest candidates, not a verified consolidated implementation, current live-course count, or measured speedup.',
}, null, 2));
