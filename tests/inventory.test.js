/** インベントリの持ち替え・割り当て・不正入力を画面なしで確認する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_TYPES } from '../src/world.js';
import { createInventory } from '../src/inventory.js';

// 初期状態は全種類が並び、最初の草ブロックを選んでいる。
test('inventory starts with the available blocks and the first selected slot', () => {
  const inventory = createInventory();
  assert.deepEqual(inventory.slots, BLOCK_TYPES);
  assert.equal(inventory.selected, 0);
  assert.equal(inventory.selectedType, 'grass');
});
// 番号が端を越えても、左右どちらにも循環する。
test('slot selection wraps both directions without changing the slot contents', () => {
  const inventory = createInventory();
  assert.equal(inventory.select(-1), 5);
  assert.equal(inventory.selectedType, 'sand');
  assert.equal(inventory.select(6), 0);
  assert.equal(inventory.select(13), 1);
  assert.equal(inventory.select(-13), 5);
  assert.deepEqual(inventory.slots, BLOCK_TYPES);
});
// 選んだスロットの種類を変えると、建築に使う種類も変わる。
test('assigning a material updates the selected type while preserving selection', () => {
  const inventory = createInventory();
  inventory.select(2);
  assert.equal(inventory.assign('wood'), true);
  assert.equal(inventory.selected, 2);
  assert.equal(inventory.selectedType, 'wood');
  assert.equal(inventory.assign('sand', 0), true);
  assert.equal(inventory.selectedType, 'wood');
  assert.equal(inventory.slots[0], 'sand');
});
// 創作モードでは残数を消費せず、重複した素材も置ける。
test('creative slots allow duplicate materials without consuming them', () => {
  const inventory = createInventory();
  for (let index = 0; index < BLOCK_TYPES.length; index++) assert.equal(inventory.assign('stone', index), true);
  assert.deepEqual(inventory.slots, Array(BLOCK_TYPES.length).fill('stone'));
  assert.equal(inventory.assign('stone'), true);
  assert.equal(inventory.selectedType, 'stone');
});
// 未対応の種類や無効な番号は、選択とスロットを変えない。
test('invalid material and index input leaves inventory unchanged', () => {
  const inventory = createInventory();
  inventory.select(3);
  const before = inventory.slots;
  for (const index of [NaN, Infinity, 1.5, '1', null, undefined]) assert.equal(inventory.select(index), 3);
  for (const type of ['water', '', null, undefined, {}, 2]) assert.equal(inventory.assign(type), false);
  for (const index of [-1, 6, 1.5, '1', null, Infinity]) assert.equal(inventory.assign('grass', index), false);
  assert.equal(inventory.selected, 3);
  assert.deepEqual(inventory.slots, before);
});
// 初期配列や読み取り結果を書き換えても、内部状態は影響を受けない。
test('inventory copies both its initial palette and exposed slot arrays', () => {
  const palette = ['grass', 'stone'];
  const inventory = createInventory(palette);
  palette[0] = 'sand';
  palette.push('wood');
  const exposed = inventory.slots;
  exposed[0] = 'leaves';
  exposed.push('dirt');
  assert.deepEqual(inventory.slots, ['grass', 'stone']);
  assert.equal(inventory.selectedType, 'grass');
  assert.equal(inventory.assign('wood'), false);
  assert.equal(inventory.assign('stone'), true);
});
// 成立しない初期設定は、使えないインベントリを作る前に拒否する。
test('invalid initial palettes fail before creating an unusable inventory', () => {
  for (const palette of [[], null, 'grass', [null], ['']]) assert.throws(() => createInventory(palette), TypeError);
});
