import { expect, test } from '@playwright/test';

test('replays camera and riffle poses from the actual book', async ({ page }) => {
  await page.goto('/');
  const camera = page.locator('#book-camera');
  await expect(camera).toHaveAttribute('data-pose', 'cover');
  await page.getByRole('button', { name: 'Open notebook' }).click();
  await expect(camera).toHaveAttribute('data-pose', 'reading');
  await expect(page.getByRole('heading', { name: 'The swing', exact: true })).toBeFocused();
  await page.getByText('Explore motion frame by frame', { exact: true }).click();

  const motion = page.getByLabel('Animation');
  const frame = page.getByRole('slider', { name: 'Frame', exact: true });
  await motion.selectOption('camera');
  await frame.fill('28');
  await expect(camera).toHaveAttribute('data-pose', 'approach');
  const transform = await page.locator('#notebook').evaluate((node) => getComputedStyle(node).transform);
  expect(transform).not.toBe('none');
  await frame.fill('66');
  await expect(camera).toHaveAttribute('data-pose', 'reading');
  await frame.fill('28');
  expect(await page.locator('#notebook').evaluate((node) => getComputedStyle(node).transform)).toBe(transform);

  await motion.selectOption('riffle');
  await frame.fill('26');
  const riffle = page.locator('#book-riffle');
  const poses = () => riffle.locator('.riffle-leaf:not([hidden])').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).style.cssText));
  const midpoint = await poses();
  expect(midpoint.length).toBeGreaterThan(2);
  await frame.fill('64');
  await expect(riffle).toBeHidden();
  await frame.fill('26');
  expect(await poses()).toEqual(midpoint);
});

test('seeks real camera orbit and refractive magnification in a running lesson', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Explore motion frame by frame', { exact: true }).click();
  const motion = page.getByLabel('Animation');
  const frame = page.getByRole('slider', { name: 'Frame', exact: true });
  const figure = page.locator('#figure');
  await motion.selectOption('orbit');
  await frame.fill('80');
  await expect(figure).toBeVisible();
  await expect(figure).toHaveAttribute('data-view-yaw', '-48');
  await frame.fill('160');
  await expect(figure).toHaveAttribute('data-view-yaw', '48');

  await motion.selectOption('magnifier');
  const loupe = page.locator('#experiment canvas.inkleaf-loupe');
  await expect(loupe).toBeVisible();
  await frame.fill('24');
  await expect(loupe).toHaveAttribute('data-zoom', '2.25');
  await expect(loupe).toHaveAttribute('data-refraction', '0.38');
  const pixels = () => loupe.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const first = await pixels();
  await frame.fill('47');
  await expect.poll(pixels).not.toBe(first);
  await frame.fill('24');
  await expect.poll(pixels).toBe(first);

  await motion.selectOption('guided');
  await frame.fill('440');
  await expect(page.locator('#result')).toContainText('First pass');
});

test('opens usable study pages and explicit contrast and sound controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Study desk' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page sound: off' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Higher contrast' }).click();
  await expect(page.locator('main')).toHaveClass(/inkleaf-high-contrast/);

  await page.getByRole('tab', { name: 'Quick quiz' }).click();
  const quiz = page.getByRole('tabpanel', { name: 'Quick quiz' });
  await quiz.getByRole('radio').first().check();
  await quiz.getByRole('button', { name: 'Check answer' }).click();
  await expect(quiz.locator('.study-feedback')).not.toBeEmpty();
  await quiz.getByRole('button', { name: 'Continue' }).click();
  await expect(quiz).toContainText('Question 2 of 8');

  await page.getByRole('tab', { name: 'Glossary' }).click();
  await page.getByRole('searchbox').fill('pendulum');
  await expect(page.getByRole('tabpanel', { name: 'Glossary' })).toContainText('pendulum', { ignoreCase: true });
  await page.getByRole('tab', { name: 'Sources & teaching notes' }).click();
  const notes = page.getByRole('tabpanel', { name: 'Sources & teaching notes' });
  await notes.getByRole('combobox', { name: 'Choose lesson notes' }).selectOption('2');
  await expect(notes).toContainText('The swing');
  await expect(notes.getByRole('link').first()).toHaveAttribute('href', /^https:/);
});
