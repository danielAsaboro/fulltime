export type FullTimeDownload = {
  platform: "desktop" | "ios" | "android";
  delivery: "download" | "source";
  name: string;
  description: string;
  action: string;
  url: string;
};

type DownloadEnvironment = Partial<Record<
  | "FULLTIME_DESKTOP_DOWNLOAD_URL"
  | "FULLTIME_IOS_DOWNLOAD_URL"
  | "FULLTIME_ANDROID_DOWNLOAD_URL",
  string | undefined
>>;

const GITHUB_RELEASE_ROOT = "https://github.com/danielAsaboro/fulltime/releases/download/v0.1.0-beta.1";
const DEFAULT_DESKTOP_DOWNLOAD_URL = `${GITHUB_RELEASE_ROOT}/FullTime-0.1.0-macos-arm64.zip`;
const DEFAULT_ANDROID_DOWNLOAD_URL = `${GITHUB_RELEASE_ROOT}/FullTime-0.1.0-android.apk`;

const RELEASES = [
  {
    platform: "desktop",
    delivery: "download",
    name: "Desktop",
    description: "Run your Pear room worker and encrypted room history on your computer.",
    action: "Download desktop app",
    env: "FULLTIME_DESKTOP_DOWNLOAD_URL",
  },
  {
    platform: "ios",
    delivery: "download",
    name: "iPhone",
    description: "Join rooms, scan invites, and keep up with the match from your iPhone.",
    action: "Download iPhone app",
    env: "FULLTIME_IOS_DOWNLOAD_URL",
  },
  {
    platform: "android",
    delivery: "download",
    name: "Android",
    description: "Bring the same encrypted room, polls, and reactions to Android.",
    action: "Download Android app",
    env: "FULLTIME_ANDROID_DOWNLOAD_URL",
  },
] as const;

const IOS_SOURCE: FullTimeDownload = {
  platform: "ios",
  delivery: "source",
  name: "iPhone",
  description: "Build the native app with Xcode using your own Apple signing team.",
  action: "Build from source",
  url: "https://github.com/danielAsaboro/fulltime/blob/main/apps/mobile/README.md#iphone-build-from-source",
};

function releaseUrl(value: string | undefined, variable: string): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${variable} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${variable} must be an absolute HTTPS URL without embedded credentials`);
  }
  return parsed.toString();
}

export function fullTimeDownloads(environment: DownloadEnvironment = {
  FULLTIME_DESKTOP_DOWNLOAD_URL: process.env.FULLTIME_DESKTOP_DOWNLOAD_URL ?? DEFAULT_DESKTOP_DOWNLOAD_URL,
  FULLTIME_IOS_DOWNLOAD_URL: process.env.FULLTIME_IOS_DOWNLOAD_URL,
  FULLTIME_ANDROID_DOWNLOAD_URL: process.env.FULLTIME_ANDROID_DOWNLOAD_URL ?? DEFAULT_ANDROID_DOWNLOAD_URL,
}): FullTimeDownload[] {
  const downloads = RELEASES.flatMap((release) => {
    const url = releaseUrl(environment[release.env], release.env);
    return url ? [{ ...release, url }] : [];
  });
  return downloads.some(({ platform }) => platform === "ios") ? downloads : [...downloads, IOS_SOURCE];
}
