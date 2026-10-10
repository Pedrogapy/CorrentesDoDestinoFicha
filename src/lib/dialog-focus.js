// Mantém o teclado no diálogo e devolve o foco ao controle de origem.
export function bindDialogFocus(overlay, close) {
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...overlay.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')]
      .filter(el => !el.disabled && !el.closest('[hidden],[inert]') && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}
