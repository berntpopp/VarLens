import { _electron as electron } from 'playwright';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = await electron.launch({
  args: [join(__dirname, 'out/main/index.js')],
});

const w = await app.firstWindow();
const msgs = [];
w.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));

await w.waitForTimeout(3000);

// Dismiss disclaimer
const btn = await w.$('button:has-text("I Understand")');
if (btn) { await btn.click(); await w.waitForTimeout(1000); }

// Open DemoCase
const item = await w.$('.v-list-item:has-text("DemoCase")');
if (item) { await item.click(); await w.waitForTimeout(3000); }

// Click first variant
const rows = await w.$$('.v-data-table tbody tr');
if (rows.length > 0) { await rows[0].click(); await w.waitForTimeout(2000); }

// Open protein view
const section = await w.$('.variant-identity-section');
const btns = section ? await section.$$('button') : [];
if (btns.length > 0) { await btns[0].click(); await w.waitForTimeout(6000); }

// Screenshot lollipop tab - full size
await w.screenshot({ path: '/tmp/deep-01-lollipop.png', fullPage: true });

// Get detailed layout info
const layoutInfo = await w.evaluate(() => {
  const dialog = document.querySelector('.v-dialog--fullscreen');
  if (!dialog) return { error: 'no dialog' };

  // Check legend content
  const legend = dialog.querySelector('.lollipop-legend, [class*="legend"]');
  const legendHtml = legend ? legend.innerHTML : 'NO LEGEND FOUND';
  const legendText = legend ? legend.textContent : '';

  // Check all buttons in the legend
  const legendBtns = legend ? Array.from(legend.querySelectorAll('button, .v-btn, .v-chip')).map(b => ({
    text: b.textContent?.trim(),
    class: b.className?.substring(0, 100),
    tag: b.tagName
  })) : [];

  // Check toolbar
  const toolbar = dialog.querySelector('.v-toolbar');
  const toolbarText = toolbar ? toolbar.textContent : '';

  // Check tabs
  const tabs = Array.from(dialog.querySelectorAll('.v-tab')).map(t => t.textContent?.trim());

  // Check SVG elements
  const mainSvg = dialog.querySelector('.lollipop-plot-wrapper svg, .lollipop-svg');
  const svgGroups = mainSvg ? Array.from(mainSvg.querySelectorAll('g')).map(g => g.getAttribute('class')).filter(Boolean) : [];

  // Check highlighted variant
  const highlighted = dialog.querySelectorAll('.highlighted');
  const highlightedContent = highlighted.length > 0 ? highlighted[0].innerHTML?.substring(0, 200) : 'NONE';

  // Check clinvar diamonds
  const clinvarGroup = mainSvg ? mainSvg.querySelector('.clinvar-track, [class*="clinvar"]') : null;
  const clinvarElements = clinvarGroup ? clinvarGroup.children.length : 0;

  // Check gnomad dots
  const gnomadGroup = mainSvg ? mainSvg.querySelector('.gnomad-track, [class*="gnomad"]') : null;
  const gnomadElements = gnomadGroup ? gnomadGroup.children.length : 0;

  return {
    legendText: legendText?.substring(0, 500),
    legendBtns: legendBtns.slice(0, 30),
    toolbarText: toolbarText?.substring(0, 200),
    tabs,
    svgGroups: svgGroups.slice(0, 20),
    highlightedCount: highlighted.length,
    highlightedContent,
    clinvarElements,
    gnomadElements
  };
});

console.log('=== Layout Info:', JSON.stringify(layoutInfo, null, 2));

// Test clicking "only" buttons
const legend = await w.$('.v-dialog--fullscreen [class*="legend"], .v-dialog--fullscreen .lollipop-legend');
if (legend) {
  // Find all "only" buttons
  const onlyBtns = await legend.$$('button:has-text("only"), .v-btn:has-text("only")');
  console.log(`=== Found ${onlyBtns.length} "only" buttons`);

  // Find "all" buttons
  const allBtns = await legend.$$('button:has-text("all"), .v-btn:has-text("all")');
  console.log(`=== Found ${allBtns.length} "all" buttons`);

  // Test clicking "only" for Missense
  if (onlyBtns.length > 0) {
    await onlyBtns[0].click();
    await w.waitForTimeout(1000);
    await w.screenshot({ path: '/tmp/deep-02-only-missense.png', fullPage: true });
    console.log('=== Screenshot: after clicking first "only" button');
  }

  // Click "all" to reset
  if (allBtns.length > 0) {
    await allBtns[0].click();
    await w.waitForTimeout(1000);
    await w.screenshot({ path: '/tmp/deep-03-all-reset.png', fullPage: true });
    console.log('=== Screenshot: after clicking "all" button');
  }
}

// Test zoom
const zoomIn = await w.$('.v-dialog--fullscreen button[title*="zoom" i], .v-dialog--fullscreen button:has(svg path[d*="M15.5"])');
if (zoomIn) {
  console.log('=== Found zoom button, clicking');
}

// Switch to 3D tab
const tab3d = await w.$('.v-tab:has-text("3D Structure")');
if (tab3d) {
  await tab3d.click();
  await w.waitForTimeout(6000);
  await w.screenshot({ path: '/tmp/deep-04-3d-tab.png', fullPage: true });

  // Check if canvas rendered
  const canvas = await w.$('.v-dialog--fullscreen canvas');
  if (canvas) {
    const size = await canvas.evaluate(c => ({ w: c.width, h: c.height }));
    console.log(`=== 3D canvas size: ${size.w}x${size.h}`);
  }

  // Check variant sidebar
  const sidebar = await w.$('.variant-sidebar, [class*="variant-sidebar"]');
  if (sidebar) {
    const sidebarText = await sidebar.textContent();
    console.log(`=== 3D sidebar: "${sidebarText?.substring(0, 200)}"`);
  }

  // Try clicking a variant in sidebar
  const varItems = await w.$$('.v-dialog--fullscreen .v-list-item');
  if (varItems.length > 0) {
    console.log(`=== Found ${varItems.length} variant items in 3D sidebar`);
    await varItems[0].click();
    await w.waitForTimeout(2000);
    await w.screenshot({ path: '/tmp/deep-05-3d-variant-click.png', fullPage: true });
  }
}

// Print errors
const errors = msgs.filter(m => m.startsWith('[error]'));
if (errors.length > 0) {
  console.log('\n=== Console ERRORS:');
  for (const e of errors.slice(0, 10)) console.log(e.substring(0, 300));
}

await app.close();
