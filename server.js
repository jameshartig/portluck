var net = require('net'),
    http = require('http'),
    https = require('https'),
    util = require('util'),
    DelimiterStream = require('delimiterstream'),
    WebSocket = require('ws'),
    debug, parentEmit;

//v0.10.x doesn't have debuglog
if (typeof util.debuglog === 'function') {
    debug = util.debuglog('portluck');
} else {
    //from net.js in v0.10.x tag
    if (process.env.NODE_DEBUG && /portluck/.test(process.env.NODE_DEBUG)) {
        debug = util.log;
    } else {
        debug = function() {};
    }
}

var _CR_ = "\r".charCodeAt(0),
    _LF_ = "\n".charCodeAt(0),
    _SPACE_ = " ".charCodeAt(0),
    //all the first letters of possible HTTP methods (from http_parser.c line 923)
    _METHODSCHARS_ = [
        "C".charCodeAt(0),
        "D".charCodeAt(0),
        "G".charCodeAt(0),
        "H".charCodeAt(0),
        "O".charCodeAt(0),
        "P".charCodeAt(0),
        "T".charCodeAt(0)
    ],
    _P_METHODSCHARS_ = [
        "A".charCodeAt(0),
        "O".charCodeAt(0),
        "U".charCodeAt(0)
    ],
    _METHODS_ = [
        new Buffer("CONNECT"),
        new Buffer("DELETE"),
        new Buffer("GET"),
        new Buffer("HEAD"),
        new Buffer("OPTIONS"),
        new Buffer("PATCH"),
        new Buffer("POST"),
        new Buffer("PUT"),
        new Buffer("TRACE")
    ],
    _MAX_METHOD_LENGTH_ = 7,
    _TLSRECORD_ = 0x16,
    _TLS_SSL3_ = 0x03,
    _TLS_CLIENT_HELLO_ = 0x01,
    TYPE_ERROR = -1, TYPE_HTTP = 1, TYPE_RAW = 2, TYPE_TLS = 3,
    bufferConcatArray = new Array(2),
    EMPTY_STRING = '',
    i;

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

function validateHTTPMethod(data, index) {
    var i = index || 0,
        l = Math.min(i + _MAX_METHOD_LENGTH_, data.length),
        methodMatch, methodMatchIndex;
    for (; i < l; i++) {
        if (data[i] === _SPACE_ || data[i] === _CR_ || data[i] === _LF_) {
            //ignore leading spaces/newlines/etc
            continue;
        }
        //if you trust benchmarks then switch is faster than indexOf: http://jsperf.com/switch-vs-array/8
        switch (data[i]) {
            case _METHODSCHARS_[0]: //C
                methodMatch = _METHODS_[0];
                methodMatchIndex = 1;
                break;
            case _METHODSCHARS_[1]: //D
                methodMatch = _METHODS_[1];
                methodMatchIndex = 1;
                break;
            case _METHODSCHARS_[2]: //G
                methodMatch = _METHODS_[2];
                methodMatchIndex = 1;
                break;
            case _METHODSCHARS_[3]: //H
                methodMatch = _METHODS_[3];
                methodMatchIndex = 1;
                break;
            case _METHODSCHARS_[4]: //O
                methodMatch = _METHODS_[4];
                methodMatchIndex = 1;
                break;
            case _METHODSCHARS_[5]: //P
                switch (data[i + 1]) {
                    case _P_METHODSCHARS_[0]:
                        methodMatch = _METHODS_[5];
                        break;
                    case _P_METHODSCHARS_[1]:
                        methodMatch = _METHODS_[6];
                        break;
                    case _P_METHODSCHARS_[2]:
                        methodMatch = _METHODS_[7];
                        break;
                    default:
                        return false;
                        break;
                }
                //we just verified the next char so skip it
                i++;
                methodMatchIndex = 2;
                break;
            case _METHODSCHARS_[6]: //T
                methodMatch = _METHODS_[8];
                methodMatchIndex = 1;
                break;
            default:
                return false;
                break;

        }
        //finishing the loop down here so we don't have to check methodMatch !=== undefined at the top every char
        for (i++; i < l && methodMatchIndex < methodMatch.length; i++, methodMatchIndex++) {
            if (methodMatch[methodMatchIndex] !== data[i]) {
                return false;
            }
        }
        return true;
    }
    return false;
}

//via http://security.stackexchange.com/questions/34780/checking-client-hello-for-https-classification
//also see node_crypto_clienthello.cc ParseRecordHeader
function validateTLSHello(data, index) {
    var i = index || 0;
    for (; i < data.length; i++) {
        if (data[i] === _SPACE_ || data[i] === _CR_ || data[i] === _LF_) {
            //ignore leading spaces/newlines/etc
            continue;
        }
        if (data[i] !== _TLSRECORD_ || data[i + 1] !== _TLS_SSL3_) {
            return false;
        }
        if (data[i + 5] !== _TLS_CLIENT_HELLO_) {
            return false;
        }
        return true;
    }
    return false;
}

function onConnection(server, socket) {
    var resolvedType = 0,
        receivedData, timeout;

    function triggerClientError(err) {
        debug('socket error', err);
        clearTimeout(timeout);
        server.emit('clientError', err, socket);
    }
    function onEnd() {
        debug('socket end');
        if (!socket.ended) {
            socket.end();
        }
    }
    function onClose() {
        debug('socket close');
        triggerClientError('ECONNRESET');
    }

    //we're handling our own timeouts for now
    socket.setTimeout(0);

    //wait at most 3 seconds to determine type, otherwise either fallback or destroy
    timeout = setTimeout(function() {
        if (server.rawFallback) {
            typeDetermined(TYPE_RAW);
        } else {
            //todo: emulate timeout error from http/https
            triggerClientError('TIMEOUT');
        }
    }, 3000);

    function typeDetermined(type) {
        debug('typeDetermined', type);
        if (type === TYPE_ERROR) {
            //todo: emulate parse error from http/https
            triggerClientError('PARSE_ERROR');
            return;
        }
        //if somehow the socket ended already just bail
        if (!socket.readable || !socket.writable || socket.ended) {
            return;
        }
        //set the timeout now to the value the user wants
        socket.setTimeout(server.timeout);
        switch (type) {
            case TYPE_HTTP:
                httpConnectionListener(server, socket);
                break;
            case TYPE_TLS:
                httpsConnectionListener(server, socket);
                break;
            case TYPE_RAW:
                rawConnectionListener(server, socket);
                break;
            default:
                throw new Error('Unknown type determined for socket: ' + type);
                break;
        }
        //need to call ondata for v0.10.x
        if (typeof socket.ondata === 'function') {
            var pendingData = socket.read();
            socket.ondata(pendingData, 0, pendingData.length);
        }
    }

    function onReadable() {
        if (resolvedType !== 0) {
            throw new Error('onReadable called after we already determined type. Please file a bug.');
            return;
        }
        debug('socket onReadable');
        var data = socket.read();
        //todo: on second packet we need to concat this data
        if (receivedData === undefined) {
            receivedData = data;
        } else {
            bufferConcatArray[0] = receivedData;
            bufferConcatArray[1] = data;
            //todo: this sucks we have to make a new Buffer on the second packet all the time
            receivedData = Buffer.concat(bufferConcatArray, (receivedData.length + data.length));
            bufferConcatArray[0] = undefined;
            bufferConcatArray[1] = undefined;
        }
        //data is a buffer
        for (var i = 0; i < data.length; i++) {
            //ignore these
            if (data[i] === _CR_ || data[i] === _LF_ || data[i] === _SPACE_) {
                continue;
            }
            //todo: if we don't have enough data yet to determine the type... wait till next packet
            if (validateHTTPMethod(data, i)) {
                resolvedType = TYPE_HTTP;
                debug('Determined HTTP');
            } else if (validateTLSHello(data, i)) {
                resolvedType = TYPE_TLS;
                debug('Determined TLS');
            } else if (server.rawFallback) {
                resolvedType = TYPE_RAW;
                debug('Determined RAW');
            } else {
                resolvedType = TYPE_ERROR;
                debug('Determined ERROR');
            }
            //at this point we know the type
            break;
        }
        if (resolvedType !== 0) {
            clearTimeout(timeout);

            debug('resolved type cleaning up');
            //clean up our listener since we resolved the type
            socket.removeListener('readable', onReadable);
            socket.removeListener('end', onEnd);
            socket.removeListener('error', triggerClientError);
            socket.removeListener('close', onClose);

            //we're no longer listening to readable anymore
            socket._readableState.readableListening = false;
            socket._readableState.reading = false;

            //put all the data we received back on the top of the stream
            //the tls socket will only work if we already have data in the stream
            socket.unshift(receivedData);

            //Because of Node Bug #9355, we won't get an error when there's a tls error
            typeDetermined(resolvedType);
        }
    }
    socket.on('readable', onReadable);
    //since the http server is setup with allowHalfOpen, we need to end when we get a FIN
    socket.once('end', onEnd);
    socket.once('error', triggerClientError);
    socket.once('close', onClose);
}

function emitConnect(server, socket, writer) {
    parentEmit.call(server, 'clientConnect', socket, writer);
}
function emitDisconnect(server, socket) {
    parentEmit.call(server, 'clientDisconnect', socket);
}

function onNewRawClient(server, socket, writer) {
    emitConnect(server, socket, writer);
    socket.once('close', function() {
        //clean up any listeners on data since we already sent that we're disconnected
        socket.removeAllListeners('data');
        emitDisconnect(server, socket);
    });
    socket.once('end', function() {
        socket.end();
    })
}
//for http we need to listen for close on the socket and NOT the listener >_<
function onNewHTTPClient(server, listener, socket, writer) {
    emitConnect(server, socket, writer);
    //built-in http automatically handles closing on 'end'
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
    server._httpConnectionListener(socket);
}

function httpsConnectionListener(server, socket) {
    server._httpsConnectionListener(socket);
}

function rawConnectionListener(server, socket) {
    var writer = new ResponseWriter(socket);
    onNewRawClient(server, socket, writer);
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

function destroySocket(socket) {
    socket.destroy();
}

function stripProtocolFromOrigin(origin) {
    var index = 0;
    if (origin[4] === ':') { //http://
        index = 7;
    } else if (origin[5] === ':') { // https://
        index = 8
    } else {
        index = origin.indexOf('://') + 3;
        //-1 + 3 = 2 (means not found)
        if (index === 2) {
            index = 0;
        }
    }
    return origin.substr(index);
}

function addRequiredListeners(server) {
    server.addListener('clientError', function(err, conn) {
        debug('clientError', err);
        conn.destroy();
    });

    //we need to *have* a listener for 'upgrade' so it emits the event in http.Server
    //we won't be letting this event actually fire though in our emit
    server.addListener('upgrade', onUpgrade);
}

function Portluck(messageListener, opts) {
    var options = opts || {},
        httpsEnabled = true;
    if (arguments.length === 1 && typeof messageListener === 'object') {
        options = messageListener;
        messageListener = null;
    }
    //if they don't want https don't force them
    if (!options.pfx && !options.key && !options.cert) {
        httpsEnabled = false;
    }
    if (httpsEnabled) {
        https.Server.call(this, options);

        if (this._events === undefined || typeof this._events.connection !== 'function') {
            throw new Error('Assert: missing https connection listener. Please file a bug!');
        }
        //ghetto hack to get the https connection listener since its not exposed
        this._httpsConnectionListener = this._events.connection;
    } else {
        debug('disabling https server since no key/cert sent');
        //calling http.Server since we don't inherit from it actually just makes a new server and returns it...
        //http.Server.call(this);
        net.Server.call(this);
        this._httpsConnectionListener = destroySocket;
    }
    this.httpAllowHalfOpen = false;
    //set this manually since https.Server doesn't set it
    this.allowHalfOpen = true;

    //this one is exposed, or we'd have to use this._events.secureConnection
    this._httpConnectionListener = http._connectionListener;

    //remove node's connection listner
    this.removeAllListeners('connection');
    this.removeAllListeners('secureConnection');

    //we're using our own listener to clientError
    this.removeAllListeners('clientError');

    addRequiredListeners(this);

    //"start" the websocket server
    this._wss = new WebSocket.Server({noServer: true});

    if (messageListener) {
        this.addListener('message', messageListener);
    }

    if (options.rawFallback !== undefined) {
        this.rawFallback = options.rawFallback;
    }
    if (options.timeout !== undefined) {
        if (typeof options.timeout !== 'number') {
            throw new TypeError('options.timeout must be a number');
        }
        this.timeout = options.timeout;
    } else {
        //2 minutes is the default timeout
        this.timeout = 120 * 1000;
    }
    if (options.allowOrigin !== undefined) {
        var originMatch = options.allowOrigin;
        if (typeof originMatch === 'string') {
            //optimize for *.example.com
            if (originMatch.indexOf('*.') === 0) {
                originMatch = new RegExp('(?:[a-zA-Z0-9_\\-]+.)?' + originMatch.substr(2), 'i');
            } else if (originMatch.indexOf('*') !== -1) {
                originMatch = new RegExp(originMatch.replace('*', '(?:[a-zA-Z0-9_\\-]+)'), 'i');
            } else {
                originMatch = originMatch.toLowerCase();
            }
        }
        if (originMatch instanceof RegExp) {
            this.validateOrigin = function(o) {
                var origin = o ? stripProtocolFromOrigin(o) : EMPTY_STRING;
                return originMatch.test(origin);
            };
        } else {
            this.validateOrigin = function(o) {
                var origin = o ? stripProtocolFromOrigin(o) : EMPTY_STRING;
                //only lowercase if we have to
                return (origin === originMatch) || (origin.toLowerCase() === originMatch);
            };
        }
    } else {
        this.validateOrigin = function() {
            return true;
        };
    }
}
util.inherits(Portluck, https.Server);
parentEmit = https.Server.prototype.emit;
parentRemoveAllListeners = https.Server.prototype.removeAllListeners;

//should we fallback to a raw socket?
Portluck.prototype.rawFallback = true;

//override a bunch of the events in emit so they don't bubble up
Portluck.prototype.emit = function(type) {
    var msg, resp, writer;
    switch (type) {
        case 'connection': //socket connection from net.Server
            onConnection(this, arguments[1]);
            break;
        case 'secureConnection': //tls connection from tls.Server
            this._httpConnectionListener(arguments[1]);
            break;
        case 'request': //msg, resp
            debug('received request event', msg);
            //take over the default HTTP "request" event so we can publish message
            msg = arguments[1];
            resp = arguments[2];

            resp.setHeader('Connection', 'close');
            resp.setHeader('Content-Type', 'text/plain');

            if (!this.validateOrigin(msg.headers.origin)) {
                debug('invalid origin header sent', msg.headers.origin);
                resp.writeHead(400);
                resp.end();
                return;
            } else if (msg.headers.origin) {
                resp.setHeader('Allow-Access-Control-Origin', msg.headers.origin);
            }

            if (msg.method !== 'POST' && msg.method !== 'PUT') {
                //405 means "Method Not Allowed"
                resp.setHeader('Allow', 'POST,PUT');
                resp.writeHead(405);
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
            if (type === 'clientError') {
                debug('clientError', arguments[1]);
            }
            parentEmit.apply(this, Array.prototype.slice.call(arguments, 0));
            return;
    }
};
Portluck.prototype.removeAllListeners = function(type) {
    var result = parentRemoveAllListeners.apply(this, Array.prototype.slice.call(arguments, 0));
    if (arguments.length === 0) {
        addRequiredListeners(this);
    }
    return result;
};

exports.Server = Portluck;
