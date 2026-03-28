import { _electron as electron } from 'playwright';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = await electron.launch({
  args: [join(__dirname, 'out/main/index.js')],
  env: { ...process.env, NODE_ENV: 'development' }
});

const window = await app.firstWindow();
console.log('=== Window URL:', window.url());

// Collect console errors
const consoleMessages = [];
window.on('console', msg => {
  consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
});

await window.waitForTimeout(3000);

// Dismiss the "Research Use Only" disclaimer dialog
const continueBtn = await window.$('button:has-text("I Understand"), button:has-text("Continue"), button:has-text("Understand")');
if (continueBtn) {
  console.log('=== Dismissing disclaimer dialog');
  await continueBtn.click();
  await window.waitForTimeout(1000);
} else {
  console.log('=== No disclaimer dialog found, checking for overlay...');
  const scrim = await window.$('.v-overlay__scrim');
  if (scrim) {
    console.log('=== Found overlay scrim, pressing Escape');
    await window.keyboard.press('Escape');
    await window.waitForTimeout(1000);
  }
}

await window.screenshot({ path: '/tmp/varlens-01-after-dismiss.png', fullPage: true });
console.log('=== Screenshot 1: after dismissing dialog');

// Find and click a case in the sidebar
const caseItems = await window.$$('.v-list-item');
console.log(`=== Found ${caseItems.length} list items in sidebar`);

let caseClicked = false;
for (const item of caseItems) {
  const text = await item.innerText();
  if (text.includes('DemoCase') || text.includes('variants')) {
    console.log(`=== Clicking case: "${text.substring(0, 60)}"`);
    await item.click();
    caseClicked = true;
    await window.waitForTimeout(3000);
    break;
  }
}

if (!caseClicked && caseItems.length > 0) {
  const text = await caseItems[0].innerText();
  console.log(`=== Clicking first item: "${text.substring(0, 60)}"`);
  await caseItems[0].click();
  await window.waitForTimeout(3000);
}

await window.screenshot({ path: '/tmp/varlens-02-case-open.png', fullPage: true });
console.log('=== Screenshot 2: case opened');

// Wait for variant table to load, then click a row
await window.waitForTimeout(2000);
const variantRows = await window.$$('.v-data-table tbody tr');
console.log(`=== Found ${variantRows.length} variant rows`);

if (variantRows.length > 0) {
  // Click first variant row to open details panel
  await variantRows[0].click();
  await window.waitForTimeout(2000);
  await window.screenshot({ path: '/tmp/varlens-03-variant-selected.png', fullPage: true });
  console.log('=== Screenshot 3: variant selected');

  // Look for the variant details panel (right-side navigation drawer)
  // There are two drawers: left sidebar and right details panel
  const drawers = await window.$$('.v-navigation-drawer');
  console.log(`=== Found ${drawers.length} navigation drawers`);

  for (let i = 0; i < drawers.length; i++) {
    const text = await drawers[i].innerText();
    console.log(`  Drawer ${i} text (first 200): "${text.substring(0, 200)}"`);
  }

  // The protein view button is inside the variant-identity-section
  // It's a small icon button with the mdiDna SVG icon
  // Try finding it by looking for the variant-identity-section class
  const identitySection = await window.$('.variant-identity-section');
  if (identitySection) {
    console.log('=== Found variant-identity-section');
    const sectionText = await identitySection.innerText();
    console.log(`=== Section text: "${sectionText.substring(0, 200)}"`);

    // Find buttons inside the identity section
    const sectionBtns = await identitySection.$$('button');
    console.log(`=== Buttons in identity section: ${sectionBtns.length}`);

    // The protein view button is the first icon button in the section
    if (sectionBtns.length > 0) {
      console.log('=== Clicking protein view button (first button in identity section)');
      await sectionBtns[0].click();
      await window.waitForTimeout(5000); // Wait for protein data to load

      await window.screenshot({ path: '/tmp/varlens-04-protein-modal.png', fullPage: true });
      console.log('=== Screenshot 4: protein modal (lollipop tab)');

      // Debug: check SVG data attributes and text elements for the highlighted variant
      const variantDebug = await window.evaluate(() => {
        const svg = document.querySelector('.lollipop-svg');
        if (!svg) return 'no svg';
        // Check all groups
        const groups = svg.querySelectorAll('g[class]');
        const info = [];
        for (const g of groups) {
          info.push({ class: g.getAttribute('class'), childCount: g.children.length });
        }
        // Also look for any text elements (the label)
        const texts = svg.querySelectorAll('text');
        const textContents = [];
        for (const t of texts) {
          textContents.push(t.textContent);
        }
        return { groups: info, texts: textContents };
      });
      console.log('=== SVG groups:', JSON.stringify(variantDebug, null, 2));

      // Debug: check SVG content for highlighted group
      const svgDebug = await window.evaluate(() => {
        const svg = document.querySelector('.lollipop-svg');
        if (!svg) return 'No SVG found';
        const highlighted = svg.querySelector('.highlighted');
        const lollipops = svg.querySelector('.lollipops');
        const gnomad = svg.querySelector('.gnomad');
        return {
          svgDims: `${svg.getAttribute('width')}x${svg.getAttribute('height')}`,
          highlightedElements: highlighted ? highlighted.children.length : 'no .highlighted group',
          highlightedHTML: highlighted ? highlighted.innerHTML.substring(0, 500) : 'N/A',
          lollipopElements: lollipops ? lollipops.children.length : 'no .lollipops group',
          gnomadElements: gnomad ? gnomad.children.length : 'no .gnomad group'
        };
      });
      console.log('=== SVG Debug:', JSON.stringify(svgDebug, null, 2));

      // Check modal content
      const dialog = await window.$('.v-dialog--fullscreen');
      if (dialog) {
        const dialogText = await dialog.innerText();
        console.log('=== Dialog text (first 1000):', dialogText.substring(0, 1000));

        // Check for SVG (lollipop plot)
        const svgs = await dialog.$$('svg');
        console.log(`=== SVGs in dialog: ${svgs.length}`);

        // Try clicking the 3D tab
        const tabs = await dialog.$$('.v-tab');
        console.log(`=== Tabs in dialog: ${tabs.length}`);
        for (const tab of tabs) {
          const tabText = await tab.innerText();
          console.log(`  Tab: "${tabText}"`);
          if (tabText.includes('3D')) {
            console.log('=== Clicking 3D tab');
            await tab.click();
            await window.waitForTimeout(15000); // Wait for 3D structure to load

            await window.screenshot({ path: '/tmp/varlens-05-protein-3d.png', fullPage: true });
            console.log('=== Screenshot 5: protein modal (3D tab)');

            // Check for canvas (3D viewer) or pdbe-molstar
            const canvases = await dialog.$$('canvas');
            console.log(`=== Canvases in dialog: ${canvases.length}`);

            const molstar = await dialog.$$('pdbe-molstar');
            console.log(`=== pdbe-molstar elements: ${molstar.length}`);

            // Debug: check pdbe-molstar attributes and state
            const molstarDebug = await window.evaluate(() => {
              const el = document.querySelector('pdbe-molstar');
              if (!el) return 'no pdbe-molstar element';
              const vi = el.viewerInstance;
              let pluginInfo = {};
              try {
                if (vi && vi.plugin) {
                  const plugin = vi.plugin;
                  pluginInfo = {
                    hasDataState: !!plugin.state?.data,
                    structures: plugin.managers?.structure?.hierarchy?.current?.structures?.length ?? 'N/A',
                    canvasHasContent: !!plugin.canvas3d
                  };
                }
              } catch (e) { pluginInfo = { error: e.message }; }
              // Check if canvas has content
              const canvas = el.querySelector('canvas');
              let canvasInfo = 'no canvas';
              if (canvas) {
                canvasInfo = `${canvas.width}x${canvas.height}, visible=${canvas.style.display !== 'none'}`;
              }
              return {
                customDataUrl: el.getAttribute('custom-data-url'),
                visibility: el.style.visibility,
                hasViewerInstance: !!vi,
                pluginInfo,
                canvasInfo,
                // Check events
                hasEvents: !!(vi?.events),
                eventKeys: vi?.events ? Object.keys(vi.events).join(',') : 'N/A'
              };
            });
            console.log('=== Molstar debug:', JSON.stringify(molstarDebug, null, 2));

            // Check for error alerts in dialog
            const alerts = await dialog.$$('.v-alert');
            for (const alert of alerts) {
              const alertText = await alert.innerText();
              console.log(`=== Alert: "${alertText}"`);
            }

            // Check loading overlay
            const overlay = await dialog.$('.molstar-overlay');
            if (overlay) {
              const overlayText = await overlay.innerText();
              console.log(`=== Molstar overlay: "${overlayText}"`);
            }
            break;
          }
        }
      } else {
        console.log('=== No fullscreen dialog found');
        // Check for any dialog
        const anyDialog = await window.$('.v-dialog');
        if (anyDialog) {
          console.log('=== Found non-fullscreen dialog');
          const text = await anyDialog.innerText();
          console.log(`=== Dialog text: "${text.substring(0, 500)}"`);
        }
      }
    }
  } else {
    console.log('=== No variant-identity-section found');
    // Fallback: dump all buttons for debugging
    const allBtns = await window.$$('button');
    console.log(`=== Total buttons on page: ${allBtns.length}`);
  }
}

// Print console errors
console.log('\n=== Console ERRORS:');
for (const msg of consoleMessages.filter(m => m.startsWith('[error]')).slice(0, 20)) {
  console.log(msg);
}

console.log('\n=== Console WARNINGS:');
for (const msg of consoleMessages.filter(m => m.startsWith('[warning]')).slice(0, 10)) {
  console.log(msg);
}

// Print all console messages related to molstar/structure/3d
console.log('\n=== Console messages (molstar/structure related):');
for (const msg of consoleMessages.filter(m =>
  m.toLowerCase().includes('molstar') ||
  m.toLowerCase().includes('structure') ||
  m.toLowerCase().includes('alphafold') ||
  m.toLowerCase().includes('cif') ||
  m.toLowerCase().includes('load') ||
  m.toLowerCase().includes('fetch') ||
  m.toLowerCase().includes('csp') ||
  m.toLowerCase().includes('refused')
).slice(0, 30)) {
  console.log(msg);
}

await app.close();
