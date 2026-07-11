# FullTime web UI

This package is the Next UI bundled by the desktop app. It is not a public
standalone FullTime service and it never starts a fixture publisher or a Pear
worker.

In the supported product path, Electron starts a private Next upstream and
places a loopback-only host in front of it. That host owns `/api/peer/*` and
forwards validated browser requests to the same `DesktopPeerController` used by
Electron preload IPC. A browser must be opened from Electron's one-time local
capability URL first.

## UI development only

    npm run web:ui

This command is useful for page and component work. It intentionally has no
peer bridge, TxLINE setup, fixture key, gateway secret, or local publisher.
Use `npm run desktop:dev` to exercise rooms end to end.

## Checks

    npm --workspace @fulltime/web run typecheck
    npm --workspace @fulltime/web run lint
    npm --workspace @fulltime/web run test
    npm --workspace @fulltime/web run build -- --webpack
