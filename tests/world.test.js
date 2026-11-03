import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld, createWorld, raycastVoxel, SPAWN } from '../src/world.js';

test('plains have four solid layers and a clear spawn', () => {
  const world = createWorld({ trees: false });
  assert.equal(world.blocks.size, 64 * 64 * 4);
  assert.equal(world.get(0, -1, 7), 'grass');
  assert.equal(world.get(0, -2, 7), 'dirt');
  assert.equal(world.get(0, -4, 7), 'stone');
  assert.equal(world.get(Math.floor(SPAWN.x), 0, Math.floor(SPAWN.z)), null);
});

test('trees are deterministic and stay away from spawn', () => {
  const world = createWorld();
  assert.equal(world.get(-5, 0, -6), 'wood');
  assert.equal(world.get(-4, 3, -6), 'leaves');
  for (let y = 0; y < 3; y++) assert.equal(world.get(0, y, 7), null);
  assert.deepEqual([...world.blocks], [...createWorld().blocks]);
});

test('block edits reject occupied cells, invalid types, and world limits', () => {
  const world = new VoxelWorld();
  assert.equal(world.set(0, 0, 0, 'stone'), true);
  assert.equal(world.set(0, 0, 0, 'dirt'), false);
  assert.equal(world.set(0.1, 0, 0, 'dirt'), false);
  assert.equal(world.set(32, 0, 0, 'dirt'), false);
  assert.equal(world.set(0, 32, 0, 'dirt'), false);
  assert.equal(world.set(0, 0, 0, 'invalid'), false);
  assert.equal(world.remove(0, 0, 0), true);
  assert.equal(world.remove(0, 0, 0), false);
  assert.equal(world.get(0, 0, 0), null);
});

test('ray traversal hits the nearest voxel with the correct placement face', () => {
  const world = new VoxelWorld();
  world.set(0, 0, -2, 'wood');
  world.set(0, 0, -3, 'stone');
  const hit = raycastVoxel(world, { x: 0.5, y: 0.5, z: 2.5 }, { x: 0, y: 0, z: -2 });
  assert.equal(hit.type, 'wood');
  assert.equal(hit.z, -2);
  assert.equal(hit.distance, 3.5);
  assert.deepEqual(hit.normal, { x: 0, y: 0, z: 1 });
  assert.equal(raycastVoxel(world, { x: 0.5, y: 0.5, z: 2.5 }, { x: 0, y: 0, z: -1 }, 3), null);
});

test('ray traversal handles negative coordinates and floor faces', () => {
  const world = new VoxelWorld();
  world.set(-2, -1, -1, 'grass');
  const hit = raycastVoxel(world, { x: -1.5, y: 2, z: -0.5 }, { x: 0, y: -1, z: 0 });
  assert.deepEqual([hit.x, hit.y, hit.z], [-2, -1, -1]);
  assert.deepEqual(hit.normal, { x: 0, y: 1, z: 0 });
  assert.equal(hit.distance, 2);
  assert.equal(raycastVoxel(world, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), null);
});
