import assert from "node:assert/strict";
import test from "node:test";

import { fullTimeDownloads } from "../lib/downloads";

test("publishes only configured release downloads", () => {
  assert.deepEqual(fullTimeDownloads({}), []);

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
