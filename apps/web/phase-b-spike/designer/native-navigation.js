/** Native Designer navigation: available before the optional motion island hydrates. */
(() => {
  const page = () => document.querySelector('[data-iv1-route]');
  const state = (root, open) => {
    const toggle = root.querySelector('[data-nav-toggle]');
    const menu = root.querySelector('#site-navigation');
    if (!toggle || !menu) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '關閉選單' : '開啟選單');
    menu.dataset.open = String(open);
  };
  document.addEventListener('click', (event) => {
    const root = page();
    const target = event.target;
    if (!root || !(target instanceof Element)) return;
    const toggle = target.closest('[data-nav-toggle]');
    if (toggle && root.contains(toggle)) {
      state(root, toggle.getAttribute('aria-expanded') !== 'true');
      return;
    }
    const skip = target.closest('.iv1-skip-link');
    if (skip && root.contains(skip)) {
      state(root, false);
      // An active desktop Smoother owns the virtual scroll landing.
      if (!document.documentElement.classList.contains('iv1-smoother-active')) {
        event.preventDefault();
        event.stopPropagation();
        root.querySelector('#main-content')?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
      return;
    }
    const header = root.querySelector('[data-site-header]');
    if (header && (!header.contains(target) || target.closest('#site-navigation a'))) state(root, false);
  }, true);
  document.addEventListener('keydown', (event) => {
    const root = page();
    const toggle = root?.querySelector('[data-nav-toggle]');
    if (root && event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
      state(root, false);
      toggle.focus();
    }
  });
})();
