var net = require('net'),
    http = require('http'),
    util = require('util'),
    DelimiterStream = require('delimiterstream'),
    WebSocket = require('ws'),
    parentEmit;

var _CR_ = "\r".charCodeAt(0),
    _LF_ = "\n".charCodeAt(0),
    _SPACE_ = " ".charCodeAt(0),
    _OBRACKET_ = "{".charCodeAt(0),
    //all the first letters of possible HTTP methods (from http_parser.c line 923)
    _METHODSSTR_ = "DGHLMNOPRSTU",
    _METHODS_ = new Array(12),
    i;
for (i = 0; i < 12; i++) {
    _METHODS_[i] = _METHODSSTR_.charCodeAt(i);
}

function ResponseWriter(client) {
    this._client = client;
    if (!this._client) {
        throw new TypeError('Invalid client sent to ResponseWriter');
    }
    this._encoding = undefined;
}
ResponseWriter.prototype.setDefaultEncoding = function(encoding) {
    if (encoding === 'binary' || encoding === 'buffer') {
        this._encoding = 'buffer';
        return;
    }
    if (encoding === null){
        encoding = undefined;
    }
    this._encoding = encoding;
};
ResponseWriter.prototype.write = function(message) {
    if (this._client instanceof WebSocket) {
        var options = {binary: false};
        if (this._encoding === undefined) {
            options.binary = (message instanceof Buffer);
        } else if (this._encoding === 'buffer') {
            options.binary = true;
        }
        this._client.send(message, options);
        return;
    }
    this._client.write(message, this._encoding);
};
ResponseWriter.prototype.end = function() {
    if (this._client instanceof WebSocket) {
        this._client.close();
        return;
    }
    this._client.end();
};
ResponseWriter.prototype.destroy = function() {
    if (this._client instanceof WebSocket) {
        this._client.terminate();
        return;
    }
    this._client.destroy();
};

function onConnection(server, socket) {
    var isHTTP = false,
        isRaw = false,
        isError = false;

    //set our timeout to something really low so we don't wait forever for the first byte
    socket.setTimeout(Math.min(server.timeout, 30 * 1000));
    socket.once('timeout', function() {
        if (!socket.ended) {
            socket.destroy();
        }
    });

    //since the http server is setup with allowHalfOpen, we need to end when we get a FIN
    socket.once('end', function() {
        if (!socket.ended) {
            socket.end();
        }
    });

    socket.on('data', function onData(data) {
        //data is a buffer
        for (var i = 0; i < data.length; i++) {
            //ignore these
            if (data[i] === _CR_ || data[i] === _LF_ || data[i] === _SPACE_) {
                continue;
            }
            //check to see if its a { (start of json blob) or if its one of the HTTP methods
            //otherwise its an error
            if (data[i] === _OBRACKET_) {
                isRaw = true;
                break;
            }
            //if you trust benchmarks then switch is faster than indexOf: http://jsperf.com/switch-vs-array/8
            switch (data[i]) {
                case _METHODS_[0]:
                case _METHODS_[1]:
                case _METHODS_[2]:
                case _METHODS_[3]:
                case _METHODS_[4]:
                case _METHODS_[5]:
                case _METHODS_[6]:
                case _METHODS_[7]:
                case _METHODS_[8]:
                case _METHODS_[9]:
                case _METHODS_[10]:
                case _METHODS_[11]:
                    isHTTP = true;
                    break;
                default:
                    console.log("Unexpected " + data[i]);
                    isError = true;
                    break;
            }
            //at this point its either expected or its isHTTP
            break;
        }
        if (isError) {
            if (!socket.ended) {
                socket.destroy();
            }
            return;
        }
        if (!isHTTP && !isRaw) {
            return;
        }

        //clean up our listener before we pass onto http/raw sockets
        socket.removeListener('data', onData);

        //if somehow the socket ended already just bail
        if (!socket.readable || !socket.writable || socket.ended) {
            if (!socket.ended) {
                socket.end();
            }
            return;
        }
        //set the timeout now to the value the user wants
        socket.setTimeout(server.timeout);
        if (isHTTP) {
            httpConnectionListener(server, socket);
        } else {
            rawConnectionListener(server, socket);
        }
        //re-send our data we just got to emulate this listener
        //ondata is for backwards-compatibility with 0.10.x
        if (typeof socket.ondata === 'function') {
            socket.ondata(data, 0, data.length);
        } else {
            socket.emit('data', data);
        }
    });
}

function emitConnect(server, socket, writer) {
    parentEmit.call(server, 'clientConnect', socket, writer);
}
function emitDisconnect(server, socket) {
    parentEmit.call(server, 'clientDisconnect', socket);
}

function onNewClient(server, socket, writer) {
    emitConnect(server, socket, writer);
    socket.once('close', function() {
        //clean up any listeners on data since we already sent that we're disconnected
        socket.removeAllListeners('data');
        emitDisconnect(server, socket);
    });
}
//for http we need to listen for close on the socket and NOT the listener >_<
function onNewHTTPClient(server, listener, socket, writer) {
    emitConnect(server, socket, writer);
    socket.once('close', function() {
        //clean up any listeners on data since we already sent that we're disconnected
        listener.removeAllListeners('data');
        emitDisconnect(server, socket);
    });
}
function onNewWSClient(server, listener, socket, writer) {
    emitConnect(server, socket, writer);
    listener.once('close', function() {
        //clean up any listeners on data since we already sent that we're disconnected
        listener.removeAllListeners('message');
        emitDisconnect(server, socket);
    });
}

function httpConnectionListener(server, socket) {
    http._connectionListener.call(server, socket);
}

function rawConnectionListener(server, socket) {
    var writer = new ResponseWriter(socket);
    onNewClient(server, socket, writer);
    listenForDelimiterData(server, socket, socket, writer);
}

function listenForDelimiterData(server, listener, socket, writer) {
    //todo: allow passing in custom delimiter
    var delimiterWrap = DelimiterStream.wrap(function(data) {
        parentEmit.call(server, 'message', data, socket, writer);
    });
    listener.on('data', delimiterWrap);
}

function onUpgrade(req, socket, upgradeHead) {
    var server = this;
    this._wss.handleUpgrade(req, socket, upgradeHead, function(client) {
        var writer = new ResponseWriter(client);
        onNewWSClient(server, client, socket, writer);
        //ws resets the timeout to 0 for some reason but we want to keep it what the user wants
        socket.setTimeout(server.timeout);
        client.on('message', function(data, opts) {
            parentEmit.call(server, 'message', opts.buffer || data, socket, writer);
        });
    });
}

function Portluck(messageListener) {
    //don't call http.Server constructor since we need to overwrite the connection handler
    http.Server.call(this);

    //remove the listner for connection from http.Server
    this.removeAllListeners('connection');

    if (messageListener) {
        this.addListener('message', messageListener);
    }

    //we need to *have* a listener for 'upgrade' so it emits the event in http.Server
    //we won't be letting this event actually fire though in our emit
    this.addListener('upgrade', onUpgrade);

    //"start" the websocket server
    this._wss = new WebSocket.Server({noServer: true});
}
util.inherits(Portluck, http.Server);
parentEmit = http.Server.prototype.emit;

//override a bunch of the events
Portluck.prototype.emit = function(type) {
    var msg, resp, writer;
    switch (type) {
        case 'connection': //socket
            onConnection(this, arguments[1]);
            break;
        case 'request': //msg, resp
            //take over the default HTTP "request" event so we can publish message
            msg = arguments[1];
            resp = arguments[2];
            if (msg.method !== 'POST' && msg.method !== 'PUT') {
                //405 means "Method Not Allowed"
                resp.writeHead(405, {Allow: 'POST,PUT', 'Content-Type': 'text/plain'});
                resp.end('Allowed methods are POST or PUT.');
                break;
            }
            resp.writeHead(200); //make sure we write the head BEFORE we possibly allow writes
            writer = new ResponseWriter(resp);
            //when the POST body ends we should trigger a message for whatever is left over
            msg.once('end', function() {
                //todo: when we allow a custom delimiter, send it here
                msg.emit('data', _LF_);
                resp.end();
            });
            onNewHTTPClient(this, msg, msg.socket, writer);
            //for a post/put the request can just be treated like a socket
            listenForDelimiterData(this, msg, msg.socket, writer);
            break;
        case 'upgrade': //req, socket, upgradeHead
            onUpgrade.call(this, arguments[1], arguments[2], arguments[3]);
            break;
        default:
            parentEmit.apply(this, Array.prototype.slice.call(arguments, 0));
            return;
    }
};

exports.Server = Portluck;
