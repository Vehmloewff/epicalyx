import { EpicalyxMessageDown, EpicalyxMessageUp } from '../types.ts'
import { derive, storable } from 'https://deno.land/x/storable@1.0.1/mod.ts'
import { delay } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'

export interface ClientConnectionParams {
	shouldRetryConnection(disconnectCode: string, disconnectReason: string): boolean
	url: string

	/** @default 3000 */
	retryTimeout?: number
}

type MessageListener = (msg: EpicalyxMessageDown) => unknown

const DEFAULT_TIMEOUT = 3000

export class ClientConnection {
	private ws: WebSocket | null = null
	private callOnMessageReceived: MessageListener[] = []
	private params: ClientConnectionParams

	docs = ''
	pathExtension = ''

	statusCode = storable(0)
	connected = derive(this.statusCode, code => code === 4)
	isOff = derive(this.statusCode, code => code === 0)
	statusText = derive(this.statusCode, code => {
		const seconds = (this.params?.retryTimeout || DEFAULT_TIMEOUT) / 1000
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

	constructor(params: ClientConnectionParams) {
		this.params = params
	}

	async turnOn() {
		if (this.statusCode.get() !== 0) return

		await this.checkSupport()
		this.connect()
	}

	turnOff() {
		if (this.statusCode.get() === 0) return

		this.statusCode.set(0)
		this.close()
	}

	onMessage(fn: MessageListener) {
		this.callOnMessageReceived.push(fn)
	}

	sendMessage(msg: EpicalyxMessageUp) {
		const sendMessage = () => {
			if (!this.ws) throw new Error(`'connected' is off sync`)

			this.ws.send(JSON.stringify(msg))
		}

		if (this.connected.get()) return sendMessage()

		// It is actually used
		// deno-lint-ignore no-unused-vars
		const unsubscribe = this.connected.subscribe(connected => {
			if (!connected) return

			sendMessage()
			unsubscribe()
		})
	}

	private connect() {
		this.ws = new WebSocket(this.params.url + this.pathExtension)

		this.ws.onmessage = ({ data }) => {
			if (typeof data === 'string') {
				const json = betterErrorsJsonParse(data)
				return this.handleJsonMessage(json)
			}

			console.warn(`Received incoming message of unknown type: '${typeof data}'.  Ignoring...`)
		}

		this.ws.onopen = () => {
			this.statusCode.set(4)
		}

		this.ws.onerror = () => {
			this.closed('ERROR_CONNECT', 'There was an error while opening a ws connection with the server')
		}

		this.ws.onclose = () => {
			this.closed('CONNECTION_CLOSED', 'The connection was unexpectedly and unexplainably closed')
		}
	}

	async checkSupport() {
		let supportsEpicalyx = false
		let docs = ``
		let serverDoesRespond = false

		this.statusCode.set(1)

		const url = new URL(this.params.url)
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
				delay(this.params.retryTimeout || DEFAULT_TIMEOUT),
			])
		} catch (_) {
			// Do nothing
		}

		if (!serverDoesRespond) this.statusCode.set(-3)
		else if (!supportsEpicalyx) this.statusCode.set(-4)
		else this.statusCode.set(2)

		this.docs = docs

		return supportsEpicalyx
	}

	private closed(code: string, reason: string) {
		const shouldRetry = this.params.shouldRetryConnection(code, reason)

		if (!shouldRetry) return this.statusCode.set(0)

		if (code === 'ERROR_CONNECT') this.statusCode.set(-5)
		else this.statusCode.set(5)

		setTimeout(() => {
			this.connect()
		}, this.params.retryTimeout || DEFAULT_TIMEOUT)
	}

	private close() {
		if (this.ws) this.ws.close()
	}

	private handleJsonMessage(msg: EpicalyxMessageDown) {
		if (msg.type === 'connection-closing') {
			this.close()
			this.closed(msg.code, msg.reason)

			return
		}

		this.callOnMessageReceived.forEach(fn => fn(msg))
	}
}

function betterErrorsJsonParse(json: string) {
	try {
		return JSON.parse(json)
	} catch (e) {
		throw new Error(`Could not parse incoming JSON message: ${e}\nDUMP: ${json}`)
	}
}
