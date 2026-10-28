import React, { useState, useRef, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { SiteSettings, Language } from '../types';

export interface ParsedVideoSource {
  type: 'youtube' | 'gdrive' | 'vimeo' | 'streamable' | 'html5' | 'simulation';
  embedUrl?: string;
  videoUrl?: string;
  firestoreVideoId?: string;
  isVerticalHint?: boolean;
}

const DEFAULT_BUNDLED_VIDEO_URL = '/uploads/gameplay_v12_1792903967616.mp4';
const firestoreVideoBlobCache = new Map<string, string>();
const firestoreVideoInFlight = new Map<string, Promise<string | null>>();

function extractFirestoreVideoId(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('firestore://video/')) {
    return trimmed.slice('firestore://video/'.length).split('?')[0].replace(/\.(mp4|webm|ogg|mov)$/i, '');
  }
  const apiMatch = trimmed.match(/\/api\/public\/video\/([a-zA-Z0-9_-]+)/);
  if (apiMatch && apiMatch[1]) {
    return apiMatch[1];
  }
  const uploadMatch = trimmed.match(/\/uploads\/(gameplay_v[a-zA-Z0-9_-]+)\.(mp4|webm|ogg|mov)/i);
  if (uploadMatch && uploadMatch[1]) {
    return uploadMatch[1];
  }
  return null;
}

async function hydrateVideoBlobUrlFromFirestore(videoId: string): Promise<string | null> {
  if (!videoId) return null;
  const cached = firestoreVideoBlobCache.get(videoId);
  if (cached) return cached;

  const inflight = firestoreVideoInFlight.get(videoId);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const metaSnap = await getDoc(doc(db, 'videoAssets', videoId));
      if (!metaSnap.exists()) return null;
      const meta = metaSnap.data();
      const totalChunks = Number(meta?.totalChunks) || 0;
      const mimeType = typeof meta?.mimeType === 'string' && meta.mimeType ? meta.mimeType : 'video/mp4';
      if (totalChunks <= 0 || totalChunks > 500) return null;

      const byteSlices: BlobPart[] = new Array(totalChunks);
      const BATCH_SIZE = 6;

      for (let i = 0; i < totalChunks; i += BATCH_SIZE) {
        const end = Math.min(i + BATCH_SIZE, totalChunks);
        const batchPromises: Promise<void>[] = [];
        for (let idx = i; idx < end; idx++) {
          batchPromises.push(
            (async () => {
              const cSnap = await getDoc(doc(db, 'videoAssetChunks', `${videoId}_${idx}`));
              if (!cSnap.exists()) {
                throw new Error(`Missing video chunk ${idx}`);
              }
              const b64 = cSnap.data()?.data;
              if (typeof b64 !== 'string') {
                throw new Error(`Invalid video chunk ${idx}`);
              }
              const binaryStr = window.atob(b64);
              const len = binaryStr.length;
              const bytes = new Uint8Array(len);
              for (let j = 0; j < len; j++) {
                bytes[j] = binaryStr.charCodeAt(j);
              }
              byteSlices[idx] = bytes.buffer as ArrayBuffer;
            })()
          );
        }
        await Promise.all(batchPromises);
      }

      const blob = new Blob(byteSlices, { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      firestoreVideoBlobCache.set(videoId, blobUrl);
      return blobUrl;
    } catch (err) {
      console.warn('Firestore video hydration fallback notice:', err);
      return null;
    } finally {
      firestoreVideoInFlight.delete(videoId);
    }
  })();

  firestoreVideoInFlight.set(videoId, task);
  return task;
}

export function resolveVideoPlayerSource(rawUrl?: string): ParsedVideoSource {
  const url = (rawUrl || '').trim();
  if (
    !url ||
    url === 'https://www.youtube.com/' ||
    url === 'https://youtube.com/' ||
    url.startsWith('blob:')
  ) {
    return { type: 'html5', videoUrl: DEFAULT_BUNDLED_VIDEO_URL };
  }

  const fsVideoId = extractFirestoreVideoId(url);
  if (url.startsWith('firestore://video/') && fsVideoId) {
    const cachedBlob = firestoreVideoBlobCache.get(fsVideoId);
    return {
      type: 'html5',
      videoUrl: cachedBlob || `/api/public/video/${fsVideoId}`,
      firestoreVideoId: fsVideoId
    };
  }

  // 1. Direct uploaded file, cloud video endpoint, Firebase Storage URL, data URL, or explicit video extension
  if (
    url.startsWith('/uploads/') ||
    url.startsWith('/api/public/video/') ||
    url.includes('firebasestorage.googleapis.com') ||
    url.startsWith('data:video/') ||
    /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url)
  ) {
    const cachedBlob = fsVideoId ? firestoreVideoBlobCache.get(fsVideoId) : undefined;
    return {
      type: 'html5',
      videoUrl: cachedBlob || url,
      firestoreVideoId: fsVideoId || undefined
    };
  }

  // 2. YouTube (watch?v=, youtu.be/, shorts/, embed/, live/)
  const ytMatch = url.match(
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    const isShorts = /youtube\.com\/shorts\//i.test(url);
    return {
      type: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&controls=1`,
      isVerticalHint: isShorts
    };
  }

  // 3. Google Drive video link (drive.google.com/file/d/ID/view)
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch[1]) {
    return {
      type: 'gdrive',
      embedUrl: `https://drive.google.com/file/d/${driveMatch[1]}/preview`
    };
  }

  // 4. Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch && vimeoMatch[1]) {
    return {
      type: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1&title=0&byline=0&portrait=0`
    };
  }

  // 5. Streamable
  const streamableMatch = url.match(/streamable\.com\/(?:e\/)?([a-zA-Z0-9]+)/);
  if (streamableMatch && streamableMatch[1]) {
    return {
      type: 'streamable',
      embedUrl: `https://streamable.com/e/${streamableMatch[1]}?autoplay=1`
    };
  }

  // Default: treat any other URL as direct HTML5 video source
  return {
    type: 'html5',
    videoUrl: url.startsWith('http') || url.startsWith('/') ? url : `https://${url}`
  };
}


const DEFAULT_FEATURE_POINTS = [
  '100% ANTI BAN',
  '90% DRAG HEADSHOT RATE - LIVE ENEMY LOCATION',
  'MODE MENU ✖ PANEL ✔',
  '10 + HACK FEATURE - 100% MAIN I\'D SAFE'
];

interface Direct16x9VideoPlayerProps {
  videoUrl?: string;
  logoUrl?: string;
  autoPlay?: boolean;
}

export const Direct16x9VideoPlayer: React.FC<Direct16x9VideoPlayerProps> = ({
  videoUrl,
  autoPlay = true
}) => {
  const parsed = resolveVideoPlayerSource(videoUrl);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [resolvedBlobUrl, setResolvedBlobUrl] = useState<string | null>(null);
  const [usingBundledFallback, setUsingBundledFallback] = useState(false);
  const [hydratingCloudVideo, setHydratingCloudVideo] = useState(false);
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null);

  useEffect(() => {
    setVideoError(false);
    setUsingBundledFallback(false);
    setNaturalAspect(null);

    const fsId = parsed.firestoreVideoId;
    if (fsId && firestoreVideoBlobCache.has(fsId)) {
      setResolvedBlobUrl(firestoreVideoBlobCache.get(fsId) || null);
      return;
    }
    setResolvedBlobUrl(null);

    // If URL is firestore://video/*, immediately hydrate from Firestore
    if (videoUrl?.trim().startsWith('firestore://video/') && fsId) {
      let active = true;
      setHydratingCloudVideo(true);
      hydrateVideoBlobUrlFromFirestore(fsId)
        .then(blobUrl => {
          if (!active) return;
          if (blobUrl) {
            setResolvedBlobUrl(blobUrl);
          } else {
            setUsingBundledFallback(true);
          }
        })
        .finally(() => {
          if (active) setHydratingCloudVideo(false);
        });
      return () => {
        active = false;
      };
    }
  }, [videoUrl, parsed.firestoreVideoId]);

  const effectiveVideoSrc =
    resolvedBlobUrl ||
    (usingBundledFallback
      ? DEFAULT_BUNDLED_VIDEO_URL
      : parsed.type === 'html5'
      ? parsed.videoUrl
      : undefined);

  // Start muted autoplay so playback begins immediately on all mobile browsers and displays the UNMUTE button
  useEffect(() => {
    if (parsed.type === 'html5' && videoRef.current && autoPlay && effectiveVideoSrc) {
      const v = videoRef.current;
      v.muted = true;
      setIsMuted(true);
      v.play().catch(() => {});
    }
  }, [parsed.type, effectiveVideoSrc, autoPlay]);

  const handleVideoLoadError = async () => {
    if (hydratingCloudVideo) return;

    // 1. Try hydrating video chunks directly from Firestore (works on Vercel / revoxpanel.site where /api/* is serverless/static)
    if (parsed.firestoreVideoId && !resolvedBlobUrl) {
      setHydratingCloudVideo(true);
      const blobUrl = await hydrateVideoBlobUrlFromFirestore(parsed.firestoreVideoId);
      setHydratingCloudVideo(false);
      if (blobUrl) {
        setResolvedBlobUrl(blobUrl);
        setVideoError(false);
        return;
      }
    }

    // 2. Fall back to the bundled static gameplay MP4 in /uploads/ so the video player never shows a broken placeholder
    if (!usingBundledFallback && effectiveVideoSrc !== DEFAULT_BUNDLED_VIDEO_URL) {
      setUsingBundledFallback(true);
      setVideoError(false);
      return;
    }

    setVideoError(true);
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    const { videoWidth, videoHeight } = videoRef.current;
    if (videoWidth > 0 && videoHeight > 0) {
      setNaturalAspect(videoWidth / videoHeight);
    }
  };

  const toggleMute = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!videoRef.current) return;
    const nextMuted = !videoRef.current.muted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    }
  };

  const isVerticalVideo =
    (naturalAspect !== null && naturalAspect < 0.92) || Boolean(parsed.isVerticalHint);

  return (
    <div className="relative w-full animate-gp-video">
      {/* Ambient Cyber Cyan Back-Glow */}
      <div className="absolute -inset-1.5 bg-gradient-to-r from-[#00CFE8]/25 via-[#168BFF]/18 to-[#00CFE8]/25 blur-lg pointer-events-none -z-10" />

      {/* Video Viewport Frame with Chamfered Top-Right & Bottom-Left Corners */}
      <div className="relative w-full p-[1.5px] bg-gradient-to-br from-[#00CFE8] via-[#00CFE8]/70 to-[#00CFE8]/90 clip-video-frame shadow-[0_0_26px_rgba(0,207,232,0.22),0_10px_28px_-8px_rgba(0,0,0,0.85)]">
        <div
          className={`relative w-full overflow-hidden bg-[#070B12] clip-video-frame select-none flex items-center justify-center mx-auto ${
            isVerticalVideo ? 'max-h-[260px] sm:max-h-[290px]' : 'aspect-video'
          }`}
          style={
            isVerticalVideo && naturalAspect
              ? { aspectRatio: `${naturalAspect}`, maxHeight: '260px' }
              : isVerticalVideo
              ? { aspectRatio: '9 / 16', maxHeight: '260px' }
              : { aspectRatio: '16 / 9' }
          }
        >
          {/* Render HTML5 Video for uploaded MP4 / WebM files */}
          {parsed.type === 'html5' && !videoError && effectiveVideoSrc && (
            <div
              onClick={toggleMute}
              className="relative w-full h-full bg-[#070B12] flex items-center justify-center cursor-pointer"
            >
              <video
                ref={videoRef}
                src={effectiveVideoSrc}
                onLoadedMetadata={handleLoadedMetadata}
                className={`w-full h-full bg-[#070B12] ${
                  isVerticalVideo ? 'object-contain' : 'object-cover'
                }`}
                playsInline
                loop
                muted={isMuted}
                preload="auto"
                autoPlay={autoPlay}
                onError={handleVideoLoadError}
              />

              {/* Top-Right UNMUTE / MUTE Button matching screenshot */}
              <button
                type="button"
                onClick={toggleMute}
                className="absolute top-2.5 right-2.5 z-20 bg-[#060B13]/90 hover:bg-[#0D1826] border border-[#00CFE8]/80 text-[#F4F7FB] text-[11px] font-mono-code font-bold uppercase tracking-[0.16em] px-3 py-1.5 rounded-[2px] flex items-center gap-2 shadow-[0_0_15px_rgba(0,207,232,0.28)] cursor-pointer transition-all active:scale-95"
              >
                {isMuted ? (
                  <>
                    <svg
                      className="w-3.5 h-3.5 text-[#00CFE8] shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <line x1="23" y1="9" x2="17" y2="15" />
                      <line x1="17" y1="9" x2="23" y2="15" />
                    </svg>
                    <span>UNMUTE</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-3.5 h-3.5 text-[#00CFE8] shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                    <span>MUTE</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Render Compatible Responsive Embed (YouTube / Google Drive / Vimeo / Streamable) */}
          {(parsed.type === 'youtube' ||
            parsed.type === 'gdrive' ||
            parsed.type === 'vimeo' ||
            parsed.type === 'streamable') &&
            parsed.embedUrl && (
              <iframe
                src={parsed.embedUrl}
                title="With Panel Gameplay"
                className="w-full h-full border-0 bg-[#070B12]"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            )}

          {/* Built-in Clean Cinematic Gameplay Viewport when no custom video is uploaded yet */}
          {(parsed.type === 'simulation' || videoError) && (
            <div className="relative w-full h-full bg-gradient-to-br from-[#070B12] via-[#0A111B] to-[#0D1622] flex items-center justify-center overflow-hidden">
              <div className="absolute w-40 h-40 rounded-full bg-[#00CFE8]/11 blur-2xl pointer-events-none" />
              <div className="relative z-10 flex flex-col items-center justify-center">
                <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full border border-[#00CFE8]/45 shadow-[0_0_19px_rgba(0,207,232,0.19),inset_0_0_11px_rgba(22,139,255,0.13)] flex items-center justify-center">
                  <div className="absolute inset-2 rounded-full border border-dashed border-[#00CFE8]/36 animate-spin" style={{ animationDuration: '14s' }} />
                  <div className="relative w-9 h-12 border border-[#00CFE8] bg-[#00CFE8]/12 flex items-center justify-center shadow-[0_0_11px_rgba(0,207,232,0.28)]">
                    <div className="w-3 h-3 relative flex items-center justify-center">
                      <div className="absolute w-full h-[1.5px] bg-[#F4F7FB]" />
                      <div className="absolute h-full w-[1.5px] bg-[#F4F7FB]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface IntroVideoScreenProps {
  settings: SiteSettings;
  lang: Language;
  onContinue: () => void;
  onBuyKeyOnline?: () => void;
}

export const IntroVideoScreen: React.FC<IntroVideoScreenProps> = ({
  settings,
  onContinue
}) => {
  // Prefer introVideoUrl if configured, otherwise fallback to setupVideoUrl if it's a valid custom video URL
  const activeVideoUrl =
    settings.introVideoUrl && settings.introVideoUrl.trim().length > 0
      ? settings.introVideoUrl
      : settings.setupVideoUrl &&
        settings.setupVideoUrl !== 'https://www.youtube.com/' &&
        settings.setupVideoUrl !== 'https://youtube.com/'
      ? settings.setupVideoUrl
      : '';

  const brandName = (
    settings.panelName ||
    settings.websiteTitle ||
    settings.announcementTo ||
    'REVOX PANEL'
  ).trim();

  const rawFeaturePoints =
    Array.isArray(settings.introFeaturePoints) && settings.introFeaturePoints.length > 0
      ? settings.introFeaturePoints
      : Array.isArray(settings.buttonSettings?.introFeaturePoints) &&
        settings.buttonSettings!.introFeaturePoints!.length > 0
      ? settings.buttonSettings!.introFeaturePoints!
      : DEFAULT_FEATURE_POINTS;

  const featurePoints: string[] = rawFeaturePoints
    .map(p => (typeof p === 'string' ? p.trim() : ''))
    .filter(p => p.length > 0);

  return (
    <div className="relative w-full flex-1 flex flex-col justify-between py-1 select-none animate-page-fade">
      {/* Subtle Blue Ambient Lighting Backdrop */}
      <div className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 w-72 max-w-full h-36 bg-[radial-gradient(ellipse_at_center,rgba(0,207,232,0.15)_0%,rgba(22,139,255,0.05)_48%,transparent_75%)] blur-xl -z-10" />

      {/* Top Content Stack: Hero + Video + Features Card */}
      <div className="w-full flex flex-col gap-3.5">
        {/* ========================================================
            1. HERO HEADER SECTION
            ======================================================== */}
        <section className="animate-gp-hero text-center pt-1">
          {/* Dynamic Website / Panel Name Badge */}
          <div className="inline-flex items-center justify-center gap-2.5 mb-1.5 max-w-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00CFE8] shadow-[0_0_8px_#00CFE8] shrink-0" />
            <span className="text-[11px] font-mono-code font-bold tracking-[0.26em] uppercase text-[#00CFE8] truncate">
              {brandName}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#00CFE8] shadow-[0_0_8px_#00CFE8] shrink-0" />
          </div>

          {/* Main Heading: WITH PANEL GAMEPLAY */}
          <h1 className="font-tech font-black text-[clamp(26px,7.4vw,32px)] leading-[1.05] tracking-[0.06em] uppercase text-[#F4F7FB] drop-shadow-[0_2px_14px_rgba(0,207,232,0.2)]">
            WITH PANEL
            <br />
            GAMEPLAY
          </h1>

          {/* Subtitle */}
          <p className="mt-1.5 text-[10.5px] font-mono-code font-medium tracking-[0.26em] uppercase text-[#A7B5C5]">
            EXPERIENCE THE GAMEPLAY
          </p>
        </section>

        {/* ========================================================
            2. CINEMATIC VIDEO PLAYER (Centerpiece)
            ======================================================== */}
        <section className="w-full">
          <Direct16x9VideoPlayer
            videoUrl={activeVideoUrl}
            logoUrl={settings.logoUrl}
            autoPlay={true}
          />
        </section>

        {/* ========================================================
            3. PANEL FEATURES / WHAT YOU GET SECTION
            ======================================================== */}
        {featurePoints.length > 0 && (
          <section className="animate-gp-video w-full relative">
            {/* Ambient Cyan Underglow matching screenshot */}
            <div className="pointer-events-none absolute -inset-x-1 -bottom-3 h-12 bg-[radial-gradient(ellipse_at_center,rgba(0,207,232,0.28)_0%,rgba(22,139,255,0.10)_55%,transparent_80%)] blur-md -z-10" />

            <div className="relative p-[1.2px] bg-gradient-to-br from-[#00CFE8] via-[#00CFE8]/65 to-[#00CFE8] clip-card-br shadow-[0_12px_32px_-8px_rgba(0,207,232,0.25)]">
              <div className="bg-gradient-to-b from-[#0E1927] to-[#0A131F] px-3.5 py-3 clip-card-br relative overflow-hidden">
                {/* Diagonal corner accent line in bottom-right */}
                <span className="pointer-events-none absolute bottom-[5px] right-[-14px] w-9 h-[1.5px] bg-[#00CFE8]/80 -rotate-45" />

                {/* Card Header */}
                <div className="relative z-10 flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-[#183047]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00CFE8] shadow-[0_0_8px_#00CFE8] shrink-0" />
                    <span className="text-[10.5px] font-mono-code font-bold tracking-[0.17em] uppercase text-[#00CFE8] truncate">
                      PANEL FEATURES &nbsp;·&nbsp; WHAT YOU GET
                    </span>
                  </div>
                  <span className="text-[10.5px] font-mono-code font-semibold tracking-[0.16em] uppercase text-[#D5E1EC] shrink-0">
                    {brandName}
                  </span>
                </div>

                {/* Feature Points with glowing cyan check badges */}
                <ul className="relative z-10 space-y-2.5">
                  {featurePoints.map((point, idx) => (
                    <li
                      key={idx}
                      className="flex items-center gap-3 text-[12px] text-[#F4F7FB] leading-snug font-tech min-w-0"
                    >
                      <span className="w-[18px] h-[18px] rounded-[3.5px] bg-[#0B2135] border border-[#00CFE8] flex items-center justify-center text-[#F4F7FB] shrink-0 shadow-[0_0_8px_rgba(0,207,232,0.28)]">
                        <svg
                          className="w-3 h-3 text-[#F4F7FB]"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <span className="flex-1 min-w-0 break-words font-bold tracking-[0.04em] text-[#F4F7FB] uppercase">
                        {point}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ========================================================
          4. ACTION BUTTON: CONTINUE (Bottom Anchored with Cyan Glow)
          ======================================================== */}
      <section className="animate-gp-cta w-full mt-auto pt-3 pb-1.5 relative">
        {/* Strong Cyan Ambient Glow around button */}
        <div className="pointer-events-none absolute inset-x-2 -inset-y-1 bg-gradient-to-r from-[#00E5FF]/35 via-[#38B6FF]/30 to-[#168BFF]/35 blur-xl -z-10" />

        <div className="relative p-[1.2px] bg-gradient-to-r from-[#7AF4FF] via-[#D4FCFF] to-[#5CA9FF] clip-continue-br shadow-[0_0_28px_rgba(0,207,232,0.42),0_4px_16px_rgba(22,139,255,0.32)]">
          <button
            type="button"
            onClick={onContinue}
            className="relative w-full py-3.5 px-6 clip-continue-br bg-gradient-to-r from-[#00E1FF] via-[#5EE2FF] to-[#3B97FF] hover:brightness-105 active:scale-[0.99] text-[#050A12] font-tech font-black text-[17px] tracking-[0.22em] uppercase cursor-pointer transition-all duration-200 flex items-center justify-center gap-3 overflow-hidden group shadow-[inset_0_1px_1px_rgba(255,255,255,0.65)]"
          >
            {/* Top-Half Glossy Glass Reflection */}
            <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent pointer-events-none" />

            {/* Continuous Diagonal Super Shine Sweeping Across */}
            <span className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent pointer-events-none animate-getkey-super-shine" />

            <span className="relative z-10 font-black text-[#050A12]">
              {settings.introVideoButtonText || 'CONTINUE'}
            </span>
            <span className="relative z-10 inline-block animate-gp-arrow text-[18px] leading-none font-black text-[#050A12]">
              →
            </span>
          </button>
        </div>
      </section>
    </div>
  );
};
