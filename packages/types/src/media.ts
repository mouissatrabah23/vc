/** Media domain vocabulary — the shapes krillinai-cli produces and consumes. */

import type { UUID } from './common.js';

/** BCP-47 language tag, e.g. `en`, `fr`, `ar-DZ`. */
export type LanguageCode = string;

export const SUBTITLE_FORMATS = ['srt', 'vtt', 'ass', 'txt', 'json'] as const;
export type SubtitleFormat = (typeof SUBTITLE_FORMATS)[number];

export const MEDIA_KINDS = ['audio', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Probe result for an uploaded asset (ffprobe-shaped). */
export interface MediaMetadata {
  kind: MediaKind;
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  frameRate?: number;
}

/** One timed unit of a transcript or translation. */
export interface TranscriptSegment {
  index: number;
  /** Seconds from the start of the media, not milliseconds. */
  startSeconds: number;
  endSeconds: number;
  text: string;
  /** Model confidence in [0, 1] when the provider reports one. */
  confidence?: number;
  speaker?: string;
}

export interface Transcript {
  language: LanguageCode;
  segments: TranscriptSegment[];
  /** Provider/model that produced it, e.g. `whisper-large-v3`. */
  model?: string;
}

/** Knobs exposed to the user, passed through to krillinai-cli by the worker. */
export interface TranscodeOptions {
  sourceLanguage?: LanguageCode | 'auto';
  targetLanguages?: LanguageCode[];
  subtitleFormat?: SubtitleFormat;
  /** Burn subtitles into the video track instead of emitting a sidecar file. */
  burnIn?: boolean;
  /** Also synthesise a dubbed audio track. */
  synthesizeVoice?: boolean;
}

/** A stored artifact produced by a completed job. */
export interface MediaAsset {
  id: UUID;
  kind: MediaKind | 'subtitle' | 'transcript';
  storageKey: string;
  format: string;
  sizeBytes: number;
  language?: LanguageCode;
}
