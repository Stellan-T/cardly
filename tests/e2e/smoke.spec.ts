import { expect, test, type Page } from '@playwright/test'

/**
 * Smoke test against the Firebase emulators:
 * sign up → paste notes → create set → Flashcards → one Learn round → Test.
 */

const PAIRS: [string, string][] = [
  ['Photosynthesis', 'process by which plants make glucose using light'],
  ['Mitochondria', 'organelle where cellular respiration takes place'],
  ['Osmosis', 'diffusion of water across a membrane'],
  ['Nucleus', 'organelle that contains the DNA'],
  ['Ribosome', 'structure that builds proteins'],
  ['Enzyme', 'protein that speeds up a reaction'],
  ['Chlorophyll', 'green pigment that absorbs light'],
  ['Vacuole', 'sac that stores water and food'],
]
const NOTES = PAIRS.map(([t, d]) => `- ${t}: ${d}`).join('\n')

/** The term whose definition appears in the given text. */
function termFor(text: string): string {
  const pair = PAIRS.find(([, d]) => text.includes(d))
  if (!pair) throw new Error(`No known definition in: ${text.slice(0, 120)}`)
  return pair[0]
}

async function signUp(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByRole('tab', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('E2E Student')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible()
}

async function exitToSet(page: Page) {
  await page.getByRole('button', { name: 'Exit to set' }).click()
  await expect(page.getByRole('heading', { name: 'E2E Biology' })).toBeVisible()
}

test('import notes, study with Flashcards, Learn and Test', async ({ page }) => {
  await signUp(page)

  // Paste notes → live preview → create set.
  await page.getByTestId('cta-import').click()
  await page.getByTestId('import-text').fill(NOTES)
  await expect(page.getByTestId('import-count')).toHaveText('8 cards detected')
  await page.getByLabel('Set title').fill('E2E Biology')
  await page.getByRole('button', { name: /Create set/ }).click()
  await expect(page.getByRole('heading', { name: 'E2E Biology' })).toBeVisible()
  await expect(page.getByText('Terms in this set (8)')).toBeVisible()

  // Flashcards (Basic sorting for small sets): two still learning, then review them.
  await page.getByTestId('activity-flashcards').click()
  await expect(page.getByTestId('fc-know')).toBeVisible()
  for (let i = 0; i < PAIRS.length; i++) {
    await page.keyboard.press('Space')
    await page.getByTestId(i < 2 ? 'fc-learning' : 'fc-know').click()
  }
  await page.getByTestId('fc-keep-reviewing').click()
  for (let i = 0; i < 2; i++) await page.getByTestId('fc-know').click()
  await expect(page.getByText('You know all of them!')).toBeVisible()
  await exitToSet(page)

  // Learn: one full round answered correctly.
  await page.getByTestId('activity-learn').click()
  await page.getByTestId('learn-goal-memorize').click()
  const checkpoint = page.getByTestId('learn-checkpoint-continue')
  for (let guard = 0; guard < 40; guard++) {
    if (await checkpoint.isVisible()) break
    const question = page.locator('[data-testid^="learn-q-"]').first()
    await question.waitFor()
    const type = (await question.getAttribute('data-testid'))!.replace('learn-q-', '')
    const qid = await question.getAttribute('data-qid')
    const answer = termFor((await question.textContent()) ?? '')
    if (type === 'mc') {
      await question.getByRole('button', { name: new RegExp(`^\\d\\s*${answer}$`) }).click()
    } else if (type === 'written' || type === 'spell') {
      await question.getByTestId('learn-input').fill(answer)
      await question.getByTestId('learn-input').press('Enter')
    } else {
      throw new Error(`Unexpected question type ${type}`)
    }
    // Correct answers advance automatically.
    await expect(page.locator(`[data-qid="${qid}"]`)).toHaveCount(0)
  }
  await expect(page.getByText(/Round 1 complete/)).toBeVisible()
  await checkpoint.click()
  await exitToSet(page)

  // Test: written questions only, answered correctly.
  await page.getByTestId('activity-test').click()
  for (const name of ['True/False', 'Multiple choice', 'Matching']) {
    await page.getByRole('switch', { name }).uncheck()
  }
  await page.getByRole('button', { name: 'Start test' }).click()
  const written = page.locator('article', { has: page.getByPlaceholder('Your answer') })
  await expect(written).toHaveCount(PAIRS.length)
  for (const article of await written.all()) {
    await article.getByPlaceholder('Your answer').fill(termFor((await article.textContent()) ?? ''))
  }
  await page.getByRole('button', { name: 'Submit test' }).first().click()
  await expect(page.getByLabel('Score: 100%')).toBeVisible()

  // Progress shows up on the set page.
  await exitToSet(page)
  await expect(page.locator('.bucket.mastered .count')).not.toHaveText('0')
})
