/** Page-only controller: no spaces/hero data or component stylesheet import. */
import { useEffect, useRef } from "react";
import { props } from "@webflow/data-types";
import { declareComponent } from "@webflow/react";

type RuntimeVariant = "原版動態" | "靜態";

function InvillagePageRuntime({ variant = "原版動態" }: { variant?: RuntimeVariant }) {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const marker = markerRef.current;
    const pageDocument = marker?.ownerDocument;
    const pageRoot = pageDocument?.querySelector<HTMLElement>("[data-iv1-route]");
    const view = pageDocument?.defaultView;
    if (!marker || !pageDocument || !pageRoot || !view) return;

    const header = pageRoot.querySelector<HTMLElement>("[data-site-header]");
    const toggle = pageRoot.querySelector<HTMLButtonElement>("[data-nav-toggle]");
    const menu = pageRoot.querySelector<HTMLElement>("#site-navigation");
    const hero = pageRoot.querySelector<HTMLElement>(".iv1-hero");
    const skipLink = pageRoot.querySelector<HTMLAnchorElement>(".iv1-skip-link");

    const heroMedia = pageRoot.querySelector<HTMLElement>("[data-hero-media]");
    const heroVideo = heroMedia?.querySelector<HTMLVideoElement>("video");
    const heroToggle = pageRoot.querySelector<HTMLButtonElement>("[data-video-toggle]");
    let disposeHero = () => {};
    if (heroMedia && heroVideo && heroToggle) {
      // Designer's generic DOM renderer omits empty boolean attributes.
      // Restore the frozen silent, looping, inline-video contract before play.
      heroVideo.muted = true;
      heroVideo.defaultMuted = true;
      heroVideo.loop = true;
      heroVideo.playsInline = true;
      const preference = view.matchMedia("(prefers-reduced-motion: reduce)");
      const connection = (view.navigator as Navigator & {
        connection?: EventTarget & { saveData?: boolean; effectiveType?: string };
      }).connection;
      let userPaused = false;
      let heroActive = true;
      const constrained = () => Boolean(connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? ""));
      const playing = (value: boolean) => {
        if (!heroActive) return;
        heroMedia.dataset.state = value ? "playing" : "static";
        heroToggle.dataset.playing = String(value);
        heroToggle.setAttribute("aria-label", value ? "暫停影片" : "播放影片");
      };
      const play = async () => {
        if (preference.matches || variant === "靜態") { heroVideo.pause(); playing(false); return; }
        // A failed mobile <source> must not fall through to the larger desktop file.
        // Keep both editable sources, but play only the currently matching one.
        const selected = Array.from(heroVideo.querySelectorAll("source"))
          .find((source) => !source.media || view.matchMedia(source.media).matches);
        if (selected?.src && heroVideo.getAttribute("src") !== selected.src) heroVideo.src = selected.src;
        try { await heroVideo.play(); playing(!heroVideo.paused); }
        catch { userPaused = true; playing(false); }
      };
      const toggleVideo = () => {
        if (heroVideo.paused) { userPaused = false; void play(); }
        else { userPaused = true; heroVideo.pause(); playing(false); }
      };
      const failed = () => { userPaused = true; heroVideo.pause(); playing(false); };
      const paused = () => playing(false);
      const motionChanged = () => {
        if (preference.matches) { heroVideo.pause(); playing(false); }
        else if (!constrained() && !userPaused) void play();
      };
      const networkChanged = () => { if (constrained()) failed(); };
      heroToggle.addEventListener("click", toggleVideo);
      heroVideo.addEventListener("error", failed, true);
      heroVideo.addEventListener("pause", paused);
      preference.addEventListener("change", motionChanged);
      connection?.addEventListener("change", networkChanged);
      if (constrained() || variant === "靜態") playing(false);
      else void play();
      disposeHero = () => {
        heroActive = false;
        heroToggle.removeEventListener("click", toggleVideo);
        heroVideo.removeEventListener("error", failed, true);
        heroVideo.removeEventListener("pause", paused);
        preference.removeEventListener("change", motionChanged);
        connection?.removeEventListener("change", networkChanged);
      };
    }

    const setMenuOpen = (open: boolean) => {
      if (!header || !toggle || !menu) return;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "關閉選單" : "開啟選單");
      menu.dataset.open = String(open);
    };

    // Native navigation is a tiny site-head script, independent of React,
    // reduced-motion and Utility404's non-hydrating Code Components.

    let headerObserver: IntersectionObserver | undefined;
    if (header && hero && view.IntersectionObserver) {
      headerObserver = new view.IntersectionObserver(([entry]) => {
        if (entry) header.dataset.scrolled = String(!entry.isIntersecting);
      }, { rootMargin: "-80px 0px 0px 0px", threshold: 0 });
      headerObserver.observe(hero);
    }

    let active = true;
    let smoother: { kill(): void; scrollTo(target: number | Element, smooth?: boolean): void } | undefined;
    let motionContext: { revert(): void } | undefined;
    let motionMedia: { revert(): void } | undefined;

    const onSkip = (event: MouseEvent) => {
      // Webflow intercepts hash links, so own both the focus and scroll landing.
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      const main = pageRoot.querySelector<HTMLElement>("#main-content");
      main?.focus({ preventScroll: true });
      if (smoother) smoother.scrollTo(0, true);
      else view.scrollTo({
        top: 0,
        behavior: variant === "靜態" || view.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto" : "smooth",
      });
    };
    skipLink?.addEventListener("click", onSkip);

    const dispose = () => {
      if (!active) return;
      active = false;
      headerObserver?.disconnect();
      disposeHero();
      skipLink?.removeEventListener("click", onSkip);
      motionMedia?.revert();
      motionContext?.revert();
      smoother?.kill();
      smoother = undefined;
      pageDocument.documentElement.classList.remove("iv1-smoother-active");
    };

    const onPageHide = (event: PageTransitionEvent) => {
      // A BFCache restore retains this React effect and its event listeners.
      if (!event.persisted) dispose();
    };
    pageDocument.defaultView?.addEventListener("pagehide", onPageHide);

    if (variant === "靜態" || view.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return () => {
        pageDocument.defaultView?.removeEventListener("pagehide", onPageHide);
        dispose();
      };
    }

    const headings = Array.from(pageRoot.querySelectorAll<HTMLElement>(
      ".iv1-section-heading, .iv1-secondary-section-heading",
    )).filter((heading) => heading.tagName !== "H1" && !heading.closest(".iv1-spaces-contact"));
    const closing = pageRoot.querySelector<HTMLElement>(".iv1-spaces-contact .iv1-section-heading");
    const lead = pageRoot.querySelector<HTMLElement>(".iv1-spaces-original-intro p");
    const revealElements = Array.from(pageRoot.querySelectorAll<HTMLElement>(".iv1-reveal"));
    const revealPairs = Array.from(pageRoot.querySelectorAll<HTMLElement>("[data-reveal-pair]"));
    if (!headings.length && !closing && !lead && !revealElements.length && !revealPairs.length) {
      return () => {
        pageDocument.defaultView?.removeEventListener("pagehide", onPageHide);
        dispose();
      };
    }

    void (async () => {
      try {
        await pageDocument.fonts.ready;
        if (!active || view.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        const [gsapModule, triggerModule] = await Promise.all([
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);
        if (!active) return;

        const splitTextModule = headings.length ? await import("gsap/SplitText") : null;
        if (!active) return;

        const gsap = gsapModule.gsap;
        const ScrollTrigger = triggerModule.ScrollTrigger;
        const SplitText = splitTextModule?.SplitText;
        gsap.registerPlugin(ScrollTrigger);
        if (SplitText) gsap.registerPlugin(SplitText);

        const wrapper = pageRoot.querySelector<HTMLElement>("#smooth-wrapper");
        const content = pageRoot.querySelector<HTMLElement>("#smooth-content");
        const context = gsap.context(() => {
          const media = gsap.matchMedia();
          motionMedia = media;

          media.add(
            "(min-width: 64rem) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
            () => {
              if (!wrapper || !content) return;
              let cancelled = false;
              let pageSmoother: typeof smoother = undefined;
              void import("gsap/ScrollSmoother").then(({ ScrollSmoother }) => {
                if (!active || cancelled) return;
                gsap.registerPlugin(ScrollSmoother);
                pageSmoother = ScrollSmoother.create({
                  wrapper,
                  content,
                  smooth: 0.22,
                  smoothTouch: 0,
                  effects: false,
                  normalizeScroll: false,
                });
                smoother = pageSmoother;
                pageDocument.documentElement.classList.add("iv1-smoother-active");
                ScrollTrigger.refresh();
              }).catch(() => {
                // Native scrolling remains available if the optional smoother cannot load.
              });

              return () => {
                cancelled = true;
                pageSmoother?.kill();
                if (smoother === pageSmoother) smoother = undefined;
                pageDocument.documentElement.classList.remove("iv1-smoother-active");
              };
            },
          );

          media.add("(prefers-reduced-motion: no-preference)", () => {
            const revealed = new WeakSet<HTMLElement>();
            const splits = SplitText ? headings.map((heading) => SplitText.create(heading, {
              type: "lines",
              mask: "lines",
              linesClass: "editorial-motion-line",
              autoSplit: true,
              aria: "auto",
              onSplit(self) {
                const rect = heading.getBoundingClientRect();
                if (revealed.has(heading) || rect.bottom < 0) return;
                const entering = {
                  y: 10,
                  autoAlpha: 0,
                  duration: 0.45,
                  stagger: { amount: 0.08 },
                  ease: "power2.out",
                  onComplete: () => revealed.add(heading),
                };
                if (rect.top <= view.innerHeight * 0.88) return gsap.from(self.lines, entering);
                return gsap.from(self.lines, {
                  ...entering,
                  scrollTrigger: { trigger: heading, start: "clamp(top 88%)", once: true },
                });
              },
            })) : [];

            for (const element of [lead, closing]) {
              if (!element) continue;
              gsap.fromTo(element, { y: 12, opacity: 0.82 }, {
                y: 0,
                opacity: 1,
                duration: 0.65,
                ease: "power2.out",
                clearProps: "transform,opacity",
                scrollTrigger: { trigger: element, start: "clamp(top 88%)", once: true },
              });
            }

            revealElements.forEach((element) => {
              gsap.from(element, {
                y: 24,
                opacity: 0,
                duration: 0.7,
                ease: "power1.out",
                scrollTrigger: { trigger: element, start: "top 85%", once: true },
              });
            });

            const latePairContexts: Array<{ revert(): void }> = [];
            revealPairs.forEach((article) => {
              const mediaElement = article.querySelector<HTMLElement>(".iv1-shared-space-media");
              const copy = article.querySelector<HTMLElement>(".iv1-shared-space-copy");
              if (!mediaElement || !copy) return;
              ScrollTrigger.create({
                trigger: article,
                start: "top 88%",
                once: true,
                onEnter: () => {
                  latePairContexts.push(gsap.context(() => {
                    gsap.fromTo([mediaElement, copy], { y: 18, opacity: 0.72 }, {
                      y: 0,
                      opacity: 1,
                      duration: 0.65,
                      stagger: 0.08,
                      ease: "power2.out",
                      clearProps: "transform,opacity",
                    });
                  }, pageRoot));
                },
              });
            });

            ScrollTrigger.refresh();
            return () => {
              latePairContexts.forEach((pairContext) => pairContext.revert());
              splits.forEach((split) => split.revert());
            };
          });
        }, pageRoot);

        motionContext = context;
      } catch {
        // Native header and skip-link behavior remains available if motion modules fail to load.
      }
    })();

    return () => {
      pageDocument.defaultView?.removeEventListener("pagehide", onPageHide);
      dispose();
    };
  }, [variant]);

  return <span ref={markerRef} hidden aria-hidden="true" data-invillage-page-runtime />;
}

export const InvillagePageRuntimeDefinition = declareComponent(InvillagePageRuntime, {
  name: "Invillage Page Runtime",
  description: "管理原生頁面的導覽、略過連結、揭露動畫與平滑捲動。請每頁只放一個。",
  group: "Invillage",
  props: {
    variant: props.Variant({
      name: "動態效果",
      options: ["原版動態", "靜態"],
      defaultValue: "原版動態",
    }),
  },
});
