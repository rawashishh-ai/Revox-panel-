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
  const [isMuted, setIsMuted] = useState(false);
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

  // Attempt unmuted autoplay first; if browser blocks unmuted autoplay, fallback to muted autoplay
  useEffect(() => {
    if (parsed.type === 'html5' && videoRef.current && autoPlay && effectiveVideoSrc) {
      const v = videoRef.current;
      v.muted = false;
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsMuted(false);
          })
          .catch(() => {
            v.muted = true;
            setIsMuted(true);
            v.play().catch(() => {});
          });
      }
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

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !videoRef.current.muted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted) {
      videoRef.current.play().catch(() => {});
    }
  };

  const isVerticalVideo =
    (naturalAspect !== null && naturalAspect < 0.92) || Boolean(parsed.isVerticalHint);

  return (
    <div className="relative w-full p-[1px] bg-gradient-to-br from-[#00CFE8]/60 via-[#1B3345] to-[#168BFF]/40 clip-video-frame animate-gp-video">
      <div
        className={`relative w-full overflow-hidden bg-[#0A111B] clip-video-frame select-none flex items-center justify-center ${
          isVerticalVideo ? 'max-h-[34dvh] sm:max-h-[38dvh]' : 'aspect-video max-h-[28dvh] sm:max-h-[32dvh]'
        }`}
        style={
          isVerticalVideo && naturalAspect
            ? { aspectRatio: `${naturalAspect}`, maxHeight: '34dvh' }
            : isVerticalVideo
            ? { aspectRatio: '9 / 16', maxHeight: '34dvh' }
            : { aspectRatio: '16 / 9' }
        }
      >
        {/* Render HTML5 Video for uploaded MP4 / WebM files */}
        {parsed.type === 'html5' && !videoError && effectiveVideoSrc && (
          <div className="relative w-full h-full bg-[#070B12] flex items-center justify-center">
            <video
              ref={videoRef}
              src={effectiveVideoSrc}
              onLoadedMetadata={handleLoadedMetadata}
              className="w-full h-full object-contain bg-[#070B12]"
              controls
              playsInline
              loop
              preload="auto"
              autoPlay={autoPlay}
              onError={handleVideoLoadError}
            />
            {isMuted && (
              <button
                type="button"
                onClick={toggleMute}
                className="absolute top-2.5 right-2.5 z-20 bg-[#101B28]/95 hover:bg-[#152334] border border-[#00CFE8]/50 text-[#F4F7FB] text-[10px] font-tech font-bold uppercase tracking-[0.14em] px-2.5 py-1 flex items-center gap-1.5 shadow-[0_3px_11px_rgba(0,0,0,0.55)] cursor-pointer transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-[#00CFE8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
                <span>UNMUTE</span>
              </button>
            )}
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
            {/* Soft cyan ambient center glow (reduced by ~20%) */}
            <div className="absolute w-44 h-44 rounded-full bg-[#00CFE8]/11 blur-2xl pointer-events-none" />

            {/* Tactical Crosshair & FOV Showcase */}
            <div className="relative z-10 flex flex-col items-center justify-center">
              <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full border border-[#00CFE8]/45 shadow-[0_0_19px_rgba(0,207,232,0.19),inset_0_0_11px_rgba(22,139,255,0.13)] flex items-center justify-center">
                <div className="absolute inset-2 rounded-full border border-dashed border-[#00CFE8]/36 animate-spin" style={{ animationDuration: '14s' }} />

                {/* Left ESP Target Frame */}
                <div className="absolute -left-9 top-3 w-7 h-11 border border-[#00CFE8]/55 bg-[#168BFF]/12 flex flex-col justify-between p-0.5">
                  <div className="w-full h-[1.5px] bg-[#00CFE8]" />
                  <div className="w-2 h-2 border-t border-l border-[#F4F7FB]/55 mx-auto my-auto" />
                </div>

                {/* Center Locked Target Reticle */}
                <div className="relative w-10 h-14 border border-[#00CFE8] bg-[#00CFE8]/12 flex items-center justify-center shadow-[0_0_11px_rgba(0,207,232,0.28)]">
                  <div className="w-3.5 h-3.5 relative flex items-center justify-center">
                    <div className="absolute w-full h-[1.5px] bg-[#F4F7FB]" />
                    <div className="absolute h-full w-[1.5px] bg-[#F4F7FB]" />
                  </div>
                </div>

                {/* Right ESP Target Frame */}
                <div className="absolute -right-9 bottom-3 w-7 h-11 border border-[#00CFE8]/55 bg-[#168BFF]/12 flex flex-col justify-between p-0.5">
                  <div className="w-4/5 h-[1.5px] bg-[#00CFE8]" />
                  <div className="w-2 h-2 border-b border-r border-[#F4F7FB]/55 mx-auto my-auto" />
                </div>
              </div>
            </div>
          </div>
        )}
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

const DEFAULT_FEATURE_POINTS = [
  '100% Anti-Ban Protection & High-Security Bypass',
  'Smooth Aimbot, ESP & Ultra-Low Latency Gameplay',
  'Instant Key Activation with 1-Device Security Lock',
  'Works on All Latest Updates with 24/7 VIP Support'
];

export const IntroVideoScreen: React.FC<IntroVideoScreenProps> = ({
  settings,
  onContinue,
  onBuyKeyOnline
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

  const featurePoints: string[] = (
    Array.isArray(settings.introFeaturePoints) && settings.introFeaturePoints.length > 0
      ? settings.introFeaturePoints
      : Array.isArray(settings.buttonSettings?.introFeaturePoints) &&
        settings.buttonSettings!.introFeaturePoints!.length > 0
      ? settings.buttonSettings!.introFeaturePoints!
      : DEFAULT_FEATURE_POINTS
  )
    .map(p => (typeof p === 'string' ? p.trim() : ''))
    .filter(p => p.length > 0);

  return (
    <div className="relative w-full h-full max-h-[760px] my-auto flex-1 min-h-0 flex flex-col justify-between gap-2 py-0.5 overflow-hidden select-none animate-page-fade">
      {/* Subtle Blue Ambient Lighting Backdrop (reduced by ~20%) */}
      <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 w-64 max-w-full h-40 bg-[radial-gradient(ellipse_at_center,rgba(0,207,232,0.11)_0%,rgba(22,139,255,0.04)_45%,transparent_75%)] blur-xl -z-10" />

      {/* ========================================================
          1. COMPACT PREMIUM HERO SECTION
          ======================================================== */}
      <section className="animate-gp-hero text-center shrink-0">
        {/* Dynamic Website / Panel Name Badge */}
        <div className="inline-flex items-center justify-center gap-2 mb-0.5 max-w-full">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00CFE8] shadow-[0_0_6px_rgba(0,207,232,0.8)] shrink-0" />
          <span className="text-[10px] sm:text-[11px] font-mono-code font-bold tracking-[0.22em] sm:tracking-[0.26em] uppercase text-[#00CFE8] truncate">
            {brandName}
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#00CFE8] shadow-[0_0_6px_rgba(0,207,232,0.8)] shrink-0" />
        </div>

        {/* Main Heading: WITH PANEL GAMEPLAY */}
        <h1 className="font-tech font-black text-[clamp(22px,6.8vw,31px)] leading-[1.03] tracking-[0.06em] sm:tracking-[0.08em] uppercase gp-heading-sweep drop-shadow-[0_3px_14px_rgba(0,207,232,0.18)]">
          WITH PANEL
          <br />
          GAMEPLAY
        </h1>

        {/* Elegant Subtitle */}
        <p className="mt-0.5 text-[9.5px] sm:text-[10.5px] font-mono-code font-semibold tracking-[0.2em] sm:tracking-[0.24em] uppercase text-[#A7B5C5]">
          EXPERIENCE THE GAMEPLAY
        </p>
      </section>

      {/* ========================================================
          2. CINEMATIC VIDEO PLAYER (Main Centerpiece)
          ======================================================== */}
      <section className="w-full shrink min-h-0 flex items-center justify-center">
        <Direct16x9VideoPlayer
          videoUrl={activeVideoUrl}
          logoUrl={settings.logoUrl}
          autoPlay={true}
        />
      </section>

      {/* ========================================================
          3. PANEL FEATURES / WHAT YOU GET SECTION (Admin Editable)
          ======================================================== */}
      {featurePoints.length > 0 && (
        <section className="animate-gp-video w-full shrink-0">
          <div className="relative p-[1px] bg-gradient-to-br from-[#00CFE8]/55 via-[#1B3345] to-[#168BFF]/36 clip-card-br shadow-[0_10px_24px_-10px_rgba(0,0,0,0.72)]">
            <div className="cyber-glass-card backdrop-blur-xl px-3.5 py-2.5 clip-card-br relative overflow-hidden">
              <span className="absolute top-0 left-5 right-5 h-[1px] bg-gradient-to-r from-transparent via-[#00CFE8]/60 to-transparent pointer-events-none" />
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-[#00CFE8]/[0.02] to-white/[0.03] pointer-events-none" />

              <div className="relative z-10 flex items-center justify-between gap-2 mb-1.5 pb-1 border-b border-[#1B3345]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00CFE8] shadow-[0_0_6px_rgba(0,207,232,0.8)] shrink-0" />
                  <span className="text-[10px] font-mono-code font-bold tracking-[0.16em] sm:tracking-[0.2em] uppercase text-[#00CFE8] truncate">
                    PANEL FEATURES · WHAT YOU GET
                  </span>
                </div>
                <span className="text-[9.5px] font-mono-code font-bold tracking-[0.12em] uppercase text-[#A7B5C5] shrink-0">
                  {brandName}
                </span>
              </div>

              <ul className="relative z-10 space-y-1">
                {featurePoints.map((point, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-[11px] sm:text-xs text-[#F4F7FB] leading-snug font-sans min-w-0"
                  >
                    <span className="mt-[1px] w-4 h-4 rounded-[3px] bg-[#101B28] border border-[#00CFE8]/60 flex items-center justify-center text-[#00CFE8] text-[10px] font-bold shrink-0">
                      ✓
                    </span>
                    <span className="flex-1 min-w-0 break-words font-medium text-[#A7B5C5]">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* ========================================================
          4. ACTION BUTTON: CONTINUE
          ======================================================== */}
      <section className="animate-gp-cta w-full shrink-0">
        {/* CONTINUE BUTTON: Primary Cyan-to-Blue Gradient (#00CFE8 -> #168BFF) */}
        <div className="p-[1px] bg-gradient-to-r from-[#00CFE8] via-[#F4F7FB]/70 to-[#168BFF] clip-continue-br shadow-[0_6px_20px_-6px_rgba(0,207,232,0.34)]">
          <button
            type="button"
            onClick={onContinue}
            className="relative w-full py-3 px-6 clip-continue-br cyber-primary-btn hover:brightness-108 active:scale-[0.98] text-[#070B12] font-tech font-black text-[clamp(16px,4.5vw,18px)] tracking-[0.16em] sm:tracking-[0.18em] uppercase cursor-pointer transition-all duration-200 flex items-center justify-center gap-2.5 overflow-hidden group"
          >
            {/* Top-Half Glossy Reflection */}
            <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent pointer-events-none" />
            {/* Continuous Diagonal Mirror Sheen */}
            <span className="absolute inset-0 w-1/3 bg-gradient-to-r from-transparent via-white/36 to-transparent pointer-events-none animate-sheen" />

            <span className="relative z-10 drop-shadow-[0_1px_0_rgba(255,255,255,0.28)]">
              {settings.introVideoButtonText || 'CONTINUE'}
            </span>
            <span className="relative z-10 inline-block animate-gp-arrow text-[18px] leading-none font-black">
              →
            </span>
          </button>
        </div>
      </section>
    </div>
  );
};
