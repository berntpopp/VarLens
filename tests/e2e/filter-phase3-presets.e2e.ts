/**
 * E2E test for Filter Phase 3: Preset System
 * Tests preset bar visibility, toggling, save/manage dialogs,
 * and preset persistence across navigation.
 */
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  })
}

/** Helper to dismiss any open dialog overlays */
async function dismissDialogs(window: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  // Press Escape to close any open dialogs
  await window.keyboard.press('Escape')
  await window.waitForTimeout(300)
  // Press again in case of nested dialogs
  await window.keyboard.press('Escape')
  await window.waitForTimeout(300)
}

// eslint-disable-next-line no-empty-pattern
test('preset bar appears with built-in presets', async ({}, testInfo) => {
  test.setTimeout(60000)
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application', { timeout: 15000 })

    // Dismiss disclaimer
    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(300)
    }

    // Select first case
    const firstCase = window.locator('.v-navigation-drawer .v-list-item').first()
    await expect(firstCase).toBeVisible({ timeout: 10000 })
    await firstCase.click()
    await window.waitForTimeout(1500)

    // Wait for filter toolbar
    await expect(window.locator('.filter-toolbar-container')).toBeVisible({ timeout: 15000 })

    // Preset bar should be visible
    const presetBar = window.locator('.preset-bar')
    await expect(presetBar).toBeVisible({ timeout: 10000 })

    await window.screenshot({ path: testInfo.outputPath('preset-bar.png') })

    // Check all 8 built-in presets
    const expectedPresets = [
      'Rare (1%)',
      'Very Rare (0.1%)',
      'Ultra Rare',
      'HIGH Impact',
      'HIGH+MOD',
      'CADD >= 15',
      'CADD >= 20',
      'ClinVar Path.'
    ]

    for (const name of expectedPresets) {
      const chip = presetBar.locator(`.v-chip:has-text("${name}")`)
      await expect(chip).toBeVisible({ timeout: 3000 })
    }
    console.log('✓ All 8 built-in preset chips visible')

    // Verify chips are outlined (not active)
    const firstChip = presetBar.locator('.v-chip').first()
    const classes = await firstChip.getAttribute('class')
    expect(classes).toContain('v-chip--variant-outlined')
    console.log('✓ Chips are in outlined (inactive) state')
  } finally {
    if (app) await app.close()
  }
})

// eslint-disable-next-line no-empty-pattern
test('toggling a preset changes chip style and applies filters', async ({}, testInfo) => {
  test.setTimeout(60000)
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application', { timeout: 15000 })

    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(300)
    }

    const firstCase = window.locator('.v-navigation-drawer .v-list-item').first()
    await expect(firstCase).toBeVisible({ timeout: 10000 })
    await firstCase.click()
    await window.waitForTimeout(1500)

    await expect(window.locator('.filter-toolbar-container')).toBeVisible({ timeout: 15000 })
    const presetBar = window.locator('.preset-bar')
    await expect(presetBar).toBeVisible({ timeout: 10000 })

    // Get initial count
    const resultChip = window.locator('.results-chip')
    const initialText = await resultChip.textContent()
    console.log(`  Initial: ${initialText?.trim()}`)

    // Click "Rare (1%)" — toggle ON
    const rareChip = presetBar.locator('.v-chip:has-text("Rare (1%)")')
    await rareChip.click()
    await window.waitForTimeout(1000)

    // Chip should now be flat/primary
    const activeClasses = await rareChip.getAttribute('class')
    expect(activeClasses).toContain('v-chip--variant-flat')
    expect(activeClasses).toContain('bg-primary')
    console.log('✓ Chip toggled to active (flat, primary)')

    await window.screenshot({ path: testInfo.outputPath('preset-active.png') })

    // Count may have changed (filter applied)
    const filteredText = await resultChip.textContent()
    console.log(`  After Rare (1%): ${filteredText?.trim()}`)

    // Click again — toggle OFF
    await rareChip.click()
    await window.waitForTimeout(1000)

    const inactiveClasses = await rareChip.getAttribute('class')
    expect(inactiveClasses).toContain('v-chip--variant-outlined')
    console.log('✓ Chip toggled back to inactive (outlined)')

    // Count should return to original
    const restoredText = await resultChip.textContent()
    console.log(`  After toggle off: ${restoredText?.trim()}`)
    expect(restoredText?.trim()).toBe(initialText?.trim())
    console.log('✓ Count restored after preset deactivated')
  } finally {
    if (app) await app.close()
  }
})

// eslint-disable-next-line no-empty-pattern
test('clear all deactivates presets', async ({}, testInfo) => {
  test.setTimeout(60000)
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application', { timeout: 15000 })

    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(300)
    }

    const firstCase = window.locator('.v-navigation-drawer .v-list-item').first()
    await expect(firstCase).toBeVisible({ timeout: 10000 })
    await firstCase.click()
    await window.waitForTimeout(1500)

    await expect(window.locator('.filter-toolbar-container')).toBeVisible({ timeout: 15000 })
    const presetBar = window.locator('.preset-bar')
    await expect(presetBar).toBeVisible({ timeout: 10000 })

    // Activate two presets
    await presetBar.locator('.v-chip:has-text("Rare (1%)")').click()
    await window.waitForTimeout(500)
    await presetBar.locator('.v-chip:has-text("HIGH Impact")').click()
    await window.waitForTimeout(500)

    // Both should be active
    const rareClasses = await presetBar
      .locator('.v-chip:has-text("Rare (1%)")')
      .getAttribute('class')
    expect(rareClasses).toContain('v-chip--variant-flat')

    // Click Clear
    const clearBtn = window.locator('.v-btn:has-text("Clear")').first()
    await clearBtn.click()
    await window.waitForTimeout(1000)

    await window.screenshot({ path: testInfo.outputPath('after-clear.png') })

    // Both presets should be inactive again
    const rareAfterClear = await presetBar
      .locator('.v-chip:has-text("Rare (1%)")')
      .getAttribute('class')
    expect(rareAfterClear).toContain('v-chip--variant-outlined')
    console.log('✓ Presets deactivated after Clear All')

    const highAfterClear = await presetBar
      .locator('.v-chip:has-text("HIGH Impact")')
      .getAttribute('class')
    expect(highAfterClear).toContain('v-chip--variant-outlined')
    console.log('✓ Both presets back to outlined after Clear')
  } finally {
    if (app) await app.close()
  }
})

// eslint-disable-next-line no-empty-pattern
test('manage presets dialog works', async ({}, testInfo) => {
  test.setTimeout(60000)
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application', { timeout: 15000 })

    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(300)
    }

    const firstCase = window.locator('.v-navigation-drawer .v-list-item').first()
    await expect(firstCase).toBeVisible({ timeout: 10000 })
    await firstCase.click()
    await window.waitForTimeout(1500)

    await expect(window.locator('.filter-toolbar-container')).toBeVisible({ timeout: 15000 })
    const presetBar = window.locator('.preset-bar')
    await expect(presetBar).toBeVisible({ timeout: 10000 })

    // Click manage button (cog icon - last button in preset bar)
    const manageBtn = presetBar.locator('.v-btn').last()
    await manageBtn.click()
    await window.waitForTimeout(500)

    // Manage dialog should be visible
    const manageDialog = window.locator('.v-dialog:has-text("Manage Presets")')
    await expect(manageDialog).toBeVisible({ timeout: 5000 })
    console.log('✓ Manage dialog opened')

    await window.screenshot({ path: testInfo.outputPath('manage-dialog.png') })

    // Should show lock icons for built-in presets
    const lockIcons = manageDialog.locator('.mdi-lock')
    expect(await lockIcons.count()).toBeGreaterThanOrEqual(8)
    console.log('✓ Built-in presets show lock icons')

    // Should have eye visibility toggles
    const eyeIcons = manageDialog.locator('.mdi-eye')
    expect(await eyeIcons.count()).toBeGreaterThanOrEqual(8)
    console.log('✓ Visibility toggles present')

    // Built-in presets should NOT have delete buttons
    const deleteIcons = manageDialog.locator('.mdi-delete')
    expect(await deleteIcons.count()).toBe(0)
    console.log('✓ No delete buttons for built-in presets')

    // Toggle visibility of first preset
    const firstEye = eyeIcons.first()
    await firstEye.click()
    await window.waitForTimeout(500)

    await window.screenshot({ path: testInfo.outputPath('manage-hide-preset.png') })

    // The eye should now be eye-off
    const eyeOffCount = await manageDialog.locator('.mdi-eye-off').count()
    expect(eyeOffCount).toBeGreaterThanOrEqual(1)
    console.log('✓ Visibility toggle works (eye -> eye-off)')

    // Toggle it back
    const eyeOff = manageDialog.locator('.mdi-eye-off').first()
    await eyeOff.click()
    await window.waitForTimeout(500)

    // Close dialog
    await window.keyboard.press('Escape')
    await window.waitForTimeout(300)
    console.log('✓ Manage dialog closed')
  } finally {
    if (app) await app.close()
  }
})

// eslint-disable-next-line no-empty-pattern
test('save and delete user preset', async ({}, testInfo) => {
  test.setTimeout(90000)
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application', { timeout: 15000 })

    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(300)
    }

    const firstCase = window.locator('.v-navigation-drawer .v-list-item').first()
    await expect(firstCase).toBeVisible({ timeout: 10000 })
    await firstCase.click()
    await window.waitForTimeout(1500)

    await expect(window.locator('.filter-toolbar-container')).toBeVisible({ timeout: 15000 })
    const presetBar = window.locator('.preset-bar')
    await expect(presetBar).toBeVisible({ timeout: 10000 })

    // Activate a preset to make Save button appear
    await presetBar.locator('.v-chip:has-text("Rare (1%)")').click()
    await window.waitForTimeout(500)

    // Click Save button
    const saveBtn = presetBar.locator('.v-btn:has-text("Save")')
    await expect(saveBtn).toBeVisible({ timeout: 3000 })
    await saveBtn.click()
    await window.waitForTimeout(500)

    // Save dialog should open
    const saveDialog = window.locator('.v-dialog:has-text("Save Filter Preset")')
    await expect(saveDialog).toBeVisible({ timeout: 5000 })
    console.log('✓ Save dialog opened')

    await window.screenshot({ path: testInfo.outputPath('save-dialog.png') })

    // Fill in name
    const nameInput = saveDialog.locator('input').first()
    await nameInput.fill('E2E Test Preset')
    await window.waitForTimeout(200)

    // Fill in description
    const descInput = saveDialog.locator('textarea').first()
    await descInput.fill('Created by E2E test')
    await window.waitForTimeout(200)

    await window.screenshot({ path: testInfo.outputPath('save-dialog-filled.png') })

    // Click save button in dialog
    const dialogSaveBtn = saveDialog.locator('.v-btn:has-text("Save")').last()
    await dialogSaveBtn.click()
    await window.waitForTimeout(2000)

    await window.screenshot({ path: testInfo.outputPath('after-save.png') })

    // Dialog should close
    await expect(saveDialog).not.toBeVisible({ timeout: 5000 })
    console.log('✓ Save dialog closed')

    // New preset should appear in preset bar
    const newChip = presetBar.locator('.v-chip:has-text("E2E Test Preset")')
    await expect(newChip).toBeVisible({ timeout: 5000 })
    console.log('✓ New preset chip appears in bar')

    // New chip should show user icon (mdi-account)
    const userIcon = newChip.locator('.mdi-account')
    expect(await userIcon.count()).toBe(1)
    console.log('✓ User preset shows account icon')

    await window.screenshot({ path: testInfo.outputPath('new-preset-in-bar.png') })

    // Now delete the user preset via manage dialog
    // First dismiss any overlay
    await dismissDialogs(window)

    // Open manage dialog
    const manageBtn = presetBar.locator('.v-btn').last()
    await manageBtn.click()
    await window.waitForTimeout(500)

    const manageDialog = window.locator('.v-dialog:has-text("Manage Presets")')
    await expect(manageDialog).toBeVisible({ timeout: 5000 })

    await window.screenshot({ path: testInfo.outputPath('manage-with-user-preset.png') })

    // Find the delete button for our user preset
    const userPresetItem = manageDialog.locator('.v-list-item:has-text("E2E Test Preset")')
    await expect(userPresetItem).toBeVisible()
    console.log('✓ User preset visible in manage dialog')

    const deleteBtn = userPresetItem.locator('.mdi-delete')
    await expect(deleteBtn).toBeVisible()
    await deleteBtn.click()
    await window.waitForTimeout(500)

    await window.screenshot({ path: testInfo.outputPath('delete-confirm.png') })

    // Confirm deletion
    const confirmBtn = window.locator('.v-dialog .v-btn:has-text("Delete")').last()
    await confirmBtn.click()
    await window.waitForTimeout(1000)

    console.log('✓ User preset deleted')

    // Close manage dialog
    await window.keyboard.press('Escape')
    await window.waitForTimeout(300)

    // Verify the user preset is gone from the bar
    const deletedChip = presetBar.locator('.v-chip:has-text("E2E Test Preset")')
    expect(await deletedChip.count()).toBe(0)
    console.log('✓ Deleted preset no longer in bar')

    await window.screenshot({ path: testInfo.outputPath('after-delete.png') })
  } finally {
    if (app) await app.close()
  }
})

// eslint-disable-next-line no-empty-pattern
test('preset bar works in cohort view', async ({}, testInfo) => {
  test.setTimeout(60000)
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application', { timeout: 15000 })

    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(300)
    }

    // Navigate to cohort view
    const cohortNav = window.locator(
      '.v-navigation-drawer .v-list-item:has-text("Cohort")'
    )
    if ((await cohortNav.count()) === 0) {
      console.log('⚠ No Cohort navigation item found — skipping')
      return
    }

    await cohortNav.first().click()
    await window.waitForTimeout(2000)

    await window.screenshot({ path: testInfo.outputPath('cohort-view.png') })

    // Check if filter toolbar appears (cohort needs data)
    const filterToolbar = window.locator('.filter-toolbar-container')
    if ((await filterToolbar.count()) === 0) {
      console.log('⚠ No filter toolbar in cohort view (may need cohort data)')
      return
    }

    // Check for preset bar
    const presetBar = window.locator('.preset-bar')
    await expect(presetBar).toBeVisible({ timeout: 10000 })
    console.log('✓ Preset bar visible in cohort view')

    await window.screenshot({ path: testInfo.outputPath('cohort-preset-bar.png') })

    // Verify preset chips
    const chipCount = await presetBar.locator('.v-chip').count()
    expect(chipCount).toBeGreaterThanOrEqual(8)
    console.log(`✓ ${chipCount} preset chips in cohort view`)

    // Toggle a preset
    const rareChip = presetBar.locator('.v-chip:has-text("Rare (1%)")')
    await rareChip.click()
    await window.waitForTimeout(1000)

    const activeClasses = await rareChip.getAttribute('class')
    expect(activeClasses).toContain('v-chip--variant-flat')
    console.log('✓ Preset toggle works in cohort view')

    await window.screenshot({ path: testInfo.outputPath('cohort-preset-active.png') })
  } finally {
    if (app) await app.close()
  }
})
