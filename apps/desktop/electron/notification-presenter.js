'use strict'

const { EventEmitter } = require('events')
const electron = require('electron')

const {
  NotificationLifecycle,
  intentsEqual,
  sanitizeNotificationFailure,
  validateQueuedNotificationIntent
} = require('../lib/notification-lifecycle.js')

const DEFAULT_MAX_ACTIVE = 32
const MAX_ACTIVE_LIMIT = 64
const DEFAULT_SHOW_TIMEOUT_MS = 15_000
const DEFAULT_MAX_LIFETIME_MS = 15 * 60_000

class NotificationPresentationError extends Error {
  constructor (code, message, lifecycle = null) {
    super(message)
    this.name = 'NotificationPresentationError'
    this.code = code
    this.lifecycle = lifecycle
  }
}

class ElectronNotificationPresenter extends EventEmitter {
  constructor ({
    onLifecycle,
    getTrustedWindow,
    maxActive = DEFAULT_MAX_ACTIVE,
    showTimeoutMs = DEFAULT_SHOW_TIMEOUT_MS,
    maxLifetimeMs = DEFAULT_MAX_LIFETIME_MS
  }) {
    super()
    if (typeof onLifecycle !== 'function') throw new TypeError('Notification lifecycle callback is required')
    if (typeof getTrustedWindow !== 'function') throw new TypeError('Trusted window resolver is required')
    this.maxActive = boundedInteger(maxActive, 'Maximum active notifications', 1, MAX_ACTIVE_LIMIT)
    this.showTimeoutMs = boundedInteger(showTimeoutMs, 'Notification show timeout', 1_000, 60_000)
    this.maxLifetimeMs = boundedInteger(maxLifetimeMs, 'Notification maximum lifetime', 1_000, 24 * 60 * 60_000)
    this.onLifecycle = onLifecycle
    this.getTrustedWindow = getTrustedWindow
    this.active = new Map()
    this.callbackPromises = new Set()
    this.callbackTail = Promise.resolve()
    this.closed = false
    this.closing = null
  }

  get activeCount () {
    return this.active.size
  }

  get availableSlots () {
    return Math.max(0, this.maxActive - this.active.size)
  }

  present (value) {
    const intent = validateQueuedNotificationIntent(value)
    if (this.closed) {
      return Promise.reject(new NotificationPresentationError(
        'PRESENTER_CLOSED',
        'Native notification presenter is closed'
      ))
    }

    const existing = this.active.get(intent.id)
    if (existing) {
      if (!intentsEqual(existing.intent, intent)) {
        return Promise.reject(new NotificationPresentationError(
          'ACTIVE_ID_COLLISION',
          `Active notification ${intent.id} has different durable content`
        ))
      }
      return existing.presentation
    }

    const lifecycle = new NotificationLifecycle(intent)
    const Notification = electron && electron.Notification
    let supported = false
    try {
      supported = Boolean(Notification && typeof Notification.isSupported === 'function' && Notification.isSupported())
    } catch (error) {
      return this._rejectWithoutNative(lifecycle, 'SUPPORT_CHECK_FAILED', sanitizeNotificationFailure(error))
    }
    if (!supported) {
      return this._rejectWithoutNative(lifecycle, 'UNSUPPORTED', 'Native OS notifications are unsupported on this system')
    }
    if (this.active.size >= this.maxActive) {
      return Promise.reject(new NotificationPresentationError(
        'CAPACITY',
        `Native notification capacity is ${this.maxActive}; leave this durable intent queued for retry`
      ))
    }

    let notification
    try {
      notification = new Notification({
        title: intent.title,
        body: intent.body,
        silent: false,
        timeoutType: 'default'
      })
    } catch (error) {
      return this._rejectWithoutNative(lifecycle, 'CONSTRUCTION_FAILED', sanitizeNotificationFailure(error))
    }

    let resolvePresentation
    let rejectPresentation
    const presentation = new Promise((resolve, reject) => {
      resolvePresentation = resolve
      rejectPresentation = reject
    })
    const entry = {
      intent,
      lifecycle,
      notification,
      presentation,
      resolvePresentation,
      rejectPresentation,
      presentationSettled: false,
      pendingClick: false,
      showTimer: null,
      lifetimeTimer: null,
      handlers: null
    }
    entry.handlers = {
      show: () => this._handleShow(entry),
      click: () => this._handleClick(entry),
      close: () => this._handleNativeClose(entry),
      failed: (_event, error) => this._handleNativeFailure(entry, error)
    }
    notification.once('show', entry.handlers.show)
    notification.once('click', entry.handlers.click)
    notification.once('close', entry.handlers.close)
    notification.once('failed', entry.handlers.failed)
    entry.showTimer = setTimeout(() => {
      this._failEntry(entry, 'SHOW_TIMEOUT', 'Native notification did not emit an OS show event before the timeout')
    }, this.showTimeoutMs)
    this.active.set(intent.id, entry)

    try {
      notification.show()
    } catch (error) {
      this._failEntry(entry, 'SHOW_FAILED', sanitizeNotificationFailure(error))
    }
    return presentation
  }

  async close () {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = this._close()
    return this.closing
  }

  async _close () {
    for (const entry of [...this.active.values()]) {
      if (entry.lifecycle.state === 'queued') {
        this._failEntry(entry, 'PRESENTER_CLOSED', 'Notification presenter closed before the OS show event')
      } else if (entry.lifecycle.state === 'presented') {
        this._dismissEntry(entry)
      }
    }
    await Promise.allSettled([...this.callbackPromises])
    this.removeAllListeners()
  }

  _handleShow (entry) {
    if (!this._isActive(entry) || entry.lifecycle.state !== 'queued') return
    clearTimeout(entry.showTimer)
    entry.showTimer = null
    const event = entry.lifecycle.transition('presented', Date.now())
    this._emitLifecycle(event)
    entry.presentationSettled = true
    entry.resolvePresentation(event)
    entry.lifetimeTimer = setTimeout(() => this._dismissEntry(entry), this.maxLifetimeMs)
    if (typeof entry.lifetimeTimer.unref === 'function') entry.lifetimeTimer.unref()
    if (entry.pendingClick) this._openEntry(entry)
  }

  _handleClick (entry) {
    if (!this._isActive(entry)) return
    if (entry.lifecycle.state === 'queued') {
      entry.pendingClick = true
      return
    }
    if (entry.lifecycle.state === 'presented') this._openEntry(entry)
  }

  _handleNativeClose (entry) {
    if (!this._isActive(entry)) return
    if (entry.lifecycle.state === 'queued') {
      this._failEntry(entry, 'CLOSED_BEFORE_SHOW', 'Native notification closed before the OS show event', false)
      return
    }
    if (entry.lifecycle.state === 'presented') this._dismissEntry(entry, false)
  }

  _handleNativeFailure (entry, error) {
    if (!this._isActive(entry)) return
    this._failEntry(entry, 'NATIVE_FAILED', sanitizeNotificationFailure(error), false)
  }

  _openEntry (entry) {
    if (!this._isActive(entry) || entry.lifecycle.state !== 'presented') return
    const focusError = this._focusTrustedWindow(entry.intent)
    const event = entry.lifecycle.transition('opened', Date.now())
    this._emitLifecycle(event)
    if (focusError) this._reportLifecycleError(focusError, event)
    this._finalizeEntry(entry, true)
  }

  _dismissEntry (entry, closeNative = true) {
    if (!this._isActive(entry) || entry.lifecycle.state !== 'presented') return
    if (closeNative) {
      const closeError = closeNotification(entry.notification)
      if (closeError) {
        this._failEntry(entry, 'CLOSE_FAILED', sanitizeNotificationFailure(closeError), false)
        return
      }
      if (!this._isActive(entry)) return
    }
    const event = entry.lifecycle.transition('dismissed', Date.now())
    this._emitLifecycle(event)
    this._finalizeEntry(entry, false)
  }

  _failEntry (entry, code, failure, closeNative = true) {
    if (!this._isActive(entry)) return
    const message = sanitizeNotificationFailure(failure)
    const event = entry.lifecycle.transition('failed', Date.now(), message)
    if (!event) return
    this._emitLifecycle(event)
    if (!entry.presentationSettled) {
      entry.presentationSettled = true
      entry.rejectPresentation(new NotificationPresentationError(code, message, event))
    }
    this._finalizeEntry(entry, closeNative)
  }

  _rejectWithoutNative (lifecycle, code, failure) {
    const message = sanitizeNotificationFailure(failure)
    const event = lifecycle.transition('failed', Date.now(), message)
    this._emitLifecycle(event)
    return Promise.reject(new NotificationPresentationError(code, message, event))
  }

  _finalizeEntry (entry, closeNative) {
    if (!this._isActive(entry)) return
    this.active.delete(entry.intent.id)
    if (entry.showTimer) clearTimeout(entry.showTimer)
    if (entry.lifetimeTimer) clearTimeout(entry.lifetimeTimer)
    entry.notification.removeListener('show', entry.handlers.show)
    entry.notification.removeListener('click', entry.handlers.click)
    entry.notification.removeListener('close', entry.handlers.close)
    entry.notification.removeListener('failed', entry.handlers.failed)
    if (closeNative) {
      const error = closeNotification(entry.notification)
      if (error) console.error('[fulltime notifications] native notification close failed:', error)
    }
  }

  _isActive (entry) {
    return this.active.get(entry.intent.id) === entry
  }

  _emitLifecycle (event) {
    try {
      this.emit('lifecycle', event)
    } catch (error) {
      this._reportLifecycleError(error, event)
    }
    const callback = this.callbackTail.then(() => this.onLifecycle(event))
    const settled = callback.catch((error) => this._reportLifecycleError(error, event))
    this.callbackTail = settled
    this.callbackPromises.add(settled)
    settled.finally(() => this.callbackPromises.delete(settled))
  }

  _reportLifecycleError (error, event) {
    if (this.listenerCount('lifecycle-error') > 0) {
      try {
        this.emit('lifecycle-error', error, event)
      } catch (listenerError) {
        console.error(`[fulltime notifications] lifecycle-error listener failed for ${event.id}:`, listenerError)
      }
      return
    }
    console.error(`[fulltime notifications] lifecycle callback failed for ${event.id}:`, error)
  }

  _focusTrustedWindow (intent) {
    try {
      const win = this.getTrustedWindow(intent)
      if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed() || typeof win.focus !== 'function') return false
      if (typeof win.isMinimized === 'function' && win.isMinimized() && typeof win.restore === 'function') win.restore()
      if (typeof win.isVisible === 'function' && !win.isVisible() && typeof win.show === 'function') win.show()
      win.focus()
      return null
    } catch (error) {
      return error
    }
  }
}

function closeNotification (notification) {
  try {
    notification.close()
    return null
  } catch (error) {
    return error
  }
}

function boundedInteger (value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be ${minimum}-${maximum}`)
  }
  return value
}

module.exports = {
  DEFAULT_MAX_ACTIVE,
  DEFAULT_MAX_LIFETIME_MS,
  DEFAULT_SHOW_TIMEOUT_MS,
  ElectronNotificationPresenter,
  MAX_ACTIVE_LIMIT,
  NotificationPresentationError
}
