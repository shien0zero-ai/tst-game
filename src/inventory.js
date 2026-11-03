/**
 * 採掘して獲得したブロックだけを使えるインベントリ。
 * 素材ごとの個数と、ホットバーのショートカットを分けて管理する。
 * 同じ素材を複数スロットに置いても、所持数は一つの共有在庫を参照する。
 */
import { BLOCK_TYPES } from './world.js';

export function createInventory(blockTypes = BLOCK_TYPES) {
  if (!Array.isArray(blockTypes) || !blockTypes.length
    || !blockTypes.every(type => typeof type === 'string' && type.length > 0)) {
    throw new TypeError('インベントリには、1種類以上のブロック名の配列が必要です。');
  }
  // 最初は何も持っていない。初めて集めた素材を、空きスロットへ自動登録する。
  const slots = Array(blockTypes.length).fill(null);
  const allowedTypes = new Set(blockTypes);
  const counts = new Map([...allowedTypes].map(type => [type, 0]));
  let selected = 0;

  // 増減する個数は正の安全な整数だけに限定し、小数や桁あふれによる複製を防ぐ。
  const validAmount = amount => Number.isSafeInteger(amount) && amount > 0;
  const canAdd = (type, amount = 1) => allowedTypes.has(type) && validAmount(amount)
    && counts.get(type) <= Number.MAX_SAFE_INTEGER - amount;

  return Object.freeze({
    // 配列や対応表はコピーして渡し、表示側から在庫を書き換えさせない。
    get slots() { return [...slots]; },
    get counts() { return Object.fromEntries(counts); },
    get selected() { return selected; },
    get selectedType() { return slots[selected]; },
    count(type) { return counts.get(type) ?? 0; },
    canAdd,

    // 採掘が成功したときに呼ぶ。ショートカットが満杯でも、素材自体は失われない。
    add(type, amount = 1) {
      if (!canAdd(type, amount)) return false;
      counts.set(type, counts.get(type) + amount);
      if (!slots.includes(type)) {
        const empty = slots.indexOf(null);
        if (empty !== -1) slots[empty] = type;
      }
      return true;
    },

    // 設置が成功したときだけ呼ぶ。足りない場合は、在庫もスロットも変更しない。
    consume(type, amount = 1) {
      if (!allowedTypes.has(type) || !validAmount(amount) || counts.get(type) < amount) return false;
      const remaining = counts.get(type) - amount;
      counts.set(type, remaining);
      // 最後の1個を使ったら、その素材を指すショートカットをすべて空にする。
      if (remaining === 0) {
        for (let index = 0; index < slots.length; index++) {
          if (slots[index] === type) slots[index] = null;
        }
      }
      return true;
    },

    // ホイール操作では末尾と先頭を循環させる。
    select(index) {
      if (!Number.isInteger(index)) return selected;
      selected = ((index % slots.length) + slots.length) % slots.length;
      return selected;
    },
    // 所持している素材だけを登録できる。ショートカットの登録で個数は増減しない。
    assign(type, index = selected) {
      if (!allowedTypes.has(type) || counts.get(type) <= 0
        || !Number.isInteger(index) || index < 0 || index >= slots.length) return false;
      slots[index] = type;
      return true;
    },
  });
}
