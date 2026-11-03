/** 実時間の描画サンプルからFPSを正しく集計できるか確認する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFpsCounter } from '../src/fps.js';

// 集計区間が揃うまで値を出さず、その後は直近の値を保持する。
test('FPS waits for a complete sampling interval and retains the last result', () => {
  const counter = createFpsCounter();
  assert.equal(counter.fps, null);
  assert.equal(counter.update(0), null);
  assert.equal(counter.update(100), null);
  assert.equal(counter.update(499), null);
  assert.equal(counter.update(500), 6);
  assert.equal(counter.fps, 6);
  assert.equal(counter.update(600), null);
  assert.equal(counter.fps, 6);
});
// 1/60秒ごとの描画は60FPSと求められる。
test('FPS counts rendered frame intervals at 60 frames per second', () => {
  const counter = createFpsCounter();
  assert.equal(counter.update(0), null);
  let reported = null;
  for (let frame = 1; frame <= 30; frame++) reported = counter.update(frame * 1000 / 60);
  assert.equal(reported, 60);
  assert.equal(counter.fps, 60);
});
// 遅いフレームも実時間に含め、物理演算用の時間上限と混同しない。
test('FPS averages uneven intervals and low frame rates using real elapsed time', () => {
  const counter = createFpsCounter();
  counter.update(0);
  counter.update(100);
  counter.update(200);
  assert.equal(counter.update(600), 5);
  assert.equal(counter.update(900), null);
  assert.equal(counter.update(1100), 4);
  assert.equal(counter.update(2100), 1);
});
// タブ復帰後は以前のサンプルを混ぜず測り直す。
test('reset clears the last reading and establishes a fresh time baseline', () => {
  const counter = createFpsCounter();
  counter.update(0);
  assert.equal(counter.update(500), 2);
  counter.reset();
  assert.equal(counter.fps, null);
  assert.equal(counter.update(5000), null);
  assert.equal(counter.update(5500), 2);
});
// 時計が巻き戻った場合も負の値を出さない。
test('clock rollback discards the previous sampling window', () => {
  const counter = createFpsCounter();
  counter.update(1000);
  assert.equal(counter.update(1500), 2);
  assert.equal(counter.update(1200), null);
  assert.equal(counter.fps, null);
  assert.equal(counter.update(1700), 2);
});
// 不正な時刻ではサンプルを破棄して次の正常値を待つ。
test('invalid timestamps reset safely without producing a reading', () => {
  const counter = createFpsCounter();
  for (const timestamp of [NaN, Infinity, -1, undefined, null, '500']) {
    counter.update(0); counter.update(500);
    assert.equal(counter.update(timestamp), null);
    assert.equal(counter.fps, null);
    assert.equal(counter.update(1000), null);
  }
});
// 同じ時刻を二重に数えてFPSを水増ししない。
test('duplicate timestamps do not inflate the frame count', () => {
  const counter = createFpsCounter();
  counter.update(0); counter.update(0);
  assert.equal(counter.update(500), 2);
  assert.equal(counter.update(500), null);
  assert.equal(counter.fps, 2);
});
// 測定区間は正のミリ秒だけを受け付ける。
test('FPS accepts a custom positive interval and rejects invalid intervals', () => {
  const counter = createFpsCounter(1000);
  counter.update(0);
  assert.equal(counter.update(500), null);
  assert.equal(counter.update(1000), 2);
  for (const interval of [0, -1, NaN, Infinity, '500', null]) assert.throws(() => createFpsCounter(interval), RangeError);
});
