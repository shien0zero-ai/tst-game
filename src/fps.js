// 物理計算用に制限された時間ではなく、実際の描画時刻から平均FPSを求める。
export function createFpsCounter(intervalMs = 500) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('FPSの集計間隔には正のミリ秒を指定してください。');
  let startedAt = null, previousAt = null, frames = 0, fps = null;
  // タブから復帰したら古い区間を捨て、最初から測定する。
  const reset = () => { startedAt = null; previousAt = null; frames = 0; fps = null; };
  return Object.freeze({
    get fps() { return fps; },
    reset,
    update(timestamp) {
      if (!Number.isFinite(timestamp) || timestamp < 0) { reset(); return null; }
      // 初回や時計の巻き戻りでは、まだフレーム数を数えず基準時刻だけ設定する。
      if (startedAt === null || timestamp < previousAt) {
        reset(); startedAt = timestamp; previousAt = timestamp; return null;
      }
      if (timestamp === previousAt) return null;
      previousAt = timestamp;
      frames++;
      const elapsed = timestamp - startedAt;
      if (elapsed < intervalMs) return null;
      // 半秒ぶんをまとめて集計すると表示の細かな揺れを抑えられる。
      fps = Math.round(frames * 1000 / elapsed);
      startedAt = timestamp;
      frames = 0;
      return fps;
    },
  });
}
