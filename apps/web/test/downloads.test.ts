import assert from "node:assert/strict";
import test from "node:test";

import { fullTimeDownloads } from "../lib/downloads";

test("defaults the deployed website to the published GitHub release", () => {
  const downloads = fullTimeDownloads();
  assert.deepEqual(downloads.map(({ platform, url }) => ({ platform, url })), [
    {
      platform: "desktop",
      url: "https://github.com/danielAsaboro/fulltime/releases/download/v0.1.0-beta.1/FullTime-0.1.0-macos-arm64.zip",
    },
    {
      platform: "android",
      url: "https://github.com/danielAsaboro/fulltime/releases/download/v0.1.0-beta.1/FullTime-0.1.0-android.apk",
    },
    {
      platform: "ios",
      url: "https://github.com/danielAsaboro/fulltime/blob/main/apps/mobile/README.md#iphone-build-from-source",
    },
  ]);
});

test("publishes only configured downloads plus the real iPhone source build", () => {
  assert.deepEqual(fullTimeDownloads({}), [
    {
      platform: "ios",
      delivery: "source",
      name: "iPhone",
      description: "Build the native app with Xcode using your own Apple signing team.",
      action: "Build from source",
      url: "https://github.com/danielAsaboro/fulltime/blob/main/apps/mobile/README.md#iphone-build-from-source",
    },
  ]);

  const downloads = fullTimeDownloads({
    FULLTIME_DESKTOP_DOWNLOAD_URL: "https://releases.example.com/fulltime.dmg",
    FULLTIME_IOS_DOWNLOAD_URL: "  ",
    FULLTIME_ANDROID_DOWNLOAD_URL: "https://play.google.com/store/apps/details?id=com.txoddline.fulltime",
  });

  assert.deepEqual(downloads.map(({ platform, url }) => ({ platform, url })), [
    { platform: "desktop", url: "https://releases.example.com/fulltime.dmg" },
    {
      platform: "android",
      url: "https://play.google.com/store/apps/details?id=com.txoddline.fulltime",
    },
    {
      platform: "ios",
      url: "https://github.com/danielAsaboro/fulltime/blob/main/apps/mobile/README.md#iphone-build-from-source",
    },
  ]);
});

test("rejects unsafe or malformed release URLs", () => {
  assert.throws(
    () => fullTimeDownloads({ FULLTIME_IOS_DOWNLOAD_URL: "javascript:alert(1)" }),
    /FULLTIME_IOS_DOWNLOAD_URL must be an absolute HTTPS URL/,
  );
  assert.throws(
    () => fullTimeDownloads({ FULLTIME_ANDROID_DOWNLOAD_URL: "https://user:secret@example.com/app.apk" }),
    /without embedded credentials/,
  );
});
