import type { Middleware } from 'https://deno.land/x/oak@v6.5.0/mod.ts'
import { Json } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'

export interface WSClientParams {
	onMessage(message: string): void
	onClose(): void
	url: string
}

export interface WSClientResult {
	sendMessage(message: string): void
	close(): void
}

export type WSClient = (params: WSClientParams) => Promise<WSClientResult>

export interface WSServerParams {
	onClientAdded(params: ClientAddedParams): ClientAddedResult
	canAcceptSocket(path: string): Json | null
	supportsPath: string
	supportsResponse: Json
}

export interface ClientAddedParams {
	send(message: string): void
	close(): void
	clientParams: Json
}

export interface ClientAddedResult {
	onMessage(message: string): void
	onClose(): void
}

export type WSServer = (params: WSServerParams) => { oakMiddleware(): Middleware; listen(port: number): Promise<never> }
