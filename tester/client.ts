import { EpicalyxClient } from '../client.ts'
import { makeDomWsClient } from '../ws/dom.ts'
import {
	appRoot,
	makeDivision,
	makeHeader,
	makeParagraph,
	makeTextField,
	storable,
	makeSpacer,
	makeVerticalSpacer,
	makeButton,
	makeCodeBlock,
	derive,
	renderMarkdown,
} from 'https://denopkg.com/Vehmloewff/deb@v0/mod.ts'
import { jsonStringify, jsonParse, delay } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'

const epicalyx = new EpicalyxClient(makeDomWsClient())
const url = storable('ws://localhost:5000')
const docsMeta = storable('')

appRoot().$(
	makeDivision()
		.style({ maxWidth: '600px', margin: 'auto' })
		.$(
			makeHeader(1).style({ textAlign: 'center' }).$('Epicalyx Messenger'),
			makeParagraph().$('Hope it works!'),
			makeTextField(url, {
				label: 'Endpoint',
				help: epicalyx.statusText,
				error: derive(epicalyx.statusCode, code => code < 0),
			}).on({
				input() {
					epicalyx.setUrl(url.get())
				},
			}),
			makeSpacer(30),
			renderMarkdown(docsMeta),
			makeSpacer(30),
			makeDivision()
				.style({ display: derive(epicalyx.connected, c => (c ? 'block' : 'none')) })
				.$(makeMethodTester())
		)
)

let connectionInProgress = false
async function connectToServer(): Promise<void> {
	if (connectionInProgress) return
	connectionInProgress = true

	const { supportsEpicalyx, docs } = await epicalyx.checkSupport()

	if (docs.length) docsMeta.set(docs)

	if (!supportsEpicalyx) {
		await delay(3000)
		return connectToServer()
	}

	await epicalyx.connect()

	connectionInProgress = false
}

function makeMethodTester() {
	const method = storable('sayHello')
	const sendingMessage = storable(false)
	const params = storable('{ "name": "World" }')
	const response = storable('')
	const didError = storable(false)

	async function callMethod() {
		sendingMessage.set(true)
		response.set('')

		const res = await epicalyx.callMethod(method.get(), jsonParse(params.get())).catch(e => {
			didError.set(true)
			return e
		})

		response.set(jsonStringify(res, '\t'))
		sendingMessage.set(false)
	}

	return makeDivision().$(
		makeDivision()
			.style({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' })
			.$(
				makeTextField(method, { label: 'Method' }).style({ flexGrow: '1' }),
				makeVerticalSpacer(20),
				makeButton('Call', { large: true, disabled: sendingMessage }).on({ click: () => callMethod() })
			),
		makeSpacer(20),
		makeTextField(params, { label: 'Params', multiline: true }),
		makeSpacer(40),
		makeCodeBlock(response, 'json')
	)
}

setTimeout(() => {
	epicalyx.setUrl(url.get())
	connectToServer()
}, 1000)
