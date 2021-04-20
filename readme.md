# Epicalyx (WIP)

A standard for Websocket messages.

The specifications are [here](./spec.md).

## Server Usage

```ts
const epicalyx = new EpicalyxServer({
	docs: 'TODO: something about how to use these epicalyx methods',
	pathPattern: '/', // Accept connections at this path
})

epicalyx.onClientAdded(({ registerMethod }) => {
	registerMethod('sayHello', name => {
		return `Hello, ${name}!`
	}).validateParams({ type: 'string' })
})

await epicalyx.listen(3000)
```

## Client Usage

```ts
const epicalyx = new EpicalyxClient({
	shouldRetryConnection(disconnectCode) {
		// ...
	},
	url: 'ws://localhost:3000',
})

await epicalyx.turnOn()

const greeting = epicalyx.callMethod('sayHello', 'Vehmloewff')
// -> Hello, Vehmloewff!

epicalyx.turnOff()
```

## Development

```sh
git clone https://github.com/Vehmloewff/epicalyx
alias dirt="deno run -A --unstable https://denopkg.com/Vehmloewff/dirt@v1/cli.ts TasksFile.ts"
dirt runTests
```
