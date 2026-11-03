/**
 * 採掘・設置と所持数の増減を一つの操作として扱う。
 * 画面や当たり判定から分離し、「失敗したのに素材だけ減る」状態を防ぐ。
 * プレイヤーとの重なりの確認は、この関数を呼ぶ前に画面側で行う。
 */

const result = (ok, type, error = null) => ({ ok, type, error });

// 対象のブロックを消せたときだけ、同じ種類の素材をちょうど1個受け取る。
export function mineBlock(world, inventory, x, y, z) {
  const type = world.get(x, y, z);
  if (!type) return result(false, null, 'empty');
  // 在庫上限や未対応の種類を先に検証し、受け取れないブロックは壊さない。
  if (!inventory.canAdd(type)) return result(false, type, 'capacity');
  if (!world.remove(x, y, z)) return result(false, type, 'blocked');
  if (!inventory.add(type)) {
    // 通常は事前確認により起きないが、在庫への追加に失敗したら元へ戻す。
    if (!world.set(x, y, z, type)) throw new Error('採掘を取り消す際にブロックを復元できませんでした。');
    return result(false, type, 'capacity');
  }
  return result(true, type);
}

// 所持している素材を設置できたときだけ、在庫を1個減らす。
export function placeBlock(world, inventory, type, x, y, z) {
  if (inventory.count(type) < 1) return result(false, type, 'unavailable');
  // 既存ブロックや範囲外で失敗したときは、在庫を触らずに終了する。
  if (!world.set(x, y, z, type)) return result(false, type, 'blocked');
  if (!inventory.consume(type)) {
    // 消費に失敗した場合も無料のブロックを残さず、設置そのものを取り消す。
    if (!world.remove(x, y, z)) throw new Error('設置を取り消す際にブロックを削除できませんでした。');
    return result(false, type, 'unavailable');
  }
  return result(true, type);
}
