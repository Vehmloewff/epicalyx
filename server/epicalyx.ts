import { InnerJson, matchPath, MatchPathResult, JsonDescriptor, validateJson } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'
import { acceptWebSocket, isWebSocketCloseEvent, isWebSocketPongEvent, WebSocket } from 'https://deno.land/std@0.84.0/ws/mod.ts'
import { Application, Middleware } from 'https://deno.land/x/oak@v6.5.0/mod.ts'
import { oakCors } from 'https://deno.land/x/cors@v1.2.1/mod.ts'
import { v4 } from 'https://deno.land/std@0.84.0/uuid/mod.ts'
import { EpicalyxMessageUp, MethodRes, MethodReq } from '../types.ts'

// deno-lint-ignore no-explicit-any
export type LazyMessageType = any
// deno-lint-ignore no-explicit-any
export type ErrorType = any

export interface EpicalyxServerParams {
	docs: string
	pathPattern: string
}

export interface CloseParams {
	code: string
	reason: string
}

export interface RegisterMethodResult {
	validateParams(descriptor: JsonDescriptor): void
}

export type MethodListener = (data: LazyMessageType, pathParams: MatchPathResult['params']) => Promise<unknown | void> | unknown | void

export interface OnClientAddedParams extends MatchPathResult {
	onClose(fn: () => void): void
	close(params: CloseParams): void

	registerMethod(method: string, onCalled: MethodListener): RegisterMethodResult
	// registerEmitter(scope: string, onCalled: (data: InnerJson, emit: (message: InnerJson) => void) => Promise<boolean> | boolean): void
	// registerTransmitter(resourceName: string): string // TODO: FINISH
}

export interface OnClientAddedErrorParams {
	error: ErrorType
	connectionPathParams: MatchPathResult['params']
	connectionQuery: MatchPathResult['query']
}

export interface OnMethodErrorParams extends OnClientAddedErrorParams {
	reqMethod: string
	usedMethod: string
	methodParams: LazyMessageType
}

export class EpicalyxServer {
	private callOnClientAdded: ((params: OnClientAddedParams) => Promise<void> | void)[] = []
	private callOnClientAddedError: ((params: OnClientAddedErrorParams) => void)[] = []
	private callOnMethodError: ((params: OnMethodErrorParams) => void)[] = []

	private clients: Map<
		string,
		{
			close(): void
			send(msg: string): void
			onClose(fn: () => void): void
			onMessage(fn: (msg: EpicalyxMessageUp) => void): void
		}
	> = new Map()

	params: EpicalyxServerParams

	constructor(params: EpicalyxServerParams) {
		this.params = params
	}

	onClientAdded(fn: (params: OnClientAddedParams) => Promise<void> | void) {
		this.callOnClientAdded.push(fn)
	}

	onClientAddedError(fn: (errorMeta: OnClientAddedErrorParams) => void) {
		this.callOnClientAddedError.push(fn)
	}

	onMethodError(fn: (errorMeta: OnMethodErrorParams) => void) {
		this.callOnMethodError.push(fn)
	}

	oakMiddleware(): Middleware {
		return async (ctx, next) => {
			if (ctx.request.url.pathname === '/supports-epicalyx-v1') {
				ctx.response.body = { epicalyx: '1.0', docs: this.params.docs }
				ctx.response.status = 200
				return
			}

			const params = matchPath(this.params.pathPattern, ctx.request.url.pathname + ctx.request.url.search)

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

			if (websocket) await this.handleWs(websocket, params)
		}
	}

	async listen(port: number) {
		const app = new Application()

		app.use(oakCors({ origin: '*' }))
		app.use(this.oakMiddleware())

		app.addEventListener('listen', () => console.log(`Listening on http://localhost:${port}`))

		await app.listen({ port })

		throw new Error(`Wasn't ever supposed to get down here`)
	}

	private async handleWs(sock: WebSocket, params: MatchPathResult) {
		const clientId = v4.generate()

		const callOnClose: (() => void)[] = []
		const callOnMessage: ((msg: EpicalyxMessageUp) => void)[] = []

		this.clients.set(clientId, {
			close() {
				sock.close()
			},
			send(msg) {
				sock.send(msg)
			},
			onClose(fn) {
				callOnClose.push(fn)
			},
			onMessage(fn) {
				callOnMessage.push(fn)
			},
		})

		this.handleNewClient(clientId, params)

		const close = () => {
			if (!sock.isClosed) sock.close()

			callOnClose.forEach(fn => fn())
			this.clients.delete(clientId)

			clearInterval(interval)
		}

		let timeout
		const interval = setInterval(() => {
			sock.ping()

			timeout = setTimeout(() => {
				close()
			}, 1000)
		}, 10000)

		try {
			for await (const ev of sock) {
				if (typeof ev === 'string') {
					const msg = verifyMessage(ev)
					if (!msg) console.warn('Invalid message received.  Ignoring...')

					callOnMessage.forEach(fn => fn(msg))
				} else if (ev instanceof Uint8Array) {
					console.log('Received a binary message.  Ignoring')
				} else if (isWebSocketPongEvent(ev)) {
					clearTimeout(timeout)
				} else if (isWebSocketCloseEvent(ev)) {
					close()
				}
			}
		} catch (err) {
			console.error(`failed to receive frame: ${err}`)

			if (!sock.isClosed) {
				await sock.close(1000).catch(console.error)
			}
		}
	}

	private handleNewClient(clientId: string, clientParams: MatchPathResult) {
		const registerMethod: OnClientAddedParams['registerMethod'] = (method, fn) => {
			let paramsDescriptor: JsonDescriptor | null = null

			const client = this.clients.get(clientId)
			if (client) {
				// return false to say: not correct message for my setup, try the next one
				// return true to say: found correct setup, don't try any others
				client.onMessage(async msg => {
					if (msg.type !== 'method-req') return false

					return await this.handleMethodReq(method, fn, msg, paramsDescriptor, clientId, clientParams)
				})
			}

			return {
				validateParams: descriptor => (paramsDescriptor = descriptor),
			}
		}

		this.callOnClientAdded.forEach(fn =>
			fn({
				close: () => {
					const client = this.clients.get(clientId)
					if (!client) return // client has already been closed

					client.close()
				},
				params: clientParams.params,
				query: clientParams.query,
				onClose: fn => {
					const client = this.clients.get(clientId)
					if (!client) return fn() // client has already been closed

					client.onClose(fn)
				},
				registerMethod,
			})
		)
	}

	private async handleMethodReq(
		method: string,
		fn: MethodListener,
		msg: MethodReq,
		paramsDescriptor: JsonDescriptor | null,
		clientId: string,
		{ params, query }: MatchPathResult
	) {
		const client = this.clients.get(clientId)
		if (!client) return false // connection with client closed before message was processed

		let pathParams: MatchPathResult['params'] = {}

		if (msg.method !== method) {
			if (!method.startsWith('/')) method = `/${method}`

			const res = matchPath(method, msg.method.startsWith('/') ? msg.method : `/${msg.method}`)
			if (!res) return false

			pathParams = res.params
		}

		const send = (msg: MethodRes) => client.send(JSON.stringify(msg))

		try {
			if (paramsDescriptor) validateParams(paramsDescriptor, msg.params)

			const res = await fn(msg.params, pathParams)

			send({
				epicalyx: '1.0',
				id: msg.id,
				type: 'method-res',
				result: (res as InnerJson) || null,
				error: null,
			})
		} catch (e) {
			const code = e.code && typeof e.code === 'string' ? e.code : 'INTERNAL_ERROR'

			if (code === 'INTERNAL_ERROR')
				this.callOnMethodError.forEach(fn =>
					fn({
						error: e,
						connectionQuery: query,
						connectionPathParams: params,
						reqMethod: msg.method,
						usedMethod: method,
						methodParams: msg.params,
					})
				)

			send({
				epicalyx: '1.0',
				id: msg.id,
				type: 'method-res',
				result: null,
				error: {
					code,
					message: code === 'INTERNAL_ERROR' ? 'Internal server error' : e.message,
				},
			})
		}

		return true
	}
}

function verifyMessage(msg: string) {
	const json = lazyParseJson(msg)
	if (!json) return null

	if (json.epicalyx !== '1.0') return null
	if (typeof json.type !== 'string') return null

	return json
}

function lazyParseJson(json: string) {
	try {
		return JSON.parse(json)
	} catch (_) {
		return null
	}
}

function validateParams(descriptor: JsonDescriptor, params: InnerJson) {
	const res = validateJson(descriptor, params)

	if (res.ok) return

	throw {
		code: 'USER_FAULT',
		message: `${res.errors[0].message}${res.errors[0].path.length ? `\n\tat '${res.errors[0].path}'` : ''}`,
	}
}
