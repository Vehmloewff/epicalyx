/// <reference lib="dom" />

import { WSClient } from './types.ts'

export function makeDomWsClient(): WSClient {
	return async params => {
		const ws = new WebSocket(params.url)

		let needsToResolve = true
		await new Promise<void>((resolve, reject) => {
			ws.onopen = () => {
				if (needsToResolve) {
					resolve()
					needsToResolve = false
				} else console.warn('WS connection opened after it threw an error')
			}

			ws.onerror = e => {
				console.error(e)
				if (needsToResolve) reject(e)
				else console.warn('WS connection threw an error after it was successfully opened')
			}
		})

		function sendMessage(message: string) {
			if (ws.readyState !== ws.OPEN) close()
			ws.send(message)
		}

		function close() {
			if (ws.readyState !== ws.CLOSED && ws.readyState !== ws.CLOSING) ws.close()
			params.onClose()
		}

		ws.onmessage = e => {
			if (typeof e.data === 'string') params.onMessage(e.data)
			else console.warn(`Received non-string message over websocket:`, e.data)
		}

		ws.onclose = () => {
			params.onClose()
		}

		return {
			sendMessage,
			close,
		}
	}
}
