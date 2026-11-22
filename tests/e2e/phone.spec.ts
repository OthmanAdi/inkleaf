import { expect, test } from '@playwright/test';

test('swipes to the next lesson without blocking vertical scrolling', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open notebook' }).tap();
  const client = await context.newCDPSession(page);
  const title = await page.locator('#lesson-title').boundingBox();
  expect(title).not.toBeNull();
  const y = Math.round(title!.y + title!.height / 2);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 295, y }] });
  for (const x of [270, 245, 220, 195, 170, 145, 120]) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('heading', { name: 'The catapult', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const before = await page.evaluate(() => scrollY);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 590 }] });
  for (const position of [555, 520, 485, 450, 415, 380, 345]) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y: position }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
  await expect(page.getByRole('heading', { name: 'The catapult', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Release the band' }).tap();
  await expect(page.locator('#extra-readouts')).toContainText('Height above launch');
});
