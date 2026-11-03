import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, VoxelWorld } from '../src/world.js';
import { PlayerPhysics, PLAYER_RADIUS } from '../src/physics.js';

function simulate(player, seconds, input = {}, fps = 60) {
  for (let i = 0; i < Math.ceil(seconds * fps); i++) player.step(1 / fps, input, 0);
}

test('gravity lands on the floor and never sinks through it', () => {
  const player = new PlayerPhysics(createWorld({ trees: false }), { x: 0.5, y: 8, z: 0.5 });
  simulate(player, 4);
  assert.equal(player.position.y, 0);
  assert.equal(player.grounded, true);
  assert.equal(player.velocity.y, 0);
});

test('jump rises, lands, and holding Space does not automatically jump again', () => {
  const player = new PlayerPhysics(createWorld({ trees: false }));
  simulate(player, 0.3, { jump: true });
  assert.ok(player.position.y > 1);
  simulate(player, 1.2, { jump: true });
  assert.equal(player.position.y, 0);
  assert.equal(player.grounded, true);
  simulate(player, 0.1, { jump: false });
  simulate(player, 0.1, { jump: true });
  assert.ok(player.position.y > 0.5);
});

test('solid walls stop walking and sprinting while allowing sideways sliding', () => {
  const world = createWorld({ trees: false });
  for (let x = -6; x <= 6; x++) for (let y = 0; y < 3; y++) world.set(x, y, -2, 'stone');
  const player = new PlayerPhysics(world, { x: 0.5, y: 0, z: 0.5 });
  simulate(player, 2, { forward: 1, sprint: true }, 10);
  assert.ok(player.position.z >= -1 + PLAYER_RADIUS - 1e-8);
  const before = player.position.x;
  simulate(player, 0.5, { forward: 1, right: 1 });
  assert.ok(player.position.x > before + 1);
  assert.equal(player.position.y, 0);
});

test('removing support lets the player fall onto the layer below', () => {
  const world = createWorld({ trees: false });
  const player = new PlayerPhysics(world, { x: 0.5, y: 0, z: 0.5 });
  world.remove(0, -1, 0);
  simulate(player, 1);
  assert.equal(player.position.y, -1);
  assert.equal(player.grounded, true);
});

test('the player cannot jump through a low ceiling', () => {
  const world = createWorld({ trees: false });
  world.set(0, 2, 0, 'stone');
  const player = new PlayerPhysics(world, { x: 0.5, y: 0, z: 0.5 });
  simulate(player, 0.1, { jump: true });
  assert.ok(player.position.y <= 0.2 + 1e-8);
  simulate(player, 0.8);
  assert.equal(player.position.y, 0);
});

test('placement overlap includes the feet and head, but excludes touching surfaces', () => {
  const player = new PlayerPhysics(createWorld({ trees: false }), { x: 0.5, y: 0, z: 0.5 });
  assert.equal(player.intersectsBlock(0, 0, 0), true);
  assert.equal(player.intersectsBlock(0, 1, 0), true);
  assert.equal(player.intersectsBlock(0, -1, 0), false);
  assert.equal(player.intersectsBlock(1, 0, 0), false);
});

test('diagonal movement has the same speed as straight movement', () => {
  const world = createWorld({ trees: false });
  const straight = new PlayerPhysics(world, { x: 0.5, y: 0, z: 0.5 });
  const diagonal = new PlayerPhysics(world, { x: 0.5, y: 0, z: 0.5 });
  simulate(straight, 1, { forward: 1 });
  simulate(diagonal, 1, { forward: 1, right: 1 });
  const distance = player => Math.hypot(player.position.x - 0.5, player.position.z - 0.5);
  assert.ok(Math.abs(distance(straight) - distance(diagonal)) < 1e-8);
});

test('falling outside the world respawns safely', () => {
  const world = createWorld({ trees: false });
  const player = new PlayerPhysics(world);
  player.position.y = -25;
  player.step(1 / 60, {});
  assert.deepEqual(player.position, { x: 0.5, y: 0, z: 7.5 });
  assert.equal(player.velocity.y, 0);
});

test('respawn chooses a nearby supported column after the spawn floor is mined out', () => {
  const world = createWorld({ trees: false });
  for (let y = -4; y < 0; y++) world.remove(0, y, 7);
  const expectedSize = world.blocks.size;
  const player = new PlayerPhysics(world);
  player.position.y = -25;
  player.step(1 / 60, {});
  assert.equal(player.grounded, true);
  assert.equal(player.position.y, 0);
  assert.notDeepEqual([player.position.x, player.position.z], [0.5, 7.5]);
  assert.equal(player.collisions().length, 0);
  assert.equal(world.blocks.size, expectedSize);
  simulate(player, 2);
  assert.equal(player.position.y, 0);
});

test('respawn finds headroom above blocks placed at the original spawn', () => {
  const world = createWorld({ trees: false });
  world.set(0, 0, 7, 'stone');
  world.set(0, 1, 7, 'stone');
  const player = new PlayerPhysics(world);
  player.reset();
  assert.deepEqual(player.position, { x: 0.5, y: 2, z: 7.5 });
  assert.equal(player.grounded, true);
  assert.equal(player.collisions().length, 0);
  simulate(player, 2);
  assert.equal(player.position.y, 2);
});

test('respawn can stand on remaining lower terrain without regenerating the removed grass', () => {
  const world = createWorld({ trees: false });
  world.remove(0, -1, 7);
  const player = new PlayerPhysics(world);
  player.reset();
  assert.deepEqual(player.position, { x: 0.5, y: -1, z: 7.5 });
  assert.equal(player.grounded, true);
  assert.equal(world.get(0, -1, 7), null);
});

test('respawn in an entirely empty world remains deterministic and does not mutate terrain', () => {
  const world = new VoxelWorld();
  const player = new PlayerPhysics(world);
  player.reset();
  assert.deepEqual(player.position, { x: 0.5, y: 0, z: 7.5 });
  assert.equal(world.blocks.size, 0);
  assert.equal(player.grounded, false);
});

test('a high-speed fall still collides with the top ground surface', () => {
  const player = new PlayerPhysics(createWorld({ trees: false }), { x: 0.5, y: 12, z: 0.5 });
  player.velocity.y = -500;
  player.step(0.1, {});
  assert.equal(player.position.y, 0);
  assert.equal(player.grounded, true);
  assert.equal(player.collisions().length, 0);
});

test('long-frame diagonal motion cannot pass through a block corner', () => {
  const world = createWorld({ trees: false });
  world.set(1, 0, -1, 'stone');
  world.set(1, 1, -1, 'stone');
  const player = new PlayerPhysics(world, { x: 0.5, y: 0, z: 0.5 });
  for (let i = 0; i < 12; i++) {
    player.step(1, { forward: 1, right: 1, sprint: true }, 0);
    assert.equal(player.collisions().length, 0);
    if (player.position.x < 2 + PLAYER_RADIUS) assert.ok(player.position.z >= PLAYER_RADIUS);
  }
  assert.ok(player.position.x > 2 + PLAYER_RADIUS, 'sliding eventually clears the block corner');
  assert.equal(player.position.y, 0);
});
