/** 獲得した素材の個数と、ホットバーのショートカットを独立して確認する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_TYPES } from '../src/world.js';
import { createInventory } from '../src/inventory.js';

// 起動直後にはブロックを持たず、何も獲得せずに登録することもできない。
test('inventory starts empty with zero counts for every supported material', () => {
  const inventory = createInventory();
  assert.deepEqual(inventory.slots, Array(6).fill(null));
  assert.deepEqual(inventory.counts, Object.fromEntries(BLOCK_TYPES.map(type => [type, 0])));
  assert.equal(inventory.selected, 0);
  assert.equal(inventory.selectedType, null);
  for (const type of BLOCK_TYPES) assert.equal(inventory.assign(type), false);
});

// 空のスロットも選択でき、番号は左右どちらへも循環する。
test('empty slot selection wraps without granting materials', () => {
  const inventory = createInventory();
  assert.equal(inventory.select(-1), 5);
  assert.equal(inventory.select(6), 0);
  assert.equal(inventory.select(13), 1);
  assert.equal(inventory.select(-13), 5);
  for (const invalid of [NaN, Infinity, 1.5, '1', null, undefined]) assert.equal(inventory.select(invalid), 5);
  assert.equal(inventory.selectedType, null);
  assert.equal(inventory.count('grass'), 0);
});

// 新しく獲得した種類を、最初に空いているスロットへ登録する。
test('collecting a new material fills the first empty shortcut and accumulates counts', () => {
  const inventory = createInventory();
  assert.equal(inventory.add('grass'), true);
  assert.equal(inventory.selectedType, 'grass');
  assert.equal(inventory.count('grass'), 1);
  assert.equal(inventory.add('grass', 2), true);
  assert.equal(inventory.add('wood'), true);
  assert.deepEqual(inventory.slots, ['grass', 'wood', null, null, null, null]);
  assert.equal(inventory.count('grass'), 3);
  assert.equal(inventory.count('wood'), 1);
});

// 登録先の変更はショートカットだけを変え、所持数そのものには影響しない。
test('assigning an owned material changes the selected shortcut without increasing stock', () => {
  const inventory = createInventory();
  inventory.add('wood', 2);
  inventory.select(3);
  assert.equal(inventory.assign('wood'), true);
  assert.equal(inventory.selectedType, 'wood');
  assert.equal(inventory.count('wood'), 2);
  assert.equal(inventory.assign('stone'), false);
  assert.equal(inventory.selectedType, 'wood');
});

// 同じ種類を複数のショートカットへ登録しても、共有在庫は複製されない。
test('duplicate shortcuts share one stock pool and all clear when its last item is spent', () => {
  const inventory = createInventory();
  inventory.add('stone', 2);
  for (let index = 0; index < 6; index++) assert.equal(inventory.assign('stone', index), true);
  assert.equal(inventory.count('stone'), 2);
  assert.equal(inventory.consume('stone'), true);
  assert.deepEqual(inventory.slots, Array(6).fill('stone'));
  assert.equal(inventory.count('stone'), 1);
  assert.equal(inventory.consume('stone'), true);
  assert.deepEqual(inventory.slots, Array(6).fill(null));
  assert.equal(inventory.selectedType, null);
  assert.equal(inventory.consume('stone'), false);
  assert.equal(inventory.count('stone'), 0);
});

// 在庫が足りない要求は、途中まで消費せず、状態をそのまま保つ。
test('insufficient consumption never creates negative stock or changes shortcuts', () => {
  const inventory = createInventory();
  inventory.add('grass', 2);
  const slots = inventory.slots;
  assert.equal(inventory.consume('grass', 3), false);
  assert.equal(inventory.count('grass'), 2);
  assert.deepEqual(inventory.slots, slots);
  assert.equal(inventory.consume('grass', 2), true);
  assert.equal(inventory.count('grass'), 0);
  assert.equal(inventory.assign('grass'), false);
});

// ショートカットが埋まっていても、獲得した素材の個数は保持する。
test('a full shortcut bar does not discard a newly collected material', () => {
  const inventory = createInventory(['grass', 'stone']);
  inventory.add('grass');
  inventory.assign('grass', 1);
  assert.equal(inventory.add('stone'), true);
  assert.deepEqual(inventory.slots, ['grass', 'grass']);
  assert.equal(inventory.count('stone'), 1);
  assert.equal(inventory.assign('stone', 1), true);
  assert.deepEqual(inventory.slots, ['grass', 'stone']);
});

// 空になった種類をもう一度獲得すれば、自動で空きスロットへ戻る。
test('collecting a depleted material registers a usable shortcut again', () => {
  const inventory = createInventory();
  inventory.add('leaves');
  inventory.consume('leaves');
  inventory.add('leaves');
  assert.equal(inventory.selectedType, 'leaves');
  assert.equal(inventory.count('leaves'), 1);
});

// 小数・文字列・負数・危険な桁の個数では、在庫を書き換えない。
test('invalid quantities and unsupported material names leave inventory unchanged', () => {
  const inventory = createInventory();
  inventory.add('grass', 2);
  const before = { counts: inventory.counts, slots: inventory.slots };
  for (const amount of [0, -1, 0.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(inventory.canAdd('grass', amount), false);
    assert.equal(inventory.add('grass', amount), false);
    assert.equal(inventory.consume('grass', amount), false);
  }
  for (const type of ['water', '__proto__', 'constructor', null, undefined, {}, 2]) {
    assert.equal(inventory.count(type), 0);
    assert.equal(inventory.add(type), false);
    assert.equal(inventory.consume(type), false);
    assert.equal(inventory.assign(type), false);
  }
  assert.deepEqual({ counts: inventory.counts, slots: inventory.slots }, before);
});

// 安全な整数の上限を超えて増やせないことも確認する。
test('stock capacity rejects overflow without changing a safe integer balance', () => {
  const inventory = createInventory();
  assert.equal(inventory.add('sand', Number.MAX_SAFE_INTEGER), true);
  assert.equal(inventory.canAdd('sand'), false);
  assert.equal(inventory.add('sand'), false);
  assert.equal(inventory.count('sand'), Number.MAX_SAFE_INTEGER);
  assert.equal(inventory.consume('sand', Number.MAX_SAFE_INTEGER), true);
  assert.equal(inventory.count('sand'), 0);
});

// 不正な割り当て番号や未入手の素材では、既存の対応を変えない。
test('invalid assignment indexes cannot change shortcuts or quantities', () => {
  const inventory = createInventory();
  inventory.add('grass');
  const before = inventory.slots;
  for (const index of [-1, 6, 1.5, '1', null, Infinity]) assert.equal(inventory.assign('grass', index), false);
  assert.deepEqual(inventory.slots, before);
  assert.equal(inventory.count('grass'), 1);
});

// 読み取った配列や対応表を直接変更しても、実際の所持数は増やせない。
test('palette and exposed snapshots cannot mutate internal quantities or shortcuts', () => {
  const palette = ['grass', 'stone'];
  const inventory = createInventory(palette);
  palette[0] = 'sand';
  palette.push('wood');
  inventory.add('grass');
  const slots = inventory.slots;
  const counts = inventory.counts;
  slots[0] = 'stone';
  slots.push('wood');
  counts.grass = 999;
  counts.wood = 999;
  assert.deepEqual(inventory.slots, ['grass', null]);
  assert.equal(inventory.count('grass'), 1);
  assert.equal(inventory.count('wood'), 0);
  assert.equal(inventory.add('wood'), false);
});

// 成立しない初期設定は、使えないインベントリを作る前に拒否する。
test('invalid initial palettes fail before creating an unusable inventory', () => {
  for (const palette of [[], null, 'grass', [null], ['']]) assert.throws(() => createInventory(palette), TypeError);
});
