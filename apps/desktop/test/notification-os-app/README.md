# Native notification integration check

Run from the repository root:

```sh
FULLTIME_RUN_OS_NOTIFICATION_INTEGRATION=1 ./node_modules/.bin/electron apps/desktop/test/notification-os-app
```

The explicit gate is required because the check displays one real desktop
notification. It requires an interactive operating-system notification service
and permission for Electron, so it is not part of the headless Node test suite.

The check uses Electron's real `Notification` class. It passes only after the
native object emits `show`; it does not synthesize or monkey-patch notification
events. It also checks active-ID deduplication, the active-notification bound,
and serialized `presented` then `dismissed` lifecycle callbacks.
