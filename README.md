# Portluck #

Accepts arbitrary data on a single port via HTTP, WebSockets, or a TCP socket.

### new portluck.Server(messageCallback) ###
Creates a new server that inherits [http.Server](http://nodejs.org/api/http.html#http_class_http_server).
If `messageCallback` is sent, it will be added as a listener for `"message"` event.

### Event: 'message' ###
Fired when a client sends a message. Event is sent `(message, socket, writer)`. `message` is a buffer containing
the message received. `socket` is the socket that sent the message. You should only read properties off the socket,
like `remoteAddress` and not use the `write`/`end` methods. `writer` is sent last and can be used to respond to the
message. The `writer` has `write`, `end`, and `destroy` methods.

### Event: 'clientConnect' ###
Fired when a client connects. Event is sent `(socket, writer)` which is the socket that connected. `You should only
read properties off the socket, like `remoteAddress` and not use the `write`/`end` methods. `writer` is sent last
and can be used to respond. The `writer` has `write`, `end`, and `destroy` methods.

### Event: 'clientDisconnect' ###
Fired when a client disconnects. Event is sent `socket` which is the socket that disconnected.

### server.listen(port [,callback]) ###
Accepts the same parameters and options as [http.Server.listen](http://nodejs.org/api/http.html#http_server_listen_port_hostname_backlog_callback).

## Todo ##

* Do not require the first socket character to be "{"
* Default to TCP socket after a certain amount of milliseconds
* Look at the full line to determine if HTTP connection instead of the first char
* Support UDP sockets as well

By [James Hartig](https://github.com/fastest963/)