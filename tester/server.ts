import { EpicalyxServer } from '../server.ts'
import { makeDenoWsServer } from '../ws/deno.ts'

const docs = `You can find out how to use epicalyx with this server [online](https://example.com/server-docs).`

const epicalyx = new EpicalyxServer({ server: makeDenoWsServer(), docs, pathPattern: '/user/{id}' })

epicalyx.onClientAdded(({ registerMethod }) => {
	registerMethod('sayHello', (name: string) => {
		return `Hello, ${name}!`
	}).validateParams({ type: 'string' })
})

epicalyx.server.listen(5000)
