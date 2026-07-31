# Manual accessibility checklist

Run this checklist against the final local commit and again against the deployed GitHub Pages URL.

## Keyboard

- [ ] Start with the browser address bar, press `Tab`, and confirm the skip link is the first page control.
- [ ] Activate the skip link and confirm focus moves to the main content.
- [ ] Reach every navigation, language, repository, Release, and footer link using only the keyboard.
- [ ] Confirm focus is always visible in light, dark, and forced-colors modes.
- [ ] Confirm no focus trap and no unexpected new tab.

## Zoom and reflow

- [ ] At 200% zoom, confirm no content or action is clipped.
- [ ] At 400% zoom, confirm content reflows into one readable column.
- [ ] At a 320 CSS-pixel viewport, confirm there is no page-level horizontal scroll.

## Language

- [ ] Switch to English and confirm the document language becomes `en`.
- [ ] Use browser Back and Forward and confirm the selected language follows the URL.
- [ ] Disable JavaScript and confirm both language versions and all project links remain readable.

## Windows Narrator

- [ ] In current Microsoft Edge, start Narrator and read from the top of the page.
- [ ] Confirm one level-one heading, logical section headings, descriptive link names, and correct list sizes.
- [ ] Confirm Chinese and English phrases use the appropriate language pronunciation.
- [ ] Confirm the decorative system diagram is not announced as unexplained content.
- [ ] Open `404.html` and confirm the error, explanation, and two exit links are announced in order.

## Notes

Automated browser tests cover keyboard structure, Axe rules, forced colors, reduced motion, and zoom. Spoken-output quality remains a human release check because browser automation cannot establish whether Narrator pronunciation is understandable.
