// Editorial headings stay readable without JavaScript; motion is added only
// after the site font is ready and only when the user permits motion.
async function startEditorialMotion() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const headings = Array.from(document.querySelectorAll<HTMLElement>(
    '.section-heading, .secondary-section-heading',
  )).filter((heading) => heading.tagName !== 'H1' && !heading.closest('.spaces-contact'));
  const closing = document.querySelector<HTMLElement>('.spaces-contact .section-heading');
  const lead = document.querySelector<HTMLElement>('.spaces-original-intro p');
  if (!headings.length && !closing && !lead) return;

  let active = true;
  let media: ReturnType<typeof import('gsap').gsap.matchMedia> | undefined;
  window.addEventListener('pagehide', () => {
    active = false;
    media?.revert();
  }, { once: true });

  await document.fonts.ready;
  if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const [{ gsap }, { ScrollTrigger }, splitTextModule] = await Promise.all([
    import('gsap'),
    import('gsap/ScrollTrigger'),
    headings.length ? import('gsap/SplitText') : Promise.resolve(null),
  ]);
  if (!active) return;
  gsap.registerPlugin(ScrollTrigger);
  const SplitText = splitTextModule?.SplitText;
  if (SplitText) gsap.registerPlugin(SplitText);

  media = gsap.matchMedia();
  let initialSmootherReady = Promise.resolve();
  media.add('(min-width: 64rem) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)', () => {
    let cancelled = false;
    let smoother: ReturnType<typeof import('gsap/ScrollSmoother').ScrollSmoother.create> | undefined;
    const skipLink = document.querySelector<HTMLAnchorElement>('.skip-link');
    const onSkip = () => {
      // Hash focus is native, but a transformed content wrapper needs its
      // matching visual scroll position updated explicitly.
      requestAnimationFrame(() => smoother?.scrollTo(0, true));
    };
    initialSmootherReady = import('gsap/ScrollSmoother').then(({ ScrollSmoother }) => {
      if (!active || cancelled) return;
      gsap.registerPlugin(ScrollSmoother);
      smoother = ScrollSmoother.create({
        wrapper: '#smooth-wrapper',
        content: '#smooth-content',
        smooth: 0.55,
        smoothTouch: 0,
        effects: false,
        normalizeScroll: false,
      });
      document.documentElement.classList.add('smoother-active');
      skipLink?.addEventListener('click', onSkip);
      ScrollTrigger.refresh();
    }).catch((error: unknown) => {
      if (!cancelled) console.warn('Desktop smoothing unavailable:', error);
    });
    return () => {
      cancelled = true;
      skipLink?.removeEventListener('click', onSkip);
      smoother?.kill();
      smoother = undefined;
      document.documentElement.classList.remove('smoother-active');
    };
  });
  // On an initial desktop load, create the smoother before heading triggers.
  await initialSmootherReady;
  if (!active) return;
  media.add('(prefers-reduced-motion: no-preference)', () => {
    const revealed = new WeakSet<HTMLElement>();
    const splits = SplitText ? headings.map((heading) => SplitText.create(heading, {
      // CJK has no spaces between words; stagger characters rather than
      // relying on whitespace-based word or line groups.
      type: 'lines,chars',
      mask: 'lines',
      linesClass: 'editorial-motion-line',
      autoSplit: true,
      aria: 'auto',
      onSplit(self) {
        // Browser history can restore the page below this heading.
        const rect = heading.getBoundingClientRect();
        if (revealed.has(heading) || rect.bottom < 0) return;
        const entering = {
          y: 10,
          autoAlpha: 0,
          duration: 0.52,
          stagger: { amount: 0.24 },
          ease: 'power2.out',
          onComplete: () => revealed.add(heading),
        };
        // ScrollTrigger's clamped start can be 0 for an initial-screen H2;
        // at scrollY 0 it would otherwise remain invisible until a scroll.
        if (rect.top <= window.innerHeight * 0.88) {
          return gsap.from(self.chars, entering);
        }
        return gsap.from(self.chars, {
          ...entering,
          scrollTrigger: {
            trigger: heading,
            start: 'clamp(top 88%)',
            once: true,
          },
        });
      },
    })) : [];

    for (const element of [lead, closing]) {
      if (!element) continue;
      gsap.fromTo(element, { y: 12, opacity: 0.82 }, {
        y: 0,
        opacity: 1,
        duration: 0.65,
        ease: 'power2.out',
        clearProps: 'transform,opacity',
        scrollTrigger: { trigger: element, start: 'clamp(top 88%)', once: true },
      });
    }

    ScrollTrigger.refresh();
    return () => splits.forEach((split) => split.revert());
  });
}

void startEditorialMotion().catch((error: unknown) => {
  // Static headings remain intact if the optional animation cannot load.
  console.warn('Editorial motion unavailable:', error);
});
