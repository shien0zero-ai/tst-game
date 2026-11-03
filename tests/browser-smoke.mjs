/**
 * 実際の Chromium を操作して、ゲーム全体の動きを確認するテスト。
 * キーボード入力・マウス捕捉・視点移動・ブロック編集・感度設定を通して検証する。
 * エラー発生時は終了コードを失敗にし、調査用の画面画像と状態を残す。
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// 先に npm run dev でゲームを起動する。別の URL を試す場合は BASE_URL で指定する。
// 単体 HTML も指定できるが、file:// を許可しない管理対象ブラウザでは HTTP 配信を使う。
// CHROMIUM_PATH の指定を優先し、なければシステム Chromium、さらに未導入なら
// npm run test:browser:install で用意した Playwright のブラウザを使う。
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const testURL = new URL(baseURL);
// ゲーム側の読み取り専用診断を有効にし、操作後の位置や感度を確認できるようにする。
testURL.searchParams.set('test', '1');
// 単体版では、HTML 以外の通信なしで遊べるかも追加で確認する。
const standalone = process.env.STANDALONE === '1' || testURL.protocol === 'file:';
const artifacts = new URL('../artifacts/', import.meta.url);
// テストが保存する画面画像の置き場を用意する。既に存在していても失敗しない。
await mkdir(artifacts, { recursive: true });

// 実行環境ごとのブラウザの場所を選び、見つからない場合は起動前に対処方法を伝える。
const executablePath = process.env.CHROMIUM_PATH
  || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
if (executablePath && !existsSync(executablePath)) {
  throw new Error(`CHROMIUM_PATH does not exist: ${executablePath}`);
}
if (!executablePath && !existsSync(chromium.executablePath())) {
  throw new Error('Browser not installed. Run: npm run test:browser:install');
}

// 画面を表示しないテスト用 Chromium を起動する。
// SwiftShader を使い、専用 GPU がないクラウド環境でも WebGL の描画を検証する。
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// ローカルファイルの検証時は、最初からネットワークに頼れない状態にする。
if (testURL.protocol === 'file:') await page.context().setOffline(true);
// 各操作は最大 15 秒まで待つ。待ちきれない場合はテスト失敗として報告する。
page.setDefaultTimeout(15_000);
const errors = [];
const networkRequests = [];
// 通信先を記録する。data: など、ネットワークを使わない埋め込みデータは数えない。
page.on('request', (request) => {
  if (!['file:', 'data:', 'blob:', 'about:'].includes(new URL(request.url()).protocol)) {
    networkRequests.push(request.url());
  }
});
// 画面の見た目だけでは発見できない JavaScript エラーもテストの失敗条件に含める。
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
// 診断値は読むだけにして、テストからゲームの位置やブロックを書き換えない。
const snapshot = () => page.evaluate(() => window.__FIELDCRAFT_TEST__());
// 高さの変化と区別して、地面に沿った移動距離だけを求める。
const horizontalDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
let mouse = { x: 0, y: 0 };
// 単体版で許容する HTML 取得回数。設定保存テストの再読み込み時に一回増やす。
let documentLoads = 1;
// 前回のマウス位置を基準に相対移動し、ゲームへ実際のマウス入力を送る。
const moveMouse = async (dx, dy) => {
  mouse = { x: mouse.x + dx, y: mouse.y + dy };
  await page.mouse.move(mouse.x, mouse.y);
};
// 開始・再開ボタンを実際にクリックし、マウスがゲームに捕捉された状態まで待つ。
const startOrResume = async () => {
  const bounds = await page.locator('#play-button').boundingBox();
  assert.ok(bounds, 'The start/resume button must be visible');
  mouse = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.click(mouse.x, mouse.y);
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__().locked);
};
// Esc を押し、マウスが解放されて一時停止メニューが操作できる状態まで待つ。
const pause = async () => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__FIELDCRAFT_TEST__().locked);
  await page.locator('#play-button').waitFor({ state: 'visible' });
};
// スライダーを直接書き換えず、Home と矢印キーで感度を変更する。
// 内部の設定値だけでなく、プレイヤーが見るパーセント表示も確認する。
const setSensitivity = async (percentage) => {
  const range = page.locator('#mouse-sensitivity');
  await range.focus();
  await range.press('Home');
  for (let value = 10; value < percentage; value += 5) await range.press('ArrowRight');
  await page.waitForFunction((value) => window.__FIELDCRAFT_TEST__().sensitivity === value, percentage);
  assert.equal((await page.locator('#sensitivity-value').textContent()).trim(), `${percentage}%`);
};
// 同じ 80px のマウス移動に対する横向きの回転量を測り、感度の効き方を比較する。
const measureMouseTurn = async () => {
  const before = await snapshot();
  await moveMouse(80, 0);
  await page.waitForFunction((yaw) => Math.abs(window.__FIELDCRAFT_TEST__().yaw - yaw) > 0.01, before.yaw);
  return Math.abs((await snapshot()).yaw - before.yaw);
};

try {
  // 初期画面：世界の生成・3D 描画・標準感度を確認し、開始前の画像を保存する。
  await page.goto(testURL.href, { waitUntil: 'networkidle' });
  // HTML を取得した後はオフラインにし、単体版が追加ファイルを要求しないことを確かめる。
  if (standalone) await page.context().setOffline(true);
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__?.().ready);
  await page.evaluate(() => localStorage.removeItem('fieldcraft.mouseSensitivity'));
  assert.ok(await page.locator('#play-button').isEnabled(), 'Start button must be enabled');
  const initial = await snapshot();
  assert.equal(initial.sensitivity, 100, 'A fresh browser starts at 100% sensitivity');
  assert.ok(initial.blockCount > 1000, 'The world must contain terrain and trees');
  assert.ok(initial.triangles > 0, 'Three.js must render world geometry');
  await page.screenshot({ path: new URL('start-screen.png', artifacts).pathname });
  console.log('PASS: world loads, WebGL renders, start screen is usable');

  // 視点操作：開始操作でマウスを捕捉し、実際のマウス移動で向きが変わることを確かめる。
  await startOrResume();
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__().grounded);
  const beforeLook = await snapshot();
  await moveMouse(70, 0);
  await page.waitForFunction((yaw) => Math.abs(window.__FIELDCRAFT_TEST__().yaw - yaw) > 0.01, beforeLook.yaw);
  console.log('PASS: start captures the pointer, mouse changes the viewing direction');

  // 移動：四方向へそれぞれ入力し、地面の高さを保ったまま移動できることを確かめる。
  for (const key of ['w', 's', 'a', 'd']) {
    const before = await snapshot();
    await page.keyboard.down(key);
    try {
      // ソフトウェア描画は遅くなる場合があるため、固定の秒数ではなく実際の移動を待つ。
      await page.waitForFunction((origin) => {
        const position = window.__FIELDCRAFT_TEST__().position;
        return Math.hypot(position.x - origin.x, position.z - origin.z) > 0.25;
      }, before.position);
    } finally {
      // 確認に失敗した場合もキーを離し、押しっぱなしの入力を残さない。
      await page.keyboard.up(key);
    }
    const after = await snapshot();
    assert.ok(horizontalDistance(before.position, after.position) > 0.2, `${key.toUpperCase()} must move the player`);
    assert.ok(Math.abs(after.position.y) < 0.02, 'Walking must stay on the grass surface');
  }
  console.log('PASS: WASD moves in all four directions without falling through terrain');

  // ジャンプ：上昇が始まってからキーを離し、足元が地面に戻るまで確認する。
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__().position.y > 0.4);
  await page.keyboard.up('Space');
  await page.waitForFunction(() => {
    const state = window.__FIELDCRAFT_TEST__();
    return state.grounded && Math.abs(state.position.y) < 0.02;
  });
  console.log('PASS: jump rises above the ground and lands on its surface');

  // ブロック選択：数字キーとホイールで選択が変わり、草ブロックへ戻せることを確かめる。
  await page.keyboard.press('Digit3');
  assert.equal((await snapshot()).selectedType, 'stone', '3 selects stone');
  await page.keyboard.press('Digit6');
  assert.equal((await snapshot()).selectedType, 'sand', '6 selects sand');
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__().selectedType !== 'sand');
  await page.keyboard.press('Digit1');
  assert.equal((await snapshot()).selectedType, 'grass', '1 selects grass');
  console.log('PASS: number keys and mouse wheel switch the block palette');

  // 破壊・設置の準備：実際にマウスを下へ動かし、少し先の地面の上面へ照準を合わせる。
  for (let step = 0; step < 20; step++) {
    const state = await snapshot();
    // 浅い角度では、表面を壊した後に次の土が射程外になる。十分近い場所を狙う。
    if (state.target?.y === -1 && state.target.normal.y === 1 && state.pitch <= -0.6 && state.pitch > -1.1) break;
    await moveMouse(0, 25);
    await page.waitForTimeout(35);
  }
  const aimed = await snapshot();
  assert.equal(aimed.target?.y, -1, 'The crosshair must find a grass block');
  assert.equal(aimed.target?.normal.y, 1, 'The selected face must be the grass surface');
  assert.ok(aimed.pitch > -1.1, 'Aim far enough from the player to allow placement');
  const blockCount = aimed.blockCount;
  // 左クリックで一つ減り、右クリックで元の個数へ戻ることで、編集操作の両方を確認する。
  await page.mouse.click(mouse.x, mouse.y, { button: 'left' });
  await page.waitForFunction((count) => window.__FIELDCRAFT_TEST__().blockCount === count - 1, blockCount);
  await page.mouse.click(mouse.x, mouse.y, { button: 'right' });
  await page.waitForFunction((count) => window.__FIELDCRAFT_TEST__().blockCount === count, blockCount);
  console.log('PASS: left click breaks a block; right click places the selected block');

  // 一時停止：プレイ画面を保存し、Esc の後は移動キーを押してもプレイヤーが動かないことを確かめる。
  await page.screenshot({ path: new URL('gameplay.png', artifacts).pathname });
  await pause();
  const paused = await snapshot();
  await page.keyboard.down('w');
  await page.waitForTimeout(180);
  await page.keyboard.up('w');
  assert.ok(horizontalDistance(paused.position, (await snapshot()).position) < 0.01, 'Movement must pause when the pointer is unlocked');

  // 感度の反映：50% と 200% を設定し、同じマウス移動で回転量が四倍になることを確かめる。
  await setSensitivity(50);
  await page.screenshot({ path: new URL('sensitivity-settings.png', artifacts).pathname });
  await startOrResume();
  const lowSensitivityTurn = await measureMouseTurn();
  assert.ok(Math.abs(lowSensitivityTurn - 0.08) < 0.015, 'At 50%, an 80px mouse movement should turn about 0.08 radians');
  await pause();
  await setSensitivity(200);
  await startOrResume();
  const highSensitivityTurn = await measureMouseTurn();
  assert.ok(Math.abs(highSensitivityTurn - 0.32) < 0.025, 'At 200%, an 80px mouse movement should turn about 0.32 radians');
  const turnRatio = highSensitivityTurn / lowSensitivityTurn;
  assert.ok(turnRatio > 3.6 && turnRatio < 4.4, '200% must turn four times as far as 50% for the same mouse movement');
  console.log('PASS: Esc pauses; keyboard slider settings apply on resume; 200% mouse turns are 4× 50% turns');

  // 設定保存：標準へ戻せることを確認してから 150% を保存し、ページを開き直す。
  await pause();
  await page.locator('#sensitivity-reset').click();
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__().sensitivity === 100);
  assert.equal((await page.locator('#sensitivity-value').textContent()).trim(), '100%');
  await setSensitivity(150);
  assert.equal(await page.evaluate(() => localStorage.getItem('fieldcraft.mouseSensitivity')), '150');
  // 単体版でも、保存状態の検証に必要な HTML の再取得だけは一時的に許可する。
  if (standalone) await page.context().setOffline(false);
  await page.reload({ waitUntil: 'networkidle' });
  documentLoads++;
  if (standalone) await page.context().setOffline(true);
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__?.().ready);
  assert.equal((await snapshot()).sensitivity, 150, 'The saved sensitivity must survive a page reload');
  assert.equal((await page.locator('#sensitivity-value').textContent()).trim(), '150%');
  // 再読み込み後は開始画面に戻るため、一度ゲームに入ってから設定メニューを開く。
  await startOrResume();
  await pause();
  await page.locator('#sensitivity-reset').click();
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__().sensitivity === 100);
  assert.equal(await page.evaluate(() => localStorage.getItem('fieldcraft.mouseSensitivity')), '100');
  await startOrResume();
  console.log('PASS: reset restores 100%; saved 150% persists across a reload; test leaves the default 100%');

  // 画面サイズ変更：描画領域の大きさが更新され、小さな画面でも設定と再開ボタンが収まることを確かめる。
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForFunction(() => {
    const canvas = document.getElementById('world');
    return canvas.clientWidth === 1024 && canvas.clientHeight === 768;
  });
  const dimensions = await page.locator('#world').evaluate((canvas) => ({
    width: canvas.clientWidth, height: canvas.clientHeight,
  }));
  assert.equal(dimensions.width, 1024);
  assert.equal(dimensions.height, 768);
  await pause();
  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForFunction(() => window.innerWidth === 800 && window.innerHeight === 600);
  for (const id of ['mouse-sensitivity', 'play-button']) {
    const bounds = await page.locator(`#${id}`).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 800 && bounds.y + bounds.height <= 600,
      `${id} must remain visible within an 800×600 window`);
  }
  await page.screenshot({ path: new URL('sensitivity-compact.png', artifacts).pathname });
  await startOrResume();
  // 全操作を終えてからまとめて確認し、途中で発生したブラウザエラーも見逃さない。
  assert.deepEqual(errors, [], 'The browser must not report JavaScript or WebGL errors');
  console.log('PASS: viewport resize works; slider and resume fit an 800×600 window; no browser errors');
  if (standalone) {
    // 初回と意図した再読み込み以外の通信があれば、単体 HTML の独立性が失われている。
    const expectedRequests = testURL.protocol === 'file:' ? [] : Array(documentLoads).fill(testURL.href);
    assert.deepEqual(networkRequests, expectedRequests, 'Standalone HTML must only fetch its document, including the deliberate persistence-test reload');
    console.log('PASS: standalone HTML runs offline after opening; zero external or subresource requests');
  }
  console.log('Browser smoke checks passed. Screenshots: artifacts/start-screen.png, artifacts/gameplay.png, artifacts/sensitivity-settings.png, artifacts/sensitivity-compact.png');
} catch (error) {
  // 失敗時の画面・診断値・エラーを残し、元の失敗を隠さず終了コードへ反映する。
  await page.screenshot({ path: new URL('failure.png', artifacts).pathname }).catch(() => {});
  const state = await snapshot().catch(() => null);
  console.error('Browser smoke check failed:', error.message);
  console.error('Last state:', JSON.stringify(state));
  if (errors.length) console.error('Browser errors:', errors);
  process.exitCode = 1;
} finally {
  // 成功・失敗にかかわらずブラウザを閉じ、次の実行へプロセスを残さない。
  await browser.close();
}
