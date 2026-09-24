import { expect, test } from '@playwright/test';

/**
 * Bringing the next track in on a beat of the one going out.
 *
 * Two things are tested, and the second is the one the feature actually rests on.
 * The arithmetic lives in `@vibeamp/dj` and is tested there; what cannot be tested
 * outside a browser is whether the mechanism works at all, because the whole idea
 * is to seek a playing audio element and have the audio land where it was told.
 * If a seek cost a tenth of a second of playback, every aligned entry would be a
 * tenth of a second late and the feature would be worse than nothing.
 */

test('offers beat alignment, and only where there is a fade to align', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#main-window')).toBeVisible();

  const panel = page.locator('.vibe-window');
  const beat = panel.getByRole('button', { name: 'beat', exact: true });

  // On by default: it costs nothing on a track with no grid, where the fade
  // happens where the clock says, exactly as it did before.
  await expect(beat).toHaveClass(/vibe-button--on/);
  await beat.click();
  await expect(beat).not.toHaveClass(/vibe-button--on/);

  // Nothing to align into with the fade switched off.
  await panel.locator('#vibe-fade').selectOption('0');
  await expect(beat).toBeDisabled();
});

test('a seek on a playing element costs less than a fiftieth of a beat', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#main-window')).toBeVisible();

  const lost = await page.evaluate(async () => {
    // Ten seconds of a tone, as a real file for a real element to decode.
    const rate = 16_000;
    const samples = rate * 10;
    const bytes = new Uint8Array(44 + samples * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (at: number, text: string): void => {
      for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    ascii(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i += 1) {
      view.setInt16(
        44 + i * 2,
        Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12_000),
        true,
      );
    }

    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const element = new Audio(url);
    const context = new AudioContext();
    context.createMediaElementSource(element).connect(context.destination);
    await context.resume();
    await element.play();
    await new Promise((resolve) => setTimeout(resolve, 600));

    const errors: number[] = [];
    // The three skips a beat alignment actually asks for: a fraction of a beat,
    // most of one, and almost none.
    for (const skip of [0.137, 0.42, 0.05]) {
      const contextBefore = context.currentTime;
      const elementBefore = element.currentTime;
      element.currentTime = elementBefore + skip;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // Where the playhead should be if the seek cost nothing, against where it is.
      const expected = elementBefore + skip + (context.currentTime - contextBefore);
      errors.push(Math.abs(element.currentTime - expected));
    }
    URL.revokeObjectURL(url);
    return errors;
  });

  // Measured at 3 to 7 milliseconds in this browser: about one percent of a beat
  // at 120 BPM, which is an order of magnitude below anything anyone hears as an
  // early entry. The assertion is a fiftieth of a beat, which is the point at
  // which the feature would stop being worth having.
  for (const error of lost) expect(error).toBeLessThan(0.01);
});
