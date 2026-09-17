/** Per-session worktree entry through the shipped Web composition. */

import { basename } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

describe('web e2e: per-session worktree entry', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const workspaceRow = page.getByText(basename(scaffold.workspaceCwd), { exact: true }).first()
      .locator('xpath=ancestor::*[@role="treeitem"][1]')
    await workspaceRow.waitFor({ timeout: 15_000 })
    if (await workspaceRow.getAttribute('aria-expanded') !== 'true') await workspaceRow.click()
    await workspaceRow.hover()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('reports why a plain directory cannot host a worktree instead of failing', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-worktree-entry'))
    const workspaceTitle = basename(scaffold.workspaceCwd)
    await page.getByRole('button', { name: `New worktree session in ${workspaceTitle}` }).click()

    // The activation reaches the shipped worktree controller and service, whose
    // probe answers this directory is not a repository; the reason renders
    // inline and the dialog stays closed.
    await page.getByText('This project is not a git repository').waitFor({ timeout: 15_000 })
    expect(await page.getByRole('dialog').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
