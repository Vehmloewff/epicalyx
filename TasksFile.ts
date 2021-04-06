import { sh } from 'https://denopkg.com/Vehmloewff/deno-utils/mod.ts'

export async function runTests() {
	await Deno.mkdir('out', { recursive: true })
	await Deno.writeTextFile(
		'out/index.html',
		`<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta http-equiv="X-UA-Compatible" content="IE=edge">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<link href="https://necolas.github.io/normalize.css/8.0.1/normalize.css" rel="stylesheet">
		<title>Example</title>
		<script defer src="bundle.js"></script>
	</head>
	<body>
		
	</body>
	</html>`,
		{ create: true }
	)

	sh(`deno run -A --watch --unstable tester/server.ts`)
	sh(`deno bundle --unstable --watch --no-check tester/client.ts out/bundle.js`)
}
