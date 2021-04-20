import { ClientConnectionParams, ClientConnection } from './connection.ts'
import { MethodRes, MethodReq, EpicalyxMessageDown } from '../types.ts'
import { v4 } from 'https://deno.land/std@0.91.0/uuid/mod.ts'
import { InnerJson } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'

// deno-lint-ignore no-empty-interface
interface EpicalyxClientParams extends ClientConnectionParams {}

export class EpicalyxClient extends ClientConnection {
	private ongoingMethodCalls: Map<string, (msg: MethodRes) => void> = new Map()

	constructor(params: EpicalyxClientParams) {
		super(params)

		this.onMessage(msg => {
			this.handleMessage(msg)
		})
	}

	callMethod(method: string, params: unknown) {
		return new Promise<unknown>((resolve, reject) => {
			const id = v4.generate()

			this.ongoingMethodCalls.set(id, msg => {
				if (msg.error) reject(msg.error)
				else resolve(msg.result)
			})

			const requestMessage: MethodReq = {
				epicalyx: '1.0',
				type: 'method-req',
				id,
				method,
				params: params as InnerJson,
			}

			this.sendMessage(requestMessage)
		})
	}

	private handleMessage(msg: EpicalyxMessageDown) {
		if (msg.type === 'method-res') {
			const fn = this.ongoingMethodCalls.get(msg.id)
			if (!fn) return console.warn(`Received an unknown method response.  Ignoring...`)

			return fn(msg)
		}
	}
}
