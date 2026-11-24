// Tells the stylesheet whether the last input was a pointer (mouse, touch, pen) or the keyboard, as `data-input` on <html>.
// Browsers decide this for :focus-visible themselves, but a control that script focuses (a modal's close button, a drawer's first control) can keep its keyboard ring after a
// mouse click. The ring is for keyboard users (WCAG 2.4.7): a pointer user does not need it, so theme.scss drops it while the last input was a pointer, and it comes back on the next key press.
const root = document.documentElement
root.dataset.input = 'pointer'
addEventListener('pointerdown', () => { root.dataset.input = 'pointer' }, true)
addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') root.dataset.input = 'keyboard' }, true)
