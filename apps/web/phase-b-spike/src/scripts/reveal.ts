import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const motion = gsap.matchMedia();
motion.add('(prefers-reduced-motion: no-preference)', () => {
  document.querySelectorAll<HTMLElement>('.reveal').forEach((element) => {
    gsap.from(element, {
      y: 24,
      opacity: 0,
      duration: 0.7,
      ease: 'power1.out',
      scrollTrigger: { trigger: element, start: 'top 85%', once: true },
    });
  });

  document.querySelectorAll<HTMLElement>('[data-reveal-pair]').forEach((article) => {
    const media = article.querySelector<HTMLElement>('.shared-space-media');
    const copy = article.querySelector<HTMLElement>('.shared-space-copy');
    if (!media || !copy) return;

    ScrollTrigger.create({
      trigger: article,
      start: 'top 88%',
      once: true,
      onEnter: () => {
        gsap.fromTo(
          [media, copy],
          { y: 18, opacity: 0.72 },
          {
            y: 0,
            opacity: 1,
            duration: 0.65,
            stagger: 0.08,
            ease: 'power2.out',
            clearProps: 'transform,opacity',
          },
        );
      },
    });
  });
});

window.addEventListener('pagehide', () => motion.revert(), { once: true });
