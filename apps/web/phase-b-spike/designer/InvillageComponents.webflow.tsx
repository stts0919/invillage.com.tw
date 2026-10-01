/**
 * Fixed data contracts for the Designer adapters:
 * - spaces-data.json: { title, rooms, sharedSpaces }, matching SpacesExplorer props.
 * - hero-data.json: { fallback, desktop: { video, poster }, mobileLandscape: { video, poster } }.
 * Rooms and gallery membership stay in the generated data module; they are not CMS props.
 */
import { useEffect, useRef, type ComponentProps } from "react";
import { props } from "@webflow/data-types";
import { declareComponent } from "@webflow/react";

import SpacesExplorer from "../src/components/SpacesExplorer";
import spacesData from "./generated/spaces-data.json";
import heroData from "./generated/hero-data.json";
import "./generated/component.css";

type SpacesExplorerProps = ComponentProps<typeof SpacesExplorer>;
const spaces = spacesData satisfies SpacesExplorerProps;

type HeroAsset = {
  assetId: string;
  url: string;
};

type HeroVideoAsset = HeroAsset & {
  contentType: string;
};

type HeroData = {
  fallback: HeroAsset;
  desktop: {
    video: HeroVideoAsset;
    poster: HeroAsset;
  };
  mobileLandscape: {
    video: HeroVideoAsset;
    poster: HeroAsset;
  };
};

const heroAssets = heroData satisfies HeroData;

type HeroVariant = "自動播放" | "靜態海報";

function InvillageSpaces({ title = spaces.title }: { title?: string }) {
  return (
    <div className="spaces-page">
      <SpacesExplorer
        title={title}
        rooms={spaces.rooms}
        sharedSpaces={spaces.sharedSpaces}
        renderTitle={false}
      />
    </div>
  );
}

function InvillageHero({ variant = "自動播放" }: { variant?: HeroVariant }) {
  const mediaRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const staticPoster = variant === "靜態海報";

  useEffect(() => {
    if (staticPoster) return;

    const media = mediaRef.current;
    const video = videoRef.current;
    const toggle = toggleRef.current;
    const view = media?.ownerDocument.defaultView;
    if (!media || !video || !toggle || !view) return;

    const reducedMotion = view.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (view.navigator as Navigator & {
      connection?: EventTarget & {
        saveData?: boolean;
        effectiveType?: string;
      };
    }).connection;
    let userPaused = false;

    const setPlaying = (playing: boolean) => {
      media.dataset.state = playing ? "playing" : "static";
      toggle.dataset.playing = String(playing);
      toggle.setAttribute("aria-label", playing ? "暫停影片" : "播放影片");
    };

    const isConstrainedNetwork = () => Boolean(
      connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? ""),
    );

    const tryPlay = async () => {
      if (reducedMotion.matches) {
        video.pause();
        setPlaying(false);
        return;
      }

      try {
        await video.play();
        setPlaying(true);
      } catch {
        userPaused = true;
        setPlaying(false);
      }
    };

    const onToggle = () => {
      if (video.paused) {
        userPaused = false;
        void tryPlay();
      } else {
        userPaused = true;
        video.pause();
        setPlaying(false);
      }
    };

    const onVideoError = () => {
      userPaused = true;
      video.pause();
      setPlaying(false);
    };

    const onVideoPause = () => setPlaying(false);
    const onMotionPreferenceChange = () => {
      if (reducedMotion.matches) {
        video.pause();
        setPlaying(false);
      } else if (!isConstrainedNetwork() && !userPaused) {
        void tryPlay();
      }
    };
    const onConnectionChange = () => {
      if (isConstrainedNetwork()) {
        userPaused = true;
        video.pause();
        setPlaying(false);
      }
    };

    toggle.addEventListener("click", onToggle);
    video.addEventListener("error", onVideoError);
    video.addEventListener("pause", onVideoPause);
    reducedMotion.addEventListener("change", onMotionPreferenceChange);
    connection?.addEventListener("change", onConnectionChange);

    if (isConstrainedNetwork()) setPlaying(false);
    else void tryPlay();

    return () => {
      toggle.removeEventListener("click", onToggle);
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("pause", onVideoPause);
      reducedMotion.removeEventListener("change", onMotionPreferenceChange);
      connection?.removeEventListener("change", onConnectionChange);
    };
  }, [staticPoster]);

  const desktopPoster = heroAssets.desktop.poster.url || heroAssets.fallback.url;
  const mobilePoster = heroAssets.mobileLandscape.poster.url || desktopPoster;

  // The shadow-local root is the containing block for the absolute media/control;
  // it provides the viewport-height stage while native hero copy stays outside.
  return (
    <div
      className="iv1-hero-root"
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        minHeight: "max(42rem, 100svh)",
        overflow: "clip",
        isolation: "isolate",
        background: "var(--iv1-color-forest)",
      }}
    >
      <div
        ref={mediaRef}
        className="hero-media"
        data-hero-media
        data-state={staticPoster ? "static" : "loading"}
      >
        <picture>
          <source srcSet={mobilePoster} media="(max-width: 767px)" />
          <img
            className="hero-poster"
            src={desktopPoster}
            alt=""
            width={1600}
            height={800}
            fetchPriority="high"
          />
        </picture>
        {!staticPoster ? (
          <video
            ref={videoRef}
            className="hero-video"
            muted
            loop
            playsInline
            preload="none"
            poster={desktopPoster}
            aria-hidden="true"
          >
            <source
              src={heroAssets.mobileLandscape.video.url}
              type={heroAssets.mobileLandscape.video.contentType}
              media="(max-width: 767px)"
            />
            <source
              src={heroAssets.desktop.video.url}
              type={heroAssets.desktop.video.contentType}
            />
          </video>
        ) : null}
      </div>
      {!staticPoster ? (
        <button
          ref={toggleRef}
          className="video-control"
          type="button"
          aria-label="播放影片"
          data-playing="false"
          data-video-toggle
        >
          <span className="video-control-icon" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export const InvillageSpacesDefinition = declareComponent(InvillageSpaces, {
  name: "Invillage Spaces",
  description: "公共空間優先的互動空間與客房導覽。相簿內容由固定資料模組管理。",
  group: "Invillage",
  props: {
    title: props.Text({ name: "標題", defaultValue: spaces.title }),
  },
});

export const InvillageHeroDefinition = declareComponent(InvillageHero, {
  name: "Invillage Hero",
  description: "支援桌機與行動版影片／海報的首頁主視覺。",
  group: "Invillage",
  props: {
    variant: props.Variant({
      name: "呈現方式",
      options: ["自動播放", "靜態海報"],
      defaultValue: "自動播放",
    }),
  },
});

export { InvillagePageRuntimeDefinition } from "./InvillagePageRuntime";
