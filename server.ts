import { WSServer, ClientAddedParams, ClientAddedResult } from './ws/types.ts'
import { matchPath, Json, MatchPathResult, InnerJson, JsonDescriptor, validateJson } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'
import { MethodRes, MethodReq, EpicalyxMessageUp, ConnectionClosing } from './types.ts'

// deno-lint-ignore no-explicit-any
export type LazyMessageType = any
export type ErrorType = any

export interface OnClientAddedParams extends MatchPathResult {
	registerClient(id: string): void
	onClose(fn: () => void): void

	close(params: CloseParams): void

	registerMethod(
		method: string,
		onCalled: (data: LazyMessageType, pathParams: MatchPathResult['params']) => Promise<unknown | void> | unknown | void
	): RegisterMethodResult
	// registerEmitter(scope: string, onCalled: (data: InnerJson, emit: (message: InnerJson) => void) => Promise<boolean> | boolean): void
	// registerTransmitter(resourceName: string): string // TODO: FINISH
}

export interface CloseParams {
	code: string
	reason: string
}

export interface RegisterMethodResult {
	validateParams(descriptor: JsonDescriptor): void
}

export interface EpicalyxServerParams {
	docs: string
	server: WSServer
	pathPattern: string
}

export interface ClientRepInServer {
	id: string
	close(params: CloseParams): void
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

	clients: ClientRepInServer[] = []
	server: ReturnType<WSServer>

	constructor(params: EpicalyxServerParams) {
		this.server = params.server({
			canAcceptSocket: path => matchPath(params.pathPattern, path) as Json | null,
			onClientAdded: params => this.handleNewClient(params),
			supportsPath: '/supports-epicalyx-v1',
			supportsResponse: { epicalyx: '1.0', docs: params.docs },
		})
	}

	private handleNewClient({ clientParams, close: closeSocket, send }: ClientAddedParams): ClientAddedResult {
		const callOnClose: (() => void)[] = []
		const methods: Map<string, (message: MethodReq, pathParams: MatchPathResult['params']) => void> = new Map()

		const { params, query } = (clientParams as unknown) as MatchPathResult

		const close = ({ code, reason }: CloseParams) => {
			const closeMessage: ConnectionClosing = {
				epicalyx: '1.0',
				type: 'connection-closing',
				code,
				reason,
			}

			send(JSON.stringify(closeMessage))

			closeSocket()
		}

		const registerClient = (id: string) => {
			this.clients.push({ id, close })
		}

		const onClose = (fn: () => void) => {
			callOnClose.push(fn)
		}

		const registerMethod: OnClientAddedParams['registerMethod'] = (method, fn) => {
			const paramsValidators: ((data: InnerJson) => void)[] = []

			methods.set(method, async (msg, pathParams) => {
				try {
					paramsValidators.forEach(validator => validator(msg.params))

					const res = await fn(msg.params, pathParams)
					const responseMessage: MethodRes = {
						epicalyx: '1.0',
						id: msg.id,
						type: 'method-res',
						result: (res as InnerJson) || null,
						error: null,
					}

					send(JSON.stringify(responseMessage))
				} catch (e) {
					const code = e.code && typeof e.code === 'string' ? e.code : 'INTERNAL_ERROR'

					const responseMessage: MethodRes = {
						epicalyx: '1.0',
						id: msg.id,
						type: 'method-res',
						result: null,
						error: {
							code,
							message: code === 'INTERNAL_ERROR' ? 'Internal server error' : e.message,
						},
					}

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

					send(JSON.stringify(responseMessage))
				}
			})

			return {
				validateParams(descriptor) {
					paramsValidators.push(data => {
						const res = validateJson(descriptor, data)
						if (!res.ok)
							throw {
								code: 'USER_FAULT',
								message: `${res.errors[0].message}${res.errors[0].path.length ? `\n\tat '${res.errors[0].path}'` : ''}`,
							}
					})
				},
			}
		}

		this.callOnClientAdded.forEach(async fn => {
			try {
				await fn({
					params,
					query,
					close,
					registerClient,
					onClose,
					registerMethod,
				})
			} catch (e) {
				const code = e.code && typeof e.code === 'string' ? e.code : 'INTERNAL_ERROR'
				const reason = code === 'INTERNAL_ERROR' ? 'Internal server error' : e.message

				close({ code, reason })

				if (code === 'INTERNAL_ERROR')
					this.callOnClientAddedError.forEach(fn =>
						fn({
							connectionPathParams: params,
							connectionQuery: query,
							error: e,
						})
					)
			}
		})

		function onMessage(message: string) {
			const msg = JSON.parse(message) as EpicalyxMessageUp
			if (msg.epicalyx !== '1.0') return

			if (msg.type === 'method-req') {
				const func = methods.get(msg.method)

				if (!func) {
					let didFindMatch = false

					for (const [methodPattern, func] of methods.entries()) {
						const params = matchPath(methodPattern, msg.method)

						if (!params) continue

						func(msg, params.params)
						didFindMatch = true
					}

					if (didFindMatch) return

					const responseMessage: MethodRes = {
						epicalyx: '1.0',
						id: msg.id,
						type: 'method-res',
						result: null,
						error: {
							code: 'METHOD_NOT_FOUND',
							message: `Method '${msg.method}' was not found`,
						},
					}

					return send(JSON.stringify(responseMessage))
				}

				func(msg, {})
			}
		}

		return {
			onClose() {
				callOnClose.forEach(fn => fn())
			},
			onMessage,
		}
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
}
