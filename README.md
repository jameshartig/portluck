# Portluck #

Accepts arbitrary data on a single port via HTTP, HTTPS, WebSockets, or a TCP socket.

## portluck.Server ##

### new portluck.Server([messageCallback][, options]) ###
Creates a new server that inherits [https.Server](https://nodejs.org/api/https.html#https_class_https_server).
If `messageCallback` is sent, it will be added as a listener for `"message"` event.

### Event: 'message' ###
Fired when a client sends a message. Event is sent `(message, writer, socket)`. `message` is a buffer containing
the message received. `writer` is an instance of `ResponseWriter` and can be used to respond to the message.
`socket` is the source socket that sent the message. You should only read properties off the socket, like
`remoteAddress` and not use the `write`/`end` methods.

### Event: 'clientConnect' ###
Fired when a client connects. Event is sent `(writer, socket)`. You should only read properties off the socket,
like `remoteAddress` and not use the `write`/`end` methods. `writer` is an instance of `ResponseWriter` can be
used to respond. The `writer` has `write`, `end`, and `destroy` methods.

### Event: 'clientDisconnect' ###
Fired when a client disconnects. Event is sent `socket` which is the socket that disconnected.

### server.listen(port [,callback]) ###
Accepts the same parameters and options as [http.Server.listen](http://nodejs.org/api/http.html#http_server_listen_port_hostname_backlog_callback).


## ResponseWriter ##

### writer.write(message) ###
Writes `message` to the underlying source socket. `message` can be a string or Buffer. If you plan on
responding to messages asynchronously, you should call `doneAfterWrite` since HTTP/HTTPS requests are
automatically closed on the next tick (unless you sent `explicitDone` option).

### writer.doneAfterWrite() ###
If an automatic `done()` is scheduled to happen next tick, calling `doneAfterWrite` prevents that from
happening and waits to automatically call done until the next `write()`. This is not needed if you created
the server with the `explicitDone` option.

### writer.done([message]) ###
Writes `message`, if passed, to the underlying source socket. If the source was a HTTP/HTTPS request, it is
`end`ed and a response is sent. No more writes are allowed on this writer.

### writer.end() ###
Closes (by sending a FIN) the underlying source socket. No more writes are allowed on this writer.

### writer.destroy() ###
Immediately closes the underlying source socket. Similar to `socket.destroy()` No more writes are allowed
on this writer.


## Options ##

### rawFallback ###
Boolean for whether we should fallback to a raw socket connetion if http/tls/websocket isn't detected.

### timeout ###
See [net.Server.timeout](https://nodejs.org/api/http.html#http_server_timeout). Defaults to 2 minutes.
Note: We wait 2 seconds to try and wait for bytes to determine what type of connection it is. Your `timeout
applies AFTER that if no data is sent immediately.

### allowOrigin ###
Origin to respond with `Allow-Access-Control-Origin` for. Value can be a string or RegExp. String values can
contain a single `*` for wildcard matching `[a-zA-Z0-9_-]`. **Do not add a protocol (like `https://`).**
Note: `*.example.com` is special and matches `example.com`, `www.example.com`, and `www.staging.example.com`.

### explicitDone ###
If set to `true` you are **required** to call `writer.done()` on every message received. By default, messages are
done on the nextTick after firing `'message'` event.

## Todo ##

* Support UDP sockets as well

By [James Hartig](https://github.com/fastest963/)
