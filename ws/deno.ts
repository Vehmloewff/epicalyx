import { WSServer } from './types.ts'
import { Json } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'
import { acceptWebSocket, isWebSocketCloseEvent, isWebSocketPingEvent, WebSocket } from 'https://deno.land/std@0.84.0/ws/mod.ts'
import { Application } from 'https://deno.land/x/oak@v6.5.0/mod.ts'
import { oakCors } from 'https://deno.land/x/cors@v1.2.1/mod.ts'

export function makeDenoWsServer(): WSServer {
	return ({ onClientAdded, canAcceptSocket, supportsPath, supportsResponse }) => {
		async function handleWs(sock: WebSocket, params: Json) {
			const { onMessage, onClose } = onClientAdded({
				close() {
					sock.close()
				},
				send(message) {
					sock.send(message)
				},
				clientParams: params,
			})

			try {
				for await (const ev of sock) {
					if (typeof ev === 'string') {
						onMessage(ev)
					} else if (ev instanceof Uint8Array) {
						console.log('Received a binary message.  Ignoring')
					} else if (isWebSocketPingEvent(ev)) {
						const [, body] = ev
						console.log('ws:Ping', body)
					} else if (isWebSocketCloseEvent(ev)) {
						// close
						onClose()
					}
				}
			} catch (err) {
				console.error(`failed to receive frame: ${err}`)

				if (!sock.isClosed) {
					await sock.close(1000).catch(console.error)
				}
			}
		}

		return {
			oakMiddleware() {
				return async (ctx, next) => {
					if (ctx.request.url.pathname === supportsPath) {
						ctx.response.body = supportsResponse
						ctx.response.status = 200
						return
					}

					const params = canAcceptSocket(ctx.request.url.pathname)

					if (!params) return next()

					const { conn, headers, r: bufReader, w: bufWriter } = ctx.request.serverRequest
					const websocket = await acceptWebSocket({
						conn,
						bufReader,
						bufWriter,
						headers,
					}).catch(err => {
						console.error(`failed to accept websocket: ${err}`)
						ctx.response.status = 400
					})

					if (websocket) await handleWs(websocket, params)
				}
			},
			async listen(port) {
				const app = new Application()

				app.use(oakCors({ origin: '*' }))
				app.use(this.oakMiddleware())

				app.addEventListener('listen', () => console.log(`Listening on http://localhost:${port}`))

				await app.listen({ port })

				throw new Error(`Wasn't ever supposed to get down here`)
			},
		}
	}
}
