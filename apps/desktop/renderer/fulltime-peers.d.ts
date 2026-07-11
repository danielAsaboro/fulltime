export {}

type FullTimeJson = null | boolean | number | string | FullTimeJson[] | FullTimeJsonObject
type FullTimeJsonObject = { [key: string]: FullTimeJson }

type FullTimePeerAction =
  | 'session.get'
  | 'session.sign-in'
  | 'session.sign-out'
  | 'fixture.list'
  | 'fixture.get'
  | 'fixture.intelligence'
  | 'record.get'
  | 'room.get'
  | 'room.preview-invite'
  | 'room.create'
  | 'room.join'
  | 'room.details'
  | 'room.state'
  | 'room.answer.submit'
  | 'room.receipt.get'
  | 'room.replay'
  | 'room.history.page'
  | 'room.thread.page'
  | 'room.poll.vote'
  | 'room.message.send'
  | 'room.media.upload.begin'
  | 'room.media.upload.chunk'
  | 'room.media.upload.commit'
  | 'room.media.upload.abort'
  | 'room.media.download.begin'
  | 'room.media.download.chunk'
  | 'room.media.download.close'
  | 'room.notification.settings'
  | 'room.notification.settings.update'
  | 'room.report'
  | 'room.reports.list'
  | 'room.poll.create'
  | 'room.item.react'
  | 'room.reply.send'
  | 'room.typing.set'
  | 'room.read.mark'
  | 'room.invite.create'
  | 'room.invite.regenerate'
  | 'room.invite.revoke'
  | 'room.rename'
  | 'room.member.remove'
  | 'room.member.role'
  | 'room.slow-mode'
  | 'room.close'
  | 'room.leave'

type FullTimePeerRequestMap = {
  'session.get': { payload: null; result: FullTimeJsonObject | null }
  'session.sign-in': { payload: { displayName: string }; result: FullTimeJsonObject }
  'session.sign-out': { payload: null; result: null }
  'fixture.list': {
    payload: { phase?: 'all' | 'upcoming' | 'live' | 'finished' }
    result: FullTimeJsonObject[]
  }
  'fixture.get': { payload: { fixtureId: string }; result: FullTimeJsonObject | null }
  'fixture.intelligence': { payload: { fixtureId: string }; result: FullTimeJsonObject | null }
  'record.get': { payload: null; result: FullTimeJsonObject }
  'room.get': { payload: { roomId: string }; result: FullTimeJsonObject | null }
  'room.preview-invite': { payload: { code: string }; result: FullTimeJsonObject | null }
  'room.create': {
    payload: { fixtureId: string; roomName: string; displayName: string }
    result: FullTimeJsonObject
  }
  'room.join': { payload: { code: string }; result: FullTimeJsonObject }
  'room.details': { payload: { roomId: string }; result: FullTimeJsonObject | null }
  'room.state': { payload: { roomId: string }; result: FullTimeJsonObject }
  'room.answer.submit': {
    payload: { roomId: string; callId: string; optionId: string }
    result: FullTimeJsonObject
  }
  'room.receipt.get': { payload: { roomId: string; receiptId: string }; result: FullTimeJsonObject }
  'room.replay': { payload: { roomId: string }; result: FullTimeJsonObject }
  'room.history.page': {
    payload: { roomId: string; limit?: number; cursor?: string | null }
    result: FullTimeJsonObject
  }
  'room.thread.page': {
    payload: { roomId: string; itemId: string; limit?: number; cursor?: string | null }
    result: FullTimeJsonObject
  }
  'room.poll.vote': { payload: { roomId: string; pollId: string; option: string }; result: null }
  'room.message.send': {
    payload: { roomId: string; input: FullTimeJsonObject }
    result: FullTimeJsonObject
  }
  'room.media.upload.begin': {
    payload: { roomId: string; name: string; sizeBytes: number }
    result: FullTimeJsonObject
  }
  'room.media.upload.chunk': {
    payload: { roomId: string; uploadId: string; index: number; data: string }
    result: FullTimeJsonObject
  }
  'room.media.upload.commit': {
    payload: { roomId: string; uploadId: string; text: string }
    result: FullTimeJsonObject
  }
  'room.media.upload.abort': { payload: { roomId: string; uploadId: string }; result: null }
  'room.media.download.begin': {
    payload: { roomId: string; itemId: string }
    result: FullTimeJsonObject
  }
  'room.media.download.chunk': {
    payload: { roomId: string; downloadId: string; index: number }
    result: FullTimeJsonObject
  }
  'room.media.download.close': { payload: { roomId: string; downloadId: string }; result: null }
  'room.notification.settings': { payload: { roomId: string }; result: FullTimeJsonObject }
  'room.notification.settings.update': {
    payload: { roomId: string; settings: FullTimeJsonObject }
    result: FullTimeJsonObject
  }
  'room.report': { payload: { roomId: string; target: FullTimeJsonObject; reason: string; note: string }; result: FullTimeJsonObject }
  'room.reports.list': { payload: { roomId: string }; result: FullTimeJsonObject[] }
  'room.poll.create': {
    payload: { roomId: string; input: { question: string; options: string[] } }
    result: FullTimeJsonObject
  }
  'room.item.react': { payload: { roomId: string; itemId: string; emoji: string }; result: null }
  'room.reply.send': {
    payload: { roomId: string; itemId: string; input: { text: string } }
    result: FullTimeJsonObject
  }
  'room.typing.set': { payload: { roomId: string; typing: boolean }; result: null }
  'room.read.mark': { payload: { roomId: string; itemId: string }; result: null }
  'room.invite.create': { payload: { roomId: string }; result: FullTimeJsonObject }
  'room.invite.regenerate': { payload: { roomId: string }; result: FullTimeJsonObject }
  'room.invite.revoke': { payload: { roomId: string }; result: null }
  'room.rename': { payload: { roomId: string; name: string }; result: null }
  'room.member.remove': { payload: { roomId: string; userId: string }; result: null }
  'room.member.role': {
    payload: { roomId: string; userId: string; role: 'member' | 'moderator' }
    result: null
  }
  'room.slow-mode': { payload: { roomId: string; seconds: number }; result: null }
  'room.close': { payload: { roomId: string }; result: null }
  'room.leave': { payload: { roomId: string }; result: null }
}

type FullTimePeerRequest<A extends FullTimePeerAction = FullTimePeerAction> = {
  version: 2
  id: string
  action: A
  payload: FullTimePeerRequestMap[A]['payload']
}

type FullTimePeerResponse =
  | { version: 2; id: string; ok: true; result: FullTimeJson }
  | {
      version: 2
      id: string
      ok: false
      error: { code: string; message: string; recoverable: boolean; details?: FullTimeJson }
    }

type FullTimePeerEvent =
  | { version: 2; type: 'bridge.ready'; mode: 'pear-p2p-rooms'; at: number }
  | {
      version: 2
      type: 'transport.status'
      status: 'starting' | 'discovering' | 'online' | 'offline' | 'degraded'
      peerCount: number
      at: number
    }
  | {
      version: 2
      type: 'fixture.updated'
      fixtureId: string
      card: FullTimeJsonObject
      at: number
    }
  | {
      version: 2
      type: 'room.state'
      roomId: string
      revision: number
      state: FullTimeJsonObject
      at: number
    }
  | {
      version: 2
      type: 'room.details'
      roomId: string
      revision: number
      details: FullTimeJsonObject
      at: number
    }
  | {
      version: 2
      type: 'room.error'
      roomId?: string
      action?: FullTimePeerAction
      code: string
      message: string
      recoverable: boolean
      at: number
    }

type FullTimePeerConfig = {
  protocolVersion: 2
  mode: 'pear-p2p-rooms'
  maxRoomMembers: number
  networkConfig?: 'stale'
}

declare global {
  interface Window {
    fullTimePeers: {
      getConfig(): Promise<FullTimePeerConfig>
      request<A extends FullTimePeerAction>(
        action: A,
        payload: FullTimePeerRequestMap[A]['payload']
      ): Promise<FullTimePeerRequestMap[A]['result']>
      subscribe(listener: (event: FullTimePeerEvent) => void): () => void
    }
  }
}
