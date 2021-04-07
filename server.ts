import { WSServer, ClientAddedParams, ClientAddedResult } from './ws/types.ts'
import { matchPath, Json, MatchPathResult, InnerJson, JsonDescriptor, validateJson } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'
import { MethodRes, MethodReq, EpicalyxMessageUp } from './types.ts'

// deno-lint-ignore no-explicit-any
export type LazyMessageType = any

export interface OnClientAddedParams extends MatchPathResult {
	registerClient(id: string): void
	onClose(fn: () => void): void
	registerMethod(method: string, onCalled: (data: LazyMessageType) => Promise<InnerJson> | InnerJson): RegisterMethodResult
	// registerEmitter(scope: string, onCalled: (data: InnerJson, emit: (message: InnerJson) => void) => Promise<boolean> | boolean): void
	// registerTransmitter(resourceName: string): string // TODO: FINISH
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
	close(): void
}

export class EpicalyxServer {
	private callOnClientAdded: ((params: OnClientAddedParams) => void)[] = []

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

	private handleNewClient({ clientParams, close, send }: ClientAddedParams): ClientAddedResult {
		const callOnClose: (() => void)[] = []
		const methods: Map<string, (message: MethodReq) => void> = new Map()

		const { params, query } = (clientParams as unknown) as MatchPathResult

		const registerClient = (id: string) => {
			this.clients.push({ id, close })
		}

		const onClose = (fn: () => void) => {
			callOnClose.push(fn)
		}

		const registerMethod: OnClientAddedParams['registerMethod'] = (method, fn) => {
			const paramsValidators: ((data: InnerJson) => void)[] = []

			methods.set(method, async msg => {
				try {
					paramsValidators.forEach(validator => validator(msg.params))

					const res = await fn(msg.params)
					const responseMessage: MethodRes = {
						epicalyx: '1.0',
						id: msg.id,
						type: 'method-res',
						result: res,
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
						console.error(
							`Method '${method}' threw an unrecognizable error.  Request params:`,
							msg.params,
							'WS connection params:',
							params,
							'WS connection query:',
							query,
							'Error:',
							e
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

		this.callOnClientAdded.forEach(fn =>
			fn({
				params,
				query,
				registerClient,
				onClose,
				registerMethod,
			})
		)

		function onMessage(message: string) {
			const msg = JSON.parse(message) as EpicalyxMessageUp
			if (msg.epicalyx !== '1.0') return

			if (msg.type === 'method-req') {
				const func = methods.get(msg.method)

				if (!func) {
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

				func(msg)
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
}
