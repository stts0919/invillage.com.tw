import { useEffect, useId, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";

type Category = "rooms" | "shared-spaces";

type GalleryPhoto = {
  assetId: string;
  alt: string;
  width: number;
  height: number;
  variants: { width: number; url: string }[];
};

type SpaceItem = {
  id: string;
  label: string;
  panelHeading: string;
  description: string;
  imageAlt: string;
  media: {
    assetId: string;
    small: string;
    medium: string;
    large: string;
  };
  gallery: GalleryPhoto[];
};

type Props = {
  title: string;
  rooms: SpaceItem[];
  sharedSpaces: SpaceItem[];
};

// Mobile stage is at least 36rem high or 76svh; the widest 3:2 photos need
// up to 1.5x that height in source width to cover the portrait slot.
const mainImageSizes = "(max-width: 48rem) max(54rem, 114svh), 100vw";

function stageImageUrl(url: string, retry: number) {
  return retry > 0 ? url + (url.includes("?") ? "&" : "?") + "iv-retry=" + retry : url;
}

function imageSrcSet(item: SpaceItem, retry = 0) {
  return `${stageImageUrl(item.media.small, retry)} 640w, ${stageImageUrl(item.media.medium, retry)} 1280w, ${stageImageUrl(item.media.large, retry)} 1920w`;
}

function gallerySrcSet(photo: GalleryPhoto) {
  return photo.variants.map((variant) => `${variant.url} ${variant.width}w`).join(", ");
}

function gallerySizes(index: number, count: number) {
  const mobile = index % 2 === 0
    ? "(max-width: 48rem) calc(90vw - 2.25rem)"
    : "(max-width: 48rem) calc(100vw - 2.5rem)";
  if (count === 5 && index === 4) return `${mobile}, (max-width: 80rem) 67vw, 52rem`;
  return index % 4 === 0 || index % 4 === 3
    ? `${mobile}, (max-width: 80rem) 58vw, 44rem`
    : `${mobile}, (max-width: 80rem) 42vw, 32rem`;
}

function firstSentence(description: string) {
  return (description.match(/^.*?[。！？]/s)?.[0] ?? description).trim();
}

function visibleNumber(item: SpaceItem, index: number, total: number, category: Category) {
  const roomNumber = category === "rooms" ? item.label.match(/\b\d{3}\b/)?.[0] : null;
  return roomNumber ?? `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
}

function thumbnailLabel(item: SpaceItem, index: number, category: Category) {
  return category === "rooms"
    ? item.label.match(/\b\d{3}\b/)?.[0] ?? item.label
    : String(index + 1).padStart(2, "0");
}

export default function SpacesExplorer({ title, rooms, sharedSpaces }: Props) {
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [category, setCategory] = useState<Category>("rooms");
  const [roomIndex, setRoomIndex] = useState(0);
  const [sharedIndex, setSharedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [selectionError, setSelectionError] = useState(false);
  const [imageRetries, setImageRetries] = useState<Record<string, number>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialLoading, setDialogInitialLoading] = useState(false);
  const [dialogImageError, setDialogImageError] = useState(false);
  const [dialogPhotoIndex, setDialogPhotoIndex] = useState(0);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogSelectionError, setDialogSelectionError] = useState(false);
  const requestId = useRef(0);
  const dialogRequestId = useRef(0);
  const mainImageRef = useRef<HTMLImageElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const openDialogRef = useRef<HTMLButtonElement | null>(null);
  const lastDialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const gallerySceneRef = useRef<HTMLDivElement | null>(null);
  const galleryRef = useRef<HTMLDivElement | null>(null);
  const previousOverflowRef = useRef<{ html: string; body: string } | null>(null);
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const currentItem = category === "rooms" ? (rooms[roomIndex] ?? rooms[0]) : (sharedSpaces[sharedIndex] ?? sharedSpaces[0]);
  const selectedId = currentItem?.id;
  const imageRetry = currentItem ? (imageRetries[currentItem.media.assetId] ?? 0) : 0;

  useEffect(() => {
    const image = mainImageRef.current;
    if (image?.complete && image.naturalWidth === 0) setImageError(true);
  }, [selectedId, imageRetry]);

  useEffect(() => () => {
    const previous = previousOverflowRef.current;
    if (!previous) return;
    document.documentElement.style.overflow = previous.html;
    document.body.style.overflow = previous.body;
  }, []);

  useEffect(() => {
    const root = galleryRef.current;
    const scene = gallerySceneRef.current;
    if (!root) return;
    let active = true;
    let media: ReturnType<typeof import("gsap").gsap.matchMedia> | undefined;
    void Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([gsapModule, triggerModule]) => {
      if (!active) return;
      const gsap = gsapModule.gsap;
      const ScrollTrigger = triggerModule.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);
      media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", (context) => {
        const cleanups: Array<() => void> = [];
        const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
        root.querySelectorAll<HTMLElement>(".spaces-gallery-item").forEach((button) => {
          gsap.fromTo(button, { opacity: 0, y: 24 }, {
            opacity: 1,
            y: 0,
            duration: 0.6,
            ease: "power2.out",
            scrollTrigger: { trigger: button, start: "top 88%", once: true },
          });
          const frame = button.querySelector<HTMLElement>(".spaces-gallery-frame");
          if (!frame) return;
          const updateDepth = () => {
            const lifted = (finePointer.matches && button.matches(":hover")) || button.matches(":focus-visible");
            context.add(() => {
              gsap.to(frame, {
                y: lifted ? -5 : 0,
                z: lifted ? 10 : 0,
                rotationX: lifted ? 0.8 : 0,
                rotationY: lifted ? -0.8 : 0,
                scale: lifted ? 1.006 : 1,
                duration: 0.35,
                ease: "power2.out",
                overwrite: "auto",
              });
            });
          };
          for (const eventName of ["pointerenter", "pointerleave", "focus", "blur"]) {
            button.addEventListener(eventName, updateDepth);
            cleanups.push(() => button.removeEventListener(eventName, updateDepth));
          }
        });
        return () => cleanups.forEach((cleanup) => cleanup());
      }, root);
      if (scene) {
        media.add("(min-width: 48.0625rem) and (prefers-reduced-motion: no-preference)", () => {
          const ambient = scene.querySelector<HTMLElement>(".spaces-gallery-ambient");
          if (!ambient) return;
          gsap.fromTo(ambient, { y: -12 }, {
            y: 12,
            ease: "none",
            scrollTrigger: {
              trigger: scene,
              start: "top bottom",
              end: "bottom top",
              scrub: 0.8,
            },
          });
        }, scene);
      }
      ScrollTrigger.refresh();
    }).catch(() => { media?.revert(); });
    return () => {
      active = false;
      media?.revert();
    };
  }, [selectedId]);

  if (rooms.length === 0 || sharedSpaces.length === 0) return null;

  const items = category === "rooms" ? rooms : sharedSpaces;
  const selectedIndex = category === "rooms" ? roomIndex : sharedIndex;
  const selected = items[selectedIndex] ?? items[0];
  const previousIndex = (selectedIndex - 1 + items.length) % items.length;
  const nextIndex = (selectedIndex + 1) % items.length;
  const currentDialogPhoto = selected.gallery[dialogPhotoIndex] ?? selected.gallery[0];
  const previousPhotoIndex = (dialogPhotoIndex - 1 + selected.gallery.length) % selected.gallery.length;
  const nextPhotoIndex = (dialogPhotoIndex + 1) % selected.gallery.length;
  const headingId = `spaces-${instanceId}-heading`;

  async function select(nextCategory: Category, nextIndex: number): Promise<boolean> {
    const nextItems = nextCategory === "rooms" ? rooms : sharedSpaces;
    const next = nextItems[nextIndex];
    if (!next) return false;
    const pending = ++requestId.current;
    if (nextCategory === category && nextIndex === selectedIndex) {
      setLoading(false);
      setSelectionError(false);
      return true;
    }

    setLoading(true);
    setSelectionError(false);

    const image = new Image();
    image.sizes = mainImageSizes;
    const retry = imageRetries[next.media.assetId] ?? 0;
    image.srcset = imageSrcSet(next, retry);
    image.src = stageImageUrl(next.media.small, retry);

    try {
      await image.decode();
    } catch {
      if (pending === requestId.current) {
        setLoading(false);
        setSelectionError(true);
      }
      return false;
    }

    if (pending !== requestId.current) return false;
    if (nextCategory === "rooms") setRoomIndex(nextIndex);
    else setSharedIndex(nextIndex);
    setCategory(nextCategory);
    setImageError(false);
    setDialogImageError(false);
    dialogRequestId.current += 1;
    setDialogPhotoIndex(0);
    setDialogLoading(false);
    setDialogSelectionError(false);
    setLoading(false);
    requestAnimationFrame(() => {
      const button = thumbnailRefs.current[nextIndex];
      const track = button?.parentElement;
      if (!button || !track) return;
      const item = button.getBoundingClientRect();
      const visible = track.getBoundingClientRect();
      if (item.left < visible.left) track.scrollLeft -= visible.left - item.left;
      else if (item.right > visible.right) track.scrollLeft += item.right - visible.right;
    });
    return true;
  }

  function openFullPhoto(index: number, trigger: HTMLButtonElement) {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (!selected.gallery[index]) return;
    lastDialogTriggerRef.current = trigger;
    dialogRequestId.current += 1;
    setDialogPhotoIndex(index);
    setDialogInitialLoading(true);
    setDialogLoading(false);
    setDialogSelectionError(false);
    setDialogImageError(false);
    setSelectionError(false);
    dialog.showModal();
    previousOverflowRef.current = {
      html: document.documentElement.style.overflow,
      body: document.body.style.overflow,
    };
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    setDialogOpen(true);
  }

  function closeFullPhoto() {
    dialogRef.current?.close();
  }

  function onFullPhotoClosed() {
    const closeRequest = ++dialogRequestId.current;
    const previous = previousOverflowRef.current;
    if (previous) {
      document.documentElement.style.overflow = previous.html;
      document.body.style.overflow = previous.body;
      previousOverflowRef.current = null;
    }
    setDialogOpen(false);
    setDialogInitialLoading(false);
    setDialogPhotoIndex(0);
    setDialogLoading(false);
    setDialogSelectionError(false);
    setDialogImageError(false);
    const isVisibleButton = (button: HTMLButtonElement | null | undefined): button is HTMLButtonElement => {
      if (!button?.isConnected || button.disabled || button.closest("[hidden], [inert]")) return false;
      const style = getComputedStyle(button);
      return style.display !== "none" && style.visibility === "visible"
        && Number(style.opacity) > 0 && button.getClientRects().length > 0;
    };
    requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog?.isConnected || dialog.open || closeRequest !== dialogRequestId.current) return;
      // Read geometry after native dialog and responsive scroll cleanup settle.
      const headerBottom = Math.max(0, document.querySelector<HTMLElement>("[data-site-header]")?.getBoundingClientRect().bottom ?? 0);
      const isInViewport = (button: HTMLButtonElement | null | undefined): button is HTMLButtonElement => {
        if (!isVisibleButton(button)) return false;
        const rect = button.getBoundingClientRect();
        return Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, headerBottom) >= Math.min(44, rect.height)
          && Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0) >= Math.min(44, rect.width);
      };
      const candidates = [
        lastDialogTriggerRef.current,
        thumbnailRefs.current[selectedIndex],
        ...Array.from(galleryRef.current?.querySelectorAll<HTMLButtonElement>(".spaces-gallery-item") ?? []),
        openDialogRef.current,
      ];
      const trigger = candidates.find(isInViewport) ?? candidates.find(isVisibleButton);
      // Preserve a visible landing point. Only off-screen controls may scroll
      // naturally, including through the existing ScrollSmoother focus handler.
      trigger?.focus({ preventScroll: isInViewport(trigger) });
    });
  }

  async function selectDialogPhoto(next: number) {
    const photo = selected.gallery[next];
    if (!photo || next === dialogPhotoIndex) return;
    const pending = ++dialogRequestId.current;
    setDialogLoading(true);
    setDialogSelectionError(false);
    const image = new Image();
    image.sizes = "100vw";
    image.srcset = gallerySrcSet(photo);
    image.src = photo.variants[0].url;
    try {
      await image.decode();
    } catch {
      if (pending === dialogRequestId.current) {
        setDialogLoading(false);
        setDialogSelectionError(true);
      }
      return;
    }
    if (pending !== dialogRequestId.current) return;
    setDialogPhotoIndex(next);
    setDialogImageError(false);
    setDialogLoading(false);
  }

  function onThumbnailKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % items.length; break;
      case "ArrowLeft": next = (index - 1 + items.length) % items.length; break;
      case "Home": next = 0; break;
      case "End": next = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    void select(category, next).then((ready) => {
      if (ready) thumbnailRefs.current[next]?.focus({ preventScroll: true });
    });
  }

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const horizontal = touch.clientX - start.x;
    const vertical = touch.clientY - start.y;
    if (Math.abs(horizontal) < 55 || Math.abs(horizontal) < Math.abs(vertical) * 1.3) return;
    void select(category, horizontal < 0 ? nextIndex : previousIndex);
  }

  return (
    <section className="spaces-immersive" aria-labelledby="spaces-heading" aria-busy={loading}>
      <div className="spaces-stage">
        <div
          className="spaces-stage-media"
          data-space-id={selected.id}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <img
            key={`${selected.id}-${imageRetry}`}
            ref={mainImageRef}
            src={stageImageUrl(selected.media.small, imageRetry)}
            srcSet={imageSrcSet(selected, imageRetry)}
            sizes={mainImageSizes}
            alt={selected.imageAlt}
            onError={(event) => { if (event.currentTarget === mainImageRef.current) setImageError(true); }}
            onLoad={(event) => { if (event.currentTarget === mainImageRef.current) setImageError(false); }}
            loading="eager"
            decoding="async"
            width="1920"
            height="1280"
          />
        </div>
        <div className="spaces-stage-shade" aria-hidden="true" />
        <div className="spaces-stage-top">
          <h1 id="spaces-heading">{title}</h1>
          <div className="spaces-categories" role="group" aria-label="空間分類">
            <button type="button" aria-pressed={category === "rooms"} onClick={() => void select("rooms", roomIndex)}>客房空間</button>
            <span aria-hidden="true">│</span>
            <button type="button" aria-pressed={category === "shared-spaces"} onClick={() => void select("shared-spaces", sharedIndex)}>公共空間</button>
          </div>
        </div>
        <div className="spaces-stage-bottom">
          <div className="spaces-stage-copy">
            <p className="spaces-current-number">{visibleNumber(selected, selectedIndex, items.length, category)}</p>
            <h2 id={headingId} aria-live="polite">{selected.panelHeading}</h2>
            <p className="spaces-current-excerpt">{firstSentence(selected.description)}</p>
            {imageError ? (
              <p className="spaces-image-error" role="alert">
                目前照片無法載入。
                <button type="button" onClick={() => {
                  requestId.current += 1;
                  setLoading(false);
                  setSelectionError(false);
                  setImageError(false);
                  setImageRetries((previous) => ({
                    ...previous,
                    [selected.media.assetId]: (previous[selected.media.assetId] ?? 0) + 1,
                  }));
                }}>重新載入照片</button>
              </p>
            ) : null}
            {selectionError ? <p className="spaces-image-error" role="alert">此照片載入失敗，請再選一次。</p> : null}
          </div>
          <div className="spaces-arrows" role="group" aria-label="切換空間">
            <button type="button" aria-label={`上一個空間：${items[previousIndex].label}`} onClick={() => void select(category, previousIndex)}>
              <svg className="spaces-arrow-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" aria-label={`下一個空間：${items[nextIndex].label}`} onClick={() => void select(category, nextIndex)}>
              <svg className="spaces-arrow-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <button ref={openDialogRef} className="spaces-expand-button" type="button" aria-label="查看完整照片" onClick={(event) => openFullPhoto(0, event.currentTarget)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        className="spaces-photo-dialog"
        aria-label={`完整照片：${selected.label}，第 ${dialogPhotoIndex + 1} 張`}
        aria-modal="true"
        onClose={onFullPhotoClosed}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            void selectDialogPhoto(event.key === "ArrowLeft" ? previousPhotoIndex : nextPhotoIndex);
          }
        }}
      >
        <div className="spaces-photo-dialog-content">
          <button className="spaces-photo-close" type="button" aria-label="關閉完整照片" onClick={closeFullPhoto}>×</button>
          {dialogOpen && currentDialogPhoto && !dialogImageError ? (
            <img
              key={`${selected.id}-${currentDialogPhoto.assetId}`}
              src={currentDialogPhoto.variants[0].url}
              srcSet={gallerySrcSet(currentDialogPhoto)}
              sizes="100vw"
              alt={currentDialogPhoto.alt}
              width={currentDialogPhoto.width}
              height={currentDialogPhoto.height}
              decoding="async"
              onLoad={(event) => {
                const dialog = dialogRef.current;
                if (dialog?.open && event.currentTarget === dialog.querySelector("img")) {
                  setDialogInitialLoading(false);
                }
              }}
              onError={(event) => {
                const dialog = dialogRef.current;
                if (dialog?.open && event.currentTarget === dialog.querySelector("img")) {
                  setDialogInitialLoading(false);
                  setDialogImageError(true);
                }
              }}
            />
          ) : null}
          {dialogInitialLoading || dialogLoading ? (
            <p className="spaces-photo-dialog-loading" role="status">照片載入中…</p>
          ) : dialogSelectionError ? (
            <p className="spaces-photo-dialog-status" role="alert">
              {dialogImageError ? "此照片載入失敗，請切換其他照片或關閉視窗。" : "此照片載入失敗，仍顯示目前照片。"}
            </p>
          ) : dialogImageError ? (
            <p className="spaces-photo-dialog-status" role="alert">照片無法載入，請切換其他照片或關閉視窗。</p>
          ) : null}
          <button className="spaces-photo-step spaces-photo-step--previous" type="button" aria-label={`上一張照片：${selected.gallery[previousPhotoIndex].alt}`} onClick={() => void selectDialogPhoto(previousPhotoIndex)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="spaces-photo-step spaces-photo-step--next" type="button" aria-label={`下一張照片：${selected.gallery[nextPhotoIndex].alt}`} onClick={() => void selectDialogPhoto(nextPhotoIndex)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </dialog>

      <div className="spaces-bottom-panel">
        <div className="spaces-thumbnails" role="group" aria-label={category === "rooms" ? "客房選擇" : "公共空間選擇"}>
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => { thumbnailRefs.current[index] = element; }}
              type="button"
              className="spaces-thumbnail"
              aria-label={item.label}
              aria-pressed={index === selectedIndex}
              onClick={() => void select(category, index)}
              onKeyDown={(event) => onThumbnailKeyDown(event, index)}
            >
              <img src={item.media.small} alt="" width="640" height="426" loading={index < 2 ? "eager" : "lazy"} decoding="async" />
              <span>{thumbnailLabel(item, index, category)}</span>
            </button>
          ))}
        </div>
        <details className="spaces-description" key={`${category}-${selected.id}`}>
          <summary>完整介紹</summary>
          <p>{selected.description}</p>
        </details>
        <p className="spaces-description-copy">{selected.description}</p>
        {loading ? <p className="spaces-status" role="status">照片載入中…</p> : null}
      </div>

      <div ref={gallerySceneRef} className="spaces-gallery-scene">
        <div className="spaces-gallery-ambient" aria-hidden="true" />
        <div ref={galleryRef} key={selected.id} className="spaces-gallery" role="group" aria-labelledby={headingId} data-space-id={selected.id} data-gallery-count={selected.gallery.length}>
          {selected.gallery.map((photo, index) => (
            <button
              key={photo.assetId}
              className="spaces-gallery-item"
              type="button"
              data-gallery-asset-id={photo.assetId}
              aria-label={`查看完整照片：${photo.alt}`}
              onClick={(event) => openFullPhoto(index, event.currentTarget)}
            >
              <span className="spaces-gallery-frame">
                <img
                  src={photo.variants[0].url}
                  srcSet={gallerySrcSet(photo)}
                  sizes={gallerySizes(index, selected.gallery.length)}
                  alt={photo.alt}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  decoding="async"
                />
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
