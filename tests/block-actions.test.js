/** 採掘と設置で、地形と所持品の合計が保存されることを実データで確認する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_TYPES, VoxelWorld } from '../src/world.js';
import { createInventory } from '../src/inventory.js';
import { mineBlock, placeBlock } from '../src/block-actions.js';

// 対応するどの素材も、壊した種類をそのまま1個だけ受け取る。
test('mining each supported block removes it and grants exactly its own material', () => {
  const world = new VoxelWorld();
  const inventory = createInventory();
  for (const [x, type] of BLOCK_TYPES.entries()) {
    world.set(x, 0, 0, type);
    assert.deepEqual(mineBlock(world, inventory, x, 0, 0), { ok: true, type, error: null });
    assert.equal(world.get(x, 0, 0), null);
    assert.equal(inventory.count(type), 1);
  }
  assert.equal(world.blocks.size, 0);
  assert.deepEqual(inventory.slots, BLOCK_TYPES);
});

// 同じ空間を連打しても、元の1個以上には増えない。
test('repeated mining cannot duplicate an already removed block', () => {
  const world = new VoxelWorld();
  const inventory = createInventory();
  world.set(0, 0, 0, 'grass');
  assert.equal(mineBlock(world, inventory, 0, 0, 0).ok, true);
  assert.deepEqual(mineBlock(world, inventory, 0, 0, 0), { ok: false, type: null, error: 'empty' });
  assert.equal(inventory.count('grass'), 1);
});

// 入手していない素材は、空いている場所でも置けない。
test('placing without acquired stock leaves the world and inventory empty', () => {
  const world = new VoxelWorld();
  const inventory = createInventory();
  for (const type of [...BLOCK_TYPES, null, 'water']) {
    assert.equal(placeBlock(world, inventory, type, 0, 0, 0).ok, false);
  }
  assert.equal(world.blocks.size, 0);
  assert.equal(Object.values(inventory.counts).reduce((a, b) => a + b, 0), 0);
});

// 設置成功で1個だけ減り、最後の1個の後は追加設置できない。
test('successful placement consumes one item and cannot continue at zero', () => {
  const world = new VoxelWorld();
  const inventory = createInventory();
  inventory.add('stone', 2);
  assert.equal(placeBlock(world, inventory, 'stone', 0, 0, 0).ok, true);
  assert.equal(inventory.count('stone'), 1);
  assert.equal(placeBlock(world, inventory, 'stone', 1, 0, 0).ok, true);
  assert.equal(inventory.count('stone'), 0);
  assert.equal(placeBlock(world, inventory, 'stone', 2, 0, 0).ok, false);
  assert.equal(world.get(2, 0, 0), null);
  assert.equal(world.blocks.size, 2);
});

// 占有済みやワールド範囲外では設置に失敗し、所持数を失わない。
test('failed placement at occupied or invalid coordinates never consumes stock', () => {
  const world = new VoxelWorld();
  const inventory = createInventory();
  inventory.add('wood', 3);
  world.set(0, 0, 0, 'grass');
  for (const position of [[0, 0, 0], [32, 0, 0], [0, 32, 0], [0.5, 0, 0], [0, -5, 0]]) {
    assert.equal(placeBlock(world, inventory, 'wood', ...position).ok, false);
    assert.equal(inventory.count('wood'), 3);
  }
  assert.equal(world.get(0, 0, 0), 'grass');
  assert.equal(world.blocks.size, 1);
});

// 壊す・置くを繰り返しても、ワールドのブロックと所持数の合計は1個のまま。
test('repeated mine and place round trips conserve the original block', () => {
  const world = new VoxelWorld();
  const inventory = createInventory();
  world.set(0, 0, 0, 'dirt');
  for (let index = 0; index < 10; index++) {
    assert.equal(mineBlock(world, inventory, 0, 0, 0).ok, true);
    assert.equal(world.blocks.size + inventory.count('dirt'), 1);
    assert.equal(placeBlock(world, inventory, 'dirt', 0, 0, 0).ok, true);
    assert.equal(world.blocks.size + inventory.count('dirt'), 1);
  }
  assert.equal(inventory.count('dirt'), 0);
});

// 受け取り上限なら採掘前に止め、地形を失わない。
test('mining preflights capacity before removing a block', () => {
  const world = new VoxelWorld();
  const inventory = createInventory();
  world.set(0, 0, 0, 'grass');
  inventory.add('grass', Number.MAX_SAFE_INTEGER);
  assert.equal(mineBlock(world, inventory, 0, 0, 0).error, 'capacity');
  assert.equal(world.get(0, 0, 0), 'grass');
  assert.equal(inventory.count('grass'), Number.MAX_SAFE_INTEGER);
});

// 消去できない地形からは、素材を受け取れない。
test('a refused world removal does not grant materials', () => {
  const world = new VoxelWorld();
  const inventory = createInventory();
  world.set(0, 0, 0, 'leaves');
  const protectedWorld = { get: (...args) => world.get(...args), remove: () => false };
  assert.equal(mineBlock(protectedWorld, inventory, 0, 0, 0).ok, false);
  assert.equal(world.get(0, 0, 0), 'leaves');
  assert.equal(inventory.count('leaves'), 0);
});

// 通常は起きない受取拒否にも、ブロックを戻して対処する。
test('an unexpected inventory add failure restores the mined block', () => {
  const world = new VoxelWorld();
  world.set(0, 0, 0, 'sand');
  const refusingInventory = { canAdd: () => true, add: () => false };
  assert.equal(mineBlock(world, refusingInventory, 0, 0, 0).ok, false);
  assert.equal(world.get(0, 0, 0), 'sand');
});

// 消費を拒否された場合も、無料のブロックをワールドに残さない。
test('an unexpected inventory consume failure removes the newly placed block', () => {
  const world = new VoxelWorld();
  const refusingInventory = { count: () => 1, consume: () => false };
  assert.equal(placeBlock(world, refusingInventory, 'wood', 0, 0, 0).ok, false);
  assert.equal(world.blocks.size, 0);
});
