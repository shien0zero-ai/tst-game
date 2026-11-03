// クリエイティブ形式のインベントリ。個数は消費せず、6つのスロットの種類を管理する。
import { BLOCK_TYPES } from './world.js';

export function createInventory(blockTypes = BLOCK_TYPES) {
  if (!Array.isArray(blockTypes) || !blockTypes.length
    || !blockTypes.every(type => typeof type === 'string' && type.length > 0)) {
    throw new TypeError('インベントリには、1種類以上のブロック名の配列が必要です。');
  }
  const slots = [...blockTypes];
  const allowedTypes = new Set(blockTypes);
  let selected = 0;
  return Object.freeze({
    // 表示側へ配列のコピーを渡し、意図しない外部からの書き換えを防ぐ。
    get slots() { return [...slots]; },
    get selected() { return selected; },
    get selectedType() { return slots[selected]; },
    // ホイール操作では末尾と先頭を循環させる。
    select(index) {
      if (!Number.isInteger(index)) return selected;
      selected = ((index % slots.length) + slots.length) % slots.length;
      return selected;
    },
    // 同じ素材を複数スロットに入れてもよい。不正な種類や番号では変更しない。
    assign(type, index = selected) {
      if (!allowedTypes.has(type) || !Number.isInteger(index) || index < 0 || index >= slots.length) return false;
      slots[index] = type;
      return true;
    },
  });
}
