# Portluck #

Accepts arbitrary data on a single port via HTTP, WebSockets, or a TCP socket.

### new portluck.Server([messageCallback][, options]) ###
Creates a new server that inherits [https.Server](https://nodejs.org/api/https.html#https_class_https_server).
If `messageCallback` is sent, it will be added as a listener for `"message"` event.

### Event: 'message' ###
Fired when a client sends a message. Event is sent `(message, socket, writer)`. `message` is a buffer containing
the message received. `socket` is the socket that sent the message. You should only read properties off the socket,
like `remoteAddress` and not use the `write`/`end` methods. `writer` is sent last and can be used to respond to the
message. The `writer` has `write`, `end`, and `destroy` methods.

### Event: 'clientConnect' ###
Fired when a client connects. Event is sent `(socket, writer)` which is the socket that connected. You should only
read properties off the socket, like `remoteAddress` and not use the `write`/`end` methods. `writer` is sent last
and can be used to respond. The `writer` has `write`, `end`, and `destroy` methods.

### Event: 'clientDisconnect' ###
Fired when a client disconnects. Event is sent `socket` which is the socket that disconnected.

### server.listen(port [,callback]) ###
Accepts the same parameters and options as [http.Server.listen](http://nodejs.org/api/http.html#http_server_listen_port_hostname_backlog_callback).

## Options ##

### rawFallback ###
Boolean for whether we should fallback to a raw socket connetion if http/tls/websocket isn't detected or on timeout.

### timeout ###
See [net.Server.timeout](https://nodejs.org/api/http.html#http_server_timeout). Defaults to 2 minutes.
Note: We wait 3 seconds to fallback to raw socket if no data is sent immediately after opening a connection. Your
`timeout` applies AFTER that if no data is sent immediately.

### allowOrigin ###
Origin to respond with `Allow-Access-Control-Origin` for. Value can be a string or RegExp. String values can contain
a single `*` for wildcard matching `[a-zA-Z0-9_-]`. **Do not add a protocol (like `https://`).**
Note: `*.example.com` is special and matches `example.com`, `www.example.com`, and `www.staging.example.com`.

## Todo ##

* Do not require the first socket character to be "{"
* Look at the full line to determine if HTTP connection instead of the first word
* Support UDP sockets as well

By [James Hartig](https://github.com/fastest963/)
