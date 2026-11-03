import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Start the development server with `npm run dev` before this test, or set
// BASE_URL to the exported standalone HTML's file:// URL.
// CHROMIUM_PATH overrides selection. Use the cloud's system Chromium if present,
// otherwise use `npm run test:browser:install` to install Playwright's browser.
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const testURL = new URL(baseURL);
testURL.searchParams.set('test', '1');
const standalone = process.env.STANDALONE === '1' || testURL.protocol === 'file:';
const artifacts = new URL('../artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });

const executablePath = process.env.CHROMIUM_PATH
  || (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
if (executablePath && !existsSync(executablePath)) {
  throw new Error(`CHROMIUM_PATH does not exist: ${executablePath}`);
}
if (!executablePath && !existsSync(chromium.executablePath())) {
  throw new Error('Browser not installed. Run: npm run test:browser:install');
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
if (testURL.protocol === 'file:') await page.context().setOffline(true);
page.setDefaultTimeout(15_000);
const errors = [];
const networkRequests = [];
page.on('request', (request) => {
  if (!['file:', 'data:', 'blob:', 'about:'].includes(new URL(request.url()).protocol)) {
    networkRequests.push(request.url());
  }
});
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const snapshot = () => page.evaluate(() => window.__FIELDCRAFT_TEST__());
const horizontalDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
let mouse = { x: 0, y: 0 };
const moveMouse = async (dx, dy) => {
  mouse = { x: mouse.x + dx, y: mouse.y + dy };
  await page.mouse.move(mouse.x, mouse.y);
};
const startOrResume = async () => {
  const bounds = await page.locator('#play-button').boundingBox();
  assert.ok(bounds, 'The start/resume button must be visible');
  mouse = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.click(mouse.x, mouse.y);
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__().locked);
};

try {
  await page.goto(testURL.href, { waitUntil: 'networkidle' });
  if (standalone) await page.context().setOffline(true);
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__?.().ready);
  assert.ok(await page.locator('#play-button').isEnabled(), 'Start button must be enabled');
  const initial = await snapshot();
  assert.ok(initial.blockCount > 1000, 'The world must contain terrain and trees');
  assert.ok(initial.triangles > 0, 'Three.js must render world geometry');
  await page.screenshot({ path: new URL('start-screen.png', artifacts).pathname });
  console.log('PASS: world loads, WebGL renders, start screen is usable');

  await startOrResume();
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__().grounded);
  const beforeLook = await snapshot();
  await moveMouse(70, 0);
  await page.waitForFunction((yaw) => Math.abs(window.__FIELDCRAFT_TEST__().yaw - yaw) > 0.01, beforeLook.yaw);
  console.log('PASS: start captures the pointer, mouse changes the viewing direction');

  for (const key of ['w', 's', 'a', 'd']) {
    const before = await snapshot();
    await page.keyboard.down(key);
    try {
      // Software WebGL can render slowly on a shared CI worker. Wait for a
      // meaningful simulated displacement instead of a fixed wall-clock delay.
      await page.waitForFunction((origin) => {
        const position = window.__FIELDCRAFT_TEST__().position;
        return Math.hypot(position.x - origin.x, position.z - origin.z) > 0.25;
      }, before.position);
    } finally {
      await page.keyboard.up(key);
    }
    const after = await snapshot();
    assert.ok(horizontalDistance(before.position, after.position) > 0.2, `${key.toUpperCase()} must move the player`);
    assert.ok(Math.abs(after.position.y) < 0.02, 'Walking must stay on the grass surface');
  }
  console.log('PASS: WASD moves in all four directions without falling through terrain');

  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__().position.y > 0.4);
  await page.keyboard.up('Space');
  await page.waitForFunction(() => {
    const state = window.__FIELDCRAFT_TEST__();
    return state.grounded && Math.abs(state.position.y) < 0.02;
  });
  console.log('PASS: jump rises above the ground and lands on its surface');

  await page.keyboard.press('Digit3');
  assert.equal((await snapshot()).selectedType, 'stone', '3 selects stone');
  await page.keyboard.press('Digit6');
  assert.equal((await snapshot()).selectedType, 'sand', '6 selects sand');
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(() => window.__FIELDCRAFT_TEST__().selectedType !== 'sand');
  await page.keyboard.press('Digit1');
  assert.equal((await snapshot()).selectedType, 'grass', '1 selects grass');
  console.log('PASS: number keys and mouse wheel switch the block palette');

  // Aim at grass a few blocks in front of the player using actual mouse input.
  for (let step = 0; step < 20; step++) {
    const state = await snapshot();
    // A very shallow ray can reach the surface but not the next block after
    // mining it. Aim closer so replacing the mined block stays within reach.
    if (state.target?.y === -1 && state.target.normal.y === 1 && state.pitch <= -0.6 && state.pitch > -1.1) break;
    await moveMouse(0, 25);
    await page.waitForTimeout(35);
  }
  const aimed = await snapshot();
  assert.equal(aimed.target?.y, -1, 'The crosshair must find a grass block');
  assert.equal(aimed.target?.normal.y, 1, 'The selected face must be the grass surface');
  assert.ok(aimed.pitch > -1.1, 'Aim far enough from the player to allow placement');
  const blockCount = aimed.blockCount;
  await page.mouse.click(mouse.x, mouse.y, { button: 'left' });
  await page.waitForFunction((count) => window.__FIELDCRAFT_TEST__().blockCount === count - 1, blockCount);
  await page.mouse.click(mouse.x, mouse.y, { button: 'right' });
  await page.waitForFunction((count) => window.__FIELDCRAFT_TEST__().blockCount === count, blockCount);
  console.log('PASS: left click breaks a block; right click places the selected block');

  await page.screenshot({ path: new URL('gameplay.png', artifacts).pathname });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__FIELDCRAFT_TEST__().locked);
  await page.locator('#play-button').waitFor({ state: 'visible' });
  const paused = await snapshot();
  await page.keyboard.down('w');
  await page.waitForTimeout(180);
  await page.keyboard.up('w');
  assert.ok(horizontalDistance(paused.position, (await snapshot()).position) < 0.01, 'Movement must pause when the pointer is unlocked');
  await startOrResume();
  console.log('PASS: Esc pauses the world and the resume button captures the pointer again');

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
  assert.deepEqual(errors, [], 'The browser must not report JavaScript or WebGL errors');
  console.log('PASS: viewport resize works; no browser errors');
  if (standalone) {
    const expectedRequests = testURL.protocol === 'file:' ? [] : [testURL.href];
    assert.deepEqual(networkRequests, expectedRequests, 'Standalone HTML must only fetch its initial document');
    console.log('PASS: standalone HTML runs offline after opening; zero external or subresource requests');
  }
  console.log('Browser smoke checks passed. Screenshots: artifacts/start-screen.png, artifacts/gameplay.png');
} catch (error) {
  await page.screenshot({ path: new URL('failure.png', artifacts).pathname }).catch(() => {});
  const state = await snapshot().catch(() => null);
  console.error('Browser smoke check failed:', error.message);
  console.error('Last state:', JSON.stringify(state));
  if (errors.length) console.error('Browser errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
