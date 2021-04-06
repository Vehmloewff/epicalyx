# Epicalyx Spec

A standard for Websocket messages.

Clients connect to the server VIA Websocket connections. Servers are permitted to only listen on certain paths. Query parameters can be sent with the initial request.

The server upgrades the request to a Websocket. The client can now interact with the server using Epicalyx.

The client sends up a message to the server like the following:

```json
{
	"epicalyx": "1.0",
	"type": "method-req",
	"id": "2fcdafca-d32d-45fd-9b0b-b7ab8edcdf3f",
	"method": "sayHello",
	"params": "Vehmloewff"
}
```

The server must then send back a message like the following:

```json
{
	"epicalyx": "1.0",
	"type": "method-res",
	"id": "2fcdafca-d32d-45fd-9b0b-b7ab8edcdf3f",
	"result": "Hello, Vehmloewff!",
	"error": null
}
```

That part is very similar to JSON rpc.

To initiate a listen connection, the client must send up a message that looks like this.

```json
{
	"epicalyx": "1.0",
	"type": "listen-req",
	"id": "734cc11d-5d88-4f08-8cb5-c88f1bb401b5",
	"scope": "answers",
	"params": null
}
```

The server must then send down a message like this, indicating that the listening session is active

```json
{
	"epicalyx": "1.0",
	"type": "listen-res",
	"id": "734cc11d-5d88-4f08-8cb5-c88f1bb401b5",
	"error": null
}
```

The server can then beam down messages to the client like this. The client cannot send any more messages on this channel.

```json
{
	"epicalyx": "1.0",
	"type": "listen-beam",
	"id": "734cc11d-5d88-4f08-8cb5-c88f1bb401b5",
	"data": "foobar"
}
```

To request a data transmission, send the following message to the server:

```json
{
	"epicalyx": "1.0",
	"type": "transmission-req",
	"id": "635c6501-2b9a-463e-8eaf-96adf30ea26e",
	"resource": "foobar",
	"lastChangeTimestamp": null // 1 - 999999999999 (null means "no earlier versions stashed")
}
```

The server must then send down a response message to the transmission request.

```json
{
	"epicalyx": "1.0",
	"type": "transmission-res",
	"id": "635c6501-2b9a-463e-8eaf-96adf30ea26e",
	"status": "accepted", // or 'rejected' (if 'rejected', must include error field)
	"catchUpData": {
		"strategy": "replace",
		"data": "foobar",
		"last30Updates": {
			"6550734895134": [{ "indexes": [3, 3], "data": "bar" }]
		}
	}
}
```

If the client makes any updates to the data, it must notify the server of it.

```json
{
	"epicalyx": "1.0",
	"type": "transmission-update",
	"id": "635c6501-2b9a-463e-8eaf-96adf30ea26e",
	"timestamp": 1617319858590,
	"changes": [{ "indexes": [3, 3], "data": "-" }]
}
```

If the server makes any changes to the data, or any other clients to, it must beam down the changes to the client.

```json
{
	"epicalyx": "1.0",
	"type": "transmission-update",
	"id": "635c6501-2b9a-463e-8eaf-96adf30ea26e",
	"timestamp": 1617319879358,
	"changes": [{ "indexes": [3, 4], "data": "B" }]
}
```

The server must never issue a set of changes to the client that has a timestamp that is earlier than the timestamp of an update issued 30 issues ago.

The server can send down a message to a client to recall a certain update. This is because the timestamp of the update is too early, and past the update of the other clients' 30th issue. This is basically the server saying, "Look, Client. Your change is too old to be incorporated into the resource, so go ahead and remove it from your version." Alternatively, the client can just change the timestamp of the update to the current one, and re-post the update.

```json
{
	"epicalyx": "1.0",
	"type": "transmission-update-recall",
	"id": "635c6501-2b9a-463e-8eaf-96adf30ea26e",
	"changeTimestamp": 1617319845278,
	"changeIndex": 0 // Only really necessary if there is more than one change in this particular millisecond
}
```

**Conflict resolution**

Changes are always inserted in the order of which change's time-stamp came first. If the timestamps are exactly the same, the change with the lower start index is inserted first. If they are exactly the same the change with the lower end index in inserted first. If they are exactly the same, the change with the 'data' property that comes first alphabetically is inserted first. If they data property of the changes are exactly the same, one of the changes can be omitted, as they are identical.

The server must never accept updates that, when ordered, or more than 30 changes old.

These procedures ensure that all distributions of the resource remain completely identical.

**Errors**

Any of the `*-res` type messages can have an error property, which must contain the `code` and `message` properties.

`code` can be any string, including: `INTERNAL_ERROR`, `FORBIDDEN`, `USER_FAULT`.

**Closing**

Before the server closes a connection between itself and a client, it must send down a message like this:

```json
{
	"epicalyx": "1.0",
	"type": "connection-closing",
	"code": "RE_AUTH", // anything can be here
	"reason": "Client needs to be re-authorized"
}
```

If a message is not received by the client before the connection closes, the client is expected to re-attempt the connection.

**Support**

Servers that support Epicalyx should respond when a request is sent to `/supports-epicalyx-v1`.

```json
{
	"epicalyx": "1.0",
	"docs": "You can find out how to use epicalyx with this server [online](https://example.com/server-docs)."
}
```
