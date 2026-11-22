import { expect, test, type Page } from '@playwright/test';

async function openLesson(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page.getByRole('list', { name: 'Experiments' }).getByRole('button', { name: new RegExp(title + '$') }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('runs the original experiments from the contents and preserves lesson choice', async ({ page }) => {
  const errors: string[] = [];
  const thirdParty: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const site = new URL(page.url()).origin;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== site) thirdParty.push(url.origin);
  });

  const lessons = [
    ['Keeping count', 'Main store'],
    ['The catapult', 'Height above launch'],
    ['Drop and bounce', 'Dissipated to surroundings'],
    ['Warming up', 'Simulated time'],
    ['Lifting power', 'Energy transferred'],
    ['Where it goes', 'LED visible light'],
    ['From wind to kettle', 'Kettle'],
  ] as const;
  for (const [title, reading] of lessons) {
    await openLesson(page, title);
    await expect(page.locator('#extra-figure')).toBeVisible();
    await page.locator('#extra-setting').selectOption('1');
    await page.locator('#extra-run').click();
    await expect(page.locator('#extra-readouts')).toContainText(reading, { ignoreCase: true });
    await expect(page.locator('#extra-readouts dd').first()).not.toBeEmpty();
  }

  await page.reload();
  await expect(page.getByRole('heading', { name: 'From wind to kettle', exact: true })).toBeVisible();
  await expect(page.locator('#extra-setting')).toHaveValue('1');
  await openLesson(page, 'The swing');
  await page.getByRole('button', { name: 'Raise pop-up', exact: true }).click();
  await page.getByRole('button', { name: 'Release bob', exact: true }).click();
  await expect(page.locator('#result')).toContainText('1.40 m/s');
  expect(errors).toEqual([]);
  expect(thirdParty).toEqual([]);
});

test('seeks to the same authored frame and shows magnified lesson details', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openLesson(page, 'Drop and bounce');
  await expect(page.locator('#extra-figure')).toBeVisible();
  await page.getByText('Explore motion frame by frame', { exact: true }).click();
  await expect(page.getByLabel('Animation')).toHaveValue('experiment');
  const slider = page.getByRole('slider', { name: 'Frame' });
  await slider.fill('20');
  const readings = page.locator('#extra-readouts dd');
  const first = await readings.allTextContents();
  await slider.fill('200');
  await expect.poll(() => readings.allTextContents()).not.toEqual(first);
  await slider.fill('20');
  await expect(readings).toHaveText(first);

  await page.getByRole('button', { name: 'Magnifier', exact: true }).click();
  await expect(page.locator('#extra-experiment .inkleaf-loupe-term')).toContainText('dissipation');
  const pixels = await page.locator('#extra-experiment .inkleaf-loupe').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<number>();
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3]) colors.add(rgba[i]! * 65536 + rgba[i + 1]! * 256 + rgba[i + 2]!);
    }
    return colors.size;
  });
  expect(pixels).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Magnifier', exact: true }).press('Escape');
  await expect(page.locator('#extra-experiment .inkleaf-loupe')).toBeHidden();
});

test('navigates with Shift and wheel input', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open notebook' }).click();
  await page.locator('#lesson-title').hover();
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Shift');
  await expect(page.getByRole('heading', { name: 'The catapult', exact: true })).toBeVisible();
});

test('sets the swing release angle by keyboard and persists it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open notebook' }).click();
  await page.getByRole('button', { name: 'Raise pop-up' }).click();
  const slider = page.getByRole('slider', { name: 'Starting angle', exact: true });
  await slider.press('End');
  await expect(slider).toHaveValue('75');
  await page.getByRole('button', { name: 'Release bob' }).click();
  await expect(page.locator('#result')).toContainText('2.41 m/s');
  await page.reload();
  await page.getByRole('button', { name: 'Raise pop-up' }).click();
  await expect(slider).toHaveValue('75');
});

test('grabs the rendered bob and releases it from a different angle', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open notebook' }).click();
  await page.getByRole('button', { name: 'Raise pop-up' }).click();
  const canvas = page.locator('#figure');
  await expect(canvas).toBeVisible();
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width * 0.37;
  const y = bounds.y + bounds.height * 0.48;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute('data-grabbing', '');
  await page.mouse.move(x - bounds.width * 0.16, y, { steps: 6 });
  await expect(page.locator('#angle')).not.toHaveValue('-41');
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('data-grabbing', '');
  await expect(page.locator('#result')).toContainText('First pass');
});
