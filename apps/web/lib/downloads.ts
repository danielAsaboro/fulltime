export type FullTimeDownload = {
  platform: "desktop" | "ios" | "android";
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

const RELEASES = [
  {
    platform: "desktop",
    name: "Desktop",
    description: "Run your Pear room worker and encrypted room history on your computer.",
    action: "Download desktop app",
    env: "FULLTIME_DESKTOP_DOWNLOAD_URL",
  },
  {
    platform: "ios",
    name: "iPhone",
    description: "Join rooms, scan invites, and keep up with the match from your iPhone.",
    action: "Download iPhone app",
    env: "FULLTIME_IOS_DOWNLOAD_URL",
  },
  {
    platform: "android",
    name: "Android",
    description: "Bring the same encrypted room, polls, and reactions to Android.",
    action: "Download Android app",
    env: "FULLTIME_ANDROID_DOWNLOAD_URL",
  },
] as const;

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
  FULLTIME_DESKTOP_DOWNLOAD_URL: process.env.FULLTIME_DESKTOP_DOWNLOAD_URL,
  FULLTIME_IOS_DOWNLOAD_URL: process.env.FULLTIME_IOS_DOWNLOAD_URL,
  FULLTIME_ANDROID_DOWNLOAD_URL: process.env.FULLTIME_ANDROID_DOWNLOAD_URL,
}): FullTimeDownload[] {
  return RELEASES.flatMap((release) => {
    const url = releaseUrl(environment[release.env], release.env);
    return url ? [{ ...release, url }] : [];
  });
}
