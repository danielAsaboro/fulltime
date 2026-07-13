# FullTime web UI

This package serves two deliberately separate surfaces: `/` is the public
marketing site, while `/app`, `/matches`, `/join`, `/record`, and `/room/*` are
the product UI bundled by the desktop app. The public homepage does not mount
the peer data provider or expose room controls. This package never starts a
fixture publisher or a Pear worker.

In the supported product path, Electron starts a private Next upstream and
places a loopback-only host in front of it. That host owns `/api/peer/*` and
forwards validated browser requests to the same `DesktopPeerController` used by
Electron preload IPC. A browser must be opened from Electron's one-time local
capability URL first; that exchange lands on `/app`, not on the public
marketing homepage.

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
