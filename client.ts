import { WSClient, WSClientResult } from './ws/types.ts'
import { derive, storable } from 'https://deno.land/x/storable@1.0.1/mod.ts'
import { InnerJson, delay } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'
import { MethodRes, EpicalyxMessageDown, MethodReq } from './types.ts'
import { v4 } from 'https://deno.land/std@0.91.0/uuid/mod.ts'

export class EpicalyxClient {
	private wsClient: WSClient
	private wsClientResult: WSClientResult | null = null
	private shouldConnectAtAll = false

	private ongoingMethodCalls: Map<string, (msg: MethodRes) => void> = new Map()

	protected currentUrl: string | null = null

	timeout = 3000
	statusCode = storable(0)
	connected = derive(this.statusCode, code => code === 4)
	isOff = derive(this.statusCode, code => code === 0)
	statusText = derive(this.statusCode, code => {
		const seconds = this.timeout / 1000
		const retryMessage = `Retrying in ${seconds} second${seconds === 1 ? '' : 's'}...`

		if (code === -5) return `Could not open a websocket connection with host. ${retryMessage}`
		if (code === -4) return 'Server does not support Epicalyx.'
		if (code === -3) return 'Server did not respond.'
		if (code === -2) return `URL must start with 'ws:' or 'wss:'.`
		if (code === -1) return 'Invalid URL.'
		if (code === 0) return 'Not connected.'
		if (code === 1) return 'Checking host support...'
		if (code === 2) return 'Host supports Epicalyx!'
		if (code === 3) return 'Connecting...'
		if (code === 4) return 'Connected!'
		if (code === 5) return `Disconnected.  ${retryMessage}`

		return `Unknown code: ${code}`
	})

	constructor(wsClient: WSClient) {
		this.wsClient = wsClient
	}

	setUrl(url: string) {
		if (this.currentUrl === url) return

		if (this.connected.get()) this.turnOff(true)

		try {
			const parsed = new URL(url)
			if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') this.statusCode.set(-2)
			else this.currentUrl = url
		} catch (e) {
			this.statusCode.set(-1)
		}
	}

	getCurrentUrl() {
		return this.currentUrl
	}

	/**
	 * Checks the support the server has for epicalyx.
	 * Changes the 'statusCode' storable to match the current status.
	 */
	async checkSupport() {
		if (!this.currentUrl) throw new Error(`'setUrl' must be called before 'checkSupport' or 'connect'`)

		let supportsEpicalyx = false
		let docs = ``
		let serverDoesRespond = false

		this.statusCode.set(1)

		const url = new URL(this.currentUrl)
		const reqUrl = `http${url.protocol === 'wss:' ? 's' : ''}://${url.host}/supports-epicalyx-v1`

		try {
			await Promise.race([
				fetch(reqUrl).then(async res => {
					serverDoesRespond = true
					if (!res.ok) return

					const json = await res.json()

					if (json.epicalyx === '1.0') {
						supportsEpicalyx = true
						docs = json.docs
					}
				}),
				delay(this.timeout),
			])
		} catch (e) {
			// Do nothing
		}

		if (!serverDoesRespond) this.statusCode.set(-3)
		else if (!supportsEpicalyx) this.statusCode.set(-4)
		else this.statusCode.set(2)

		return {
			supportsEpicalyx,
			docs,
			serverDoesRespond,
		}
	}

	async connect() {
		if (!this.currentUrl) throw new Error(`'setUrl' must be called before 'checkSupport' or 'connect'`)
		if (this.connected.get()) this.turnOff()

		this.shouldConnectAtAll = true // enable reconnects

		this.statusCode.set(3)

		let connected = false
		let aborted = false

		try {
			await Promise.race([
				this.wsClient({
					url: this.currentUrl,
					onMessage: msg => {
						this.handleMessage(msg)
					},
					onClose: () => {
						this.statusCode.set(5)
						this.reconnect()
					},
				}).then(res => {
					// 'this.turnOff' might have been called while the above promise was running.
					if (this.shouldConnectAtAll) {
						this.wsClientResult = res
						connected = true
					}
					// If it was, abort the connection.
					else {
						res.close()
						aborted = true
					}
				}),
				delay(this.timeout),
			])
		} catch (e) {
			// do nothing
		}

		if (aborted) return

		if (!connected) {
			this.statusCode.set(-5)
			this.reconnect()
		} else this.statusCode.set(4)
	}

	turnOff(canReconnect = false) {
		this.shouldConnectAtAll = canReconnect
		if (this.wsClientResult) this.wsClientResult.close()
		this.connected.set(false)
		this.statusCode.set(0)
	}

	/**
	 * Calls an epicalyx method registered on the server
	 */
	callMethod(method: string, params: unknown) {
		return new Promise<unknown>((resolve, reject) => {
			const id = v4.generate()

			this.ongoingMethodCalls.set(id, msg => {
				if (msg.error) reject(msg.error)
				else resolve(msg.result)
			})

			let initiallyConnected = false
			const unsubscribe = this.connected.subscribe((connected, initial) => {
				if (connected) {
					if (initial) initiallyConnected = true
					else unsubscribe()
				}

				if (!this.wsClientResult) throw new Error(`Internal error: this.wsClientResult was not set when connected.`)

				const requestMessage: MethodReq = {
					epicalyx: '1.0',
					type: 'method-req',
					id,
					method,
					params: params as InnerJson,
				}

				this.wsClientResult.sendMessage(JSON.stringify(requestMessage))
			})

			if (initiallyConnected) unsubscribe()
		})
	}

	listen() {
		// todo
	}

	transmit() {
		// todo
	}

	private reconnect() {
		setTimeout(() => {
			if (this.shouldConnectAtAll) this.connect()
		}, this.timeout)
	}

	private handleMessage(data: string) {
		const message = this.parseMessage(data)
		if (!message) return

		if (message.type === 'method-res') {
			const fn = this.ongoingMethodCalls.get(message.id)
			if (fn) fn(message)
			else console.warn('Received an un-requested method response.', message)
		}
	}

	private parseMessage(message: string): EpicalyxMessageDown | null {
		// deno-lint-ignore no-explicit-any
		let json: any

		try {
			json = JSON.parse(message)
		} catch (e) {
			console.warn(`Failed to parse incoming message:`, e, 'Message:', message, 'Ignoring...')
		}

		if (!json) return null

		if (json.epicalyx !== '1.0') {
			console.warn(`A message was received that Epicalyx does not support:`, json, 'Ignoring...')
			return null
		}

		return json
	}
}
