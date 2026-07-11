# Backend boundary

FullTime room state is peer-to-peer. The Electron-owned Bare worker contains
Corestore, Hyperswarm, Autobase, BlindPairing, Hyperbee, Hyperblobs, Protomux,
and notification state. The renderer crosses only a bounded preload bridge or
the authenticated same-controller loopback bridge.

The operator publishes the only fixture authority and a signed public network
manifest. Desktop releases contain the manifest verification key, not TxLINE
credentials or publisher configuration. If configuration cannot be verified,
the product does not start a room worker.

The answer-attestor and receipt feed are optional all-or-nothing manifest pins.
The worker verifies the attestor token and actual public receipt-feed block
before appending an encrypted `answer.reference`; room writers cannot mint a
call, settlement, odds record, receipt, or anchor claim. A future pinned anchor
observer remains required before any receipt can be marked anchored.

Do not reintroduce a centralized database, a per-browser worker gateway, or a
consumer-controlled fixture feed key.
