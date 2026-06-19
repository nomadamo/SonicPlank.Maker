import type { EncoderConfig } from "@/global";

export type EncoderKey = "h264_nvenc" | "libx264" | "h264_amf" | "h264_qsv";

export const NVENC_OPTS = {
  preset: { label: "Preset",       values: ["p1","p2","p3","p4","p5","p6","p7"] as const },
  tune:   { label: "Tune",         values: ["hq","ll","ull","lossless"] as const },
  rc:     { label: "Rate Control", values: ["cbr","vbr","constqp","cbr_ld_hq","cbr_hq","vbr_hq"] as const },
  profile:{ label: "Profile",      values: ["baseline","main","high","high444p"] as const },
} as const;

export const X264_OPTS = {
  preset: { label: "Preset",  values: ["ultrafast","superfast","veryfast","faster","fast","medium","slow","slower","veryslow"] as const },
  tune:   { label: "Tune",    values: ["film","animation","grain","stillimage","psnr","ssim","fastdecode","zerolatency"] as const },
  profile:{ label: "Profile", values: ["baseline","main","high","high10","high422","high444"] as const },
} as const;

export const AMF_OPTS = {
  rc:     { label: "Rate Control", values: ["cqp","cbr","vbr_peak","vbr_latency"] as const },
  quality:{ label: "Quality",      values: ["speed","balanced","quality"] as const },
} as const;

export const QSV_OPTS = {
  preset: { label: "Preset",  values: ["veryfast","faster","fast","medium","slow","slower","veryslow"] as const },
  profile:{ label: "Profile", values: ["baseline","main","high"] as const },
} as const;

export const ENCODER_LABELS: Record<EncoderKey, string> = {
  h264_nvenc: "NVENC",
  libx264:    "x264",
  h264_amf:   "AMF",
  h264_qsv:   "QSV",
};

export function makeDefaultEncoderConfig(): EncoderConfig {
  return {
    bitrate_kbps: 8000,
    h264_nvenc: {
      options: { preset: "p6", tune: "hq", rc: "cbr", profile: "high" },
    },
    libx264: {
      options: { preset: "ultrafast", tune: "zerolatency", sc_threshold: "0" },
    },
    h264_amf: {
      options: { rc: "cbr", quality: "speed" },
    },
    h264_qsv: {
      options: { look_ahead: "0" },
    },
  };
}
