import React, { useState, useRef, useEffect } from 'react';
import { SiteSettings, Language } from '../types';

export interface ParsedVideoSource {
  type: 'youtube' | 'gdrive' | 'vimeo' | 'streamable' | 'html5' | 'simulation';
  embedUrl?: string;
  videoUrl?: string;
  isVerticalHint?: boolean;
}

export function resolveVideoPlayerSource(rawUrl?: string): ParsedVideoSource {
  const url = (rawUrl || '').trim();
  if (
    !url ||
    url === 'https://www.youtube.com/' ||
    url === 'https://youtube.com/' ||
    url.startsWith('blob:')
  ) {
    return { type: 'simulation' };
  }

  // 1. Direct uploaded file, cloud video endpoint, Firebase Storage URL, data URL, or explicit video extension
  if (
    url.startsWith('/uploads/') ||
    url.startsWith('/api/public/video/') ||
    url.includes('firebasestorage.googleapis.com') ||
    url.startsWith('data:video/') ||
    /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url)
  ) {
    return { type: 'html5', videoUrl: url };
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
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null);

  useEffect(() => {
    setVideoError(false);
    setNaturalAspect(null);
  }, [videoUrl]);

  // Attempt unmuted autoplay first; if browser blocks unmuted autoplay, fallback to muted autoplay
  useEffect(() => {
    if (parsed.type === 'html5' && videoRef.current && autoPlay) {
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
  }, [parsed.type, parsed.videoUrl, autoPlay]);

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
    <div className="relative w-full p-[1px] bg-gradient-to-br from-[#B84DFF]/85 via-[#A020F0]/60 to-[#A020F0]/25 clip-video-frame animate-gp-video">
      <div
        className={`relative w-full overflow-hidden bg-[#100A18] clip-video-frame select-none flex items-center justify-center ${
          isVerticalVideo ? 'max-h-[48dvh] sm:max-h-[52dvh]' : 'aspect-video'
        }`}
        style={
          isVerticalVideo && naturalAspect
            ? { aspectRatio: `${naturalAspect}`, maxHeight: '48dvh' }
            : isVerticalVideo
            ? { aspectRatio: '9 / 16', maxHeight: '48dvh' }
            : { aspectRatio: '16 / 9' }
        }
      >
        {/* Render HTML5 Video for uploaded MP4 / WebM files */}
        {parsed.type === 'html5' && !videoError && parsed.videoUrl && (
          <div className="relative w-full h-full bg-[#050308] flex items-center justify-center">
            <video
              ref={videoRef}
              src={parsed.videoUrl}
              onLoadedMetadata={handleLoadedMetadata}
              className="w-full h-full object-contain bg-[#050308]"
              controls
              playsInline
              loop
              preload="metadata"
              autoPlay={autoPlay}
              onError={() => setVideoError(true)}
            />
            {isMuted && (
              <button
                type="button"
                onClick={toggleMute}
                className="absolute top-2.5 right-2.5 z-20 bg-[#100A18]/90 hover:bg-[#A020F0] border border-[#B84DFF]/60 text-[#FFFFFF] text-[10px] font-tech font-bold uppercase tracking-[0.14em] px-2.5 py-1 flex items-center gap-1.5 shadow-lg cursor-pointer transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-[#B84DFF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
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
              className="w-full h-full border-0 bg-[#050308]"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          )}

        {/* Built-in Clean Cinematic Gameplay Viewport when no custom video is uploaded yet */}
        {(parsed.type === 'simulation' || videoError) && (
          <div className="relative w-full h-full bg-gradient-to-br from-[#050308] via-[#100A18] to-[#08040F] flex items-center justify-center overflow-hidden">
            {/* Subtle cyber perspective grid */}
            <div
              className="absolute inset-0 opacity-20 pointer-events-none"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(184, 77, 255, 0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(184, 77, 255, 0.22) 1px, transparent 1px)',
                backgroundSize: '26px 26px'
              }}
            />

            {/* Soft purple ambient center glow */}
            <div className="absolute w-44 h-44 rounded-full bg-[#A020F0]/20 blur-2xl pointer-events-none" />

            {/* Tactical Crosshair & FOV Showcase */}
            <div className="relative z-10 flex flex-col items-center justify-center">
              <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full border border-[#B84DFF]/60 shadow-[0_0_28px_rgba(160,32,240,0.35),inset_0_0_16px_rgba(184,77,255,0.2)] flex items-center justify-center">
                <div className="absolute inset-2 rounded-full border border-dashed border-[#A020F0]/50 animate-spin" style={{ animationDuration: '14s' }} />

                {/* Left ESP Target Frame */}
                <div className="absolute -left-9 top-3 w-7 h-11 border border-[#B84DFF]/70 bg-[#A020F0]/10 flex flex-col justify-between p-0.5">
                  <div className="w-full h-[1.5px] bg-[#B84DFF]" />
                  <div className="w-2 h-2 border-t border-l border-[#FFFFFF]/60 mx-auto my-auto" />
                </div>

                {/* Center Locked Target Reticle */}
                <div className="relative w-10 h-14 border border-[#B84DFF] bg-[#A020F0]/20 flex items-center justify-center shadow-[0_0_14px_rgba(184,77,255,0.45)]">
                  <div className="w-3.5 h-3.5 relative flex items-center justify-center">
                    <div className="absolute w-full h-[1.5px] bg-[#FFFFFF]" />
                    <div className="absolute h-full w-[1.5px] bg-[#FFFFFF]" />
                  </div>
                </div>

                {/* Right ESP Target Frame */}
                <div className="absolute -right-9 bottom-3 w-7 h-11 border border-[#B84DFF]/70 bg-[#A020F0]/10 flex flex-col justify-between p-0.5">
                  <div className="w-4/5 h-[1.5px] bg-[#B84DFF]" />
                  <div className="w-2 h-2 border-b border-r border-[#FFFFFF]/60 mx-auto my-auto" />
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
}

const DEFAULT_FEATURE_POINTS = [
  '100% Anti-Ban Protection & High-Security Bypass',
  'Smooth Aimbot, ESP & Ultra-Low Latency Gameplay',
  'Instant Key Activation with 1-Device Security Lock',
  'Works on All Latest Updates with 24/7 VIP Support'
];

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
    <div className="relative w-full flex-1 min-h-[calc(100dvh-76px)] flex flex-col justify-between pt-1.5 pb-2 select-none animate-page-fade">
      {/* Subtle Purple Ambient Lighting Backdrop */}
      <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 w-72 h-44 bg-[radial-gradient(ellipse_at_center,rgba(160,32,240,0.22)_0%,rgba(184,77,255,0.08)_45%,transparent_75%)] blur-xl -z-10" />

      {/* Top & Center Content Group */}
      <div className="w-full flex flex-col">
        {/* ========================================================
            1. COMPACT PREMIUM HERO SECTION
            ======================================================== */}
        <section className="animate-gp-hero text-center mb-3">
          {/* Dynamic Website / Panel Name Badge */}
          <div className="inline-flex items-center justify-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#B84DFF] shadow-[0_0_8px_#B84DFF]" />
            <span className="text-[10.5px] sm:text-[11px] font-mono-code font-bold tracking-[0.26em] uppercase text-[#B84DFF]">
              {brandName}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#B84DFF] shadow-[0_0_8px_#B84DFF]" />
          </div>

          {/* Main Heading: WITH PANEL GAMEPLAY with subtle animated purple light sweep */}
          <h1 className="font-tech font-black text-[26px] min-[360px]:text-[29px] sm:text-[33px] leading-[1.04] tracking-[0.08em] uppercase gp-heading-sweep drop-shadow-[0_4px_20px_rgba(160,32,240,0.32)]">
            WITH PANEL
            <br />
            GAMEPLAY
          </h1>

          {/* Elegant Subtitle */}
          <p className="mt-1 text-[10px] sm:text-[10.5px] font-mono-code font-semibold tracking-[0.24em] uppercase text-[#9993A5]">
            EXPERIENCE THE GAMEPLAY
          </p>
        </section>

        {/* ========================================================
            2. CINEMATIC VIDEO PLAYER (Main Centerpiece)
            ======================================================== */}
        <section className="w-full mb-3">
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
          <section className="animate-gp-video w-full mb-3">
            <div className="relative p-[1px] bg-gradient-to-br from-[#B84DFF]/55 via-[#A020F0]/35 to-[#180F29] clip-card-br shadow-[0_8px_24px_-8px_rgba(160,32,240,0.28)]">
              <div className="bg-[#100A18]/95 backdrop-blur-md px-3.5 py-3 clip-card-br relative overflow-hidden">
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[#A020F0]/25">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00E5A4] shadow-[0_0_8px_#00E5A4]" />
                    <span className="text-[10px] font-mono-code font-bold tracking-[0.2em] uppercase text-[#C45CFF]">
                      PANEL FEATURES · WHAT YOU GET
                    </span>
                  </div>
                  <span className="text-[9.5px] font-mono-code font-bold tracking-[0.14em] uppercase text-[#9993A5]">
                    {brandName}
                  </span>
                </div>

                <ul className="space-y-1.5">
                  {featurePoints.map((point, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-[11.5px] sm:text-xs text-[#E4E0EC] leading-snug font-sans"
                    >
                      <span className="mt-[2px] w-4 h-4 rounded-[3px] bg-[#A020F0]/20 border border-[#B84DFF]/50 flex items-center justify-center text-[#B84DFF] text-[10px] font-bold shrink-0 shadow-[0_0_8px_rgba(184,77,255,0.3)]">
                        ✓
                      </span>
                      <span className="flex-1 font-medium">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ========================================================
          4. PREMIUM CONTINUE BUTTON (Anchored at Very Bottom)
          ======================================================== */}
      <section className="animate-gp-cta w-full mt-auto pt-2">
        <div className="p-[1px] bg-gradient-to-r from-[#B84DFF] via-[#A020F0] to-[#B84DFF] clip-continue-br shadow-[0_8px_28px_-4px_rgba(160,32,240,0.55)]">
          <button
            type="button"
            onClick={onContinue}
            className="relative w-full py-3.5 px-6 clip-continue-br bg-gradient-to-r from-[#A020F0] via-[#AD35F8] to-[#B84DFF] hover:brightness-110 active:scale-[0.98] text-[#FFFFFF] font-tech font-black text-[17px] sm:text-[18px] tracking-[0.18em] uppercase cursor-pointer transition-all duration-200 flex items-center justify-center gap-2.5 overflow-hidden group"
          >
            {/* Subtle animated shine */}
            <span className="absolute inset-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none animate-sheen" />

            <span className="relative z-10">
              {settings.introVideoButtonText || 'CONTINUE'}
            </span>
            <span className="relative z-10 inline-block animate-gp-arrow text-[18px] leading-none">
              →
            </span>
          </button>
        </div>
      </section>
    </div>
  );
};
