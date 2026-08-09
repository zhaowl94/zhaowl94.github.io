# Manual accessibility checklist

Run this checklist against the final local commit and the deployed GitHub Pages URL.

## Keyboard

- [ ] Confirm the homepage skip link is the first focusable control and moves focus to main content.
- [ ] Reach every homepage tool card, navigation link, refresh button, filter, table row, and modal control using only the keyboard.
- [ ] Confirm focus remains visible in light, dark, and forced-colors modes.
- [ ] Confirm QDII detail dialogs close with `Escape` and do not trap focus unexpectedly.
- [ ] Confirm no link forces a new tab.

## Zoom and reflow

- [ ] At 200% and 400% zoom, confirm homepage content remains readable and actions are not clipped.
- [ ] At a 320 CSS-pixel viewport, confirm the homepage and primary tool controls do not create page-level horizontal scroll.
- [ ] Confirm wide data tables scroll inside their own containers.

## Windows Narrator

- [ ] In current Microsoft Edge, read the homepage from the top and confirm one level-one heading, logical section headings, descriptive links, and correct list sizes.
- [ ] Check each tool's heading, data timestamp, refresh status, filters, and table labels.
- [ ] Confirm chart summaries expose useful text in addition to visual canvas/SVG output.
- [ ] Open `404.html` and confirm the error, explanation, and exit links are announced in order.

## Notes

Automated browser tests cover Axe rules, keyboard structure, forced colors, reduced motion, responsive layout, and zoom. Spoken-output quality remains a human release check.
