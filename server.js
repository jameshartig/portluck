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
    _HTTP_ = [
        "H".charCodeAt(0),
        "T".charCodeAt(0),
        "T".charCodeAt(0),
        "P".charCodeAt(0)
    ],
    _MIN_HTTP_LINE_LENGTH_ = 3 + 6, //smallest method is 3 chars and HTTP/x is 6
    _MAX_METHOD_LENGTH_ = 7,
    _TLSRECORD_ = 0x16,
    _TLS_SSL3_ = 0x03,
    _TLS_CLIENT_HELLO_ = 0x01,
    _SSL2HEADERBYTE_ = 0x80,
    TYPE_ERROR = -1, TYPE_HTTP = 1, TYPE_RAW = 2, TYPE_TLS = 3, TYPE_PENDING = 4,
    bufferConcatArray = new Array(2),
    EMPTY_STRING = '',
    i;

function ResponseWriter(client, endOnWrite) {
    this._client = client;
    if (!this._client) {
        throw new TypeError('Invalid client sent to ResponseWriter');
    }
    this._encoding = undefined;
    this.ended = false;
    this._pendingWrite = false;
    this._doneAfterWrite = false;
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
    this._pendingWrite = false;
    if (this.ended) {
        throw new Error('write called after ResponseWriter ended');
    }
    if (this._client instanceof WebSocket) {
        var options = {binary: false};
        if (this._encoding === undefined) {
            options.binary = (message instanceof Buffer);
        } else if (this._encoding === 'buffer') {
            options.binary = true;
        }
        this._client.send(message, options);
    } else {
        this._client.write(message, this._encoding);
    }
    if (this._doneAfterWrite) {
        this.done();
    }
};
ResponseWriter.prototype.writeHead = function(code, message, headers) {
    if (this._client instanceof http.ServerResponse && !this._client.headersSent) {
        this._client.writeHead(code, message, headers);
    }
};
ResponseWriter.prototype.end = function() {
    if (this._client instanceof WebSocket) {
        this._client.close();
        return;
    }
    this.ended = true;
    if (this._client.ended) {
        return;
    }
    this._client.end();
};
ResponseWriter.prototype._defaultDone = function() {
    if (this._pendingWrite) {
        return;
    }
    return this.done();
};
ResponseWriter.prototype.done = function(message) {
    if (message !== undefined) {
        this.write(message);
        if (this.ended) {
            return;
        }
    }
    this.ended = true;
    if (this._client.ended) {
        return;
    }
    //automatically close http responses
    if (this._client instanceof http.ServerResponse) {
        this._client.end();
    }
};
ResponseWriter.prototype.doneAfterWrite = function() {
    this._pendingWrite = true;
    this._doneAfterWrite = true;
};
ResponseWriter.prototype.destroy = function() {
    if (this._client instanceof WebSocket) {
        this._client.terminate();
        return;
    }
    this.ended = true;
    this._client.destroy();
};

function validateHTTPMethod(data, index, len) {
    var i = index || 0,
        l = len || data.length,
        httpIndex = 0,
        methodMatch = 0,
        methodMatchIndex = 0;
    if (l > _MIN_HTTP_LINE_LENGTH_) {
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
                    return 0;
                    break;
            }
            //skipping next char since we just matched it above
            i++;
            //finishing the loop down here so we don't have to check methodMatch !=== undefined at the top every char
            for (; i < l && methodMatchIndex < methodMatch.length; i++, methodMatchIndex++) {
                if (methodMatch[methodMatchIndex] !== data[i]) {
                    return 0;
                }
            }
            //we've found a valid command, now look for HTTP
            //see if we can find HTTP on this line
            for (; i < l && httpIndex < 4; i++) {
                switch (data[i]) {
                    case _HTTP_[httpIndex]:
                        httpIndex++;
                        break;
                    case _CR_:
                    case _LF_:
                        //we didn't find HTTP since we already got to the new line
                        return 0;
                        break;
                    case _SPACE_:
                        if (httpIndex > 0) {
                            //we don't allow spaces in HTTP
                            return 0;
                        }
                        break;
                }
            }
            //break now since we just checked the first non space character
            break;
        }
    }
    //httpIndex >= 4 then we found HTTP in the header and its a valid HTTP line, otherwise its not
    return httpIndex >= 4 ? 1 : 0;
}

//via http://security.stackexchange.com/questions/34780/checking-client-hello-for-https-classification
//also see node_crypto_clienthello.cc ParseRecordHeader
function validateTLSHello(data, index, len) {
    var i = index || 0,
        l = len || data.length;
    if (len > 5) {
        for (; i < l; i++) {
            if (data[i] === _SPACE_ || data[i] === _CR_ || data[i] === _LF_) {
                //ignore leading spaces/newlines/etc
                continue;
            }
            if (data[i] === _TLSRECORD_ && data[i + 1] === _TLS_SSL3_) {
                if (data[i + 5] !== _TLS_CLIENT_HELLO_) {
                    //invalid message type but still tls
                    return -1;
                }
                return 1;
            }
            break;
        }
    }
    return 0;
}

//via http://stackoverflow.com/questions/3897883/how-to-detect-an-incoming-ssl-https-handshake-ssl-wire-format
//also see node_crypto_clienthello.cc ParseRecordHeader
function validateSSLv2(data, index, len) {
    var i = index || 0,
        l = len || data.length;
    if (len > 2) {
        for (; i < l; i++) {
            if (data[i] === _SPACE_ || data[i] === _CR_ || data[i] === _LF_) {
                //ignore leading spaces/newlines/etc
                continue;
            }
            if ((data[i] & _SSL2HEADERBYTE_) && data[i + 2] === _TLS_CLIENT_HELLO_) {
                return 1;
            }
            //some clients are sending 80 03 00 04 00 00 00 14 00 00 00 02 00 00 00 04 00 00 03 e8 00 00 00 07 00 a0 00 00 80 03 00 09 00 00 00 08 00 00 00 00 00 9f 00 00
            //which I'm not sure what protocol except that it looks like SSLv2 and we should reject it
            if ((data[i] & _SSL2HEADERBYTE_) && data[i + 1] === 0x03 && data[i + 3] === 0x04) {
                return -1;
            }
            break;
        }
    }
    return 0;
}

function ParseError(code) {
    this.message = 'Parse Error';
    this.code = code;
}
util.inherits(ParseError, Error);

function typeDetermined(server, socket, type) {
    debug('typeDetermined', type);
    if (type === TYPE_ERROR) {
        server.emit('clientError', new ParseError('HPE_UNKNOWN'), socket);
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
        case TYPE_PENDING:
            pendingConnectionListener(server, socket);
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
        clearTimeout(timeout);
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

    //wait at most 2 seconds to determine type, otherwise emit connect and wait till we are told how to handle data
    timeout = setTimeout(function() {
        if (!socket.readable || !socket.writable || socket.ended) {
            onEnd();
            return;
        }
        debug('timeout waiting for first byte');
        typeDetermined(server, socket, TYPE_PENDING);
    }, 2000);

    function onReadable() {
        if (resolvedType !== 0) {
            throw new Error('onReadable called after we already determined type. Please file a bug.');
        }
        debug('socket onReadable');
        var data = socket.read(),
            i = 0,
            len = 0,
            res = 0;
        if (data === null) {
            debug('Received null data from socket.read(). Ignoring...');
            return;
        }
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
        len = data.length;
        for (i = 0; i < len; i++) {
            //ignore these
            if (data[i] === _CR_ || data[i] === _LF_ || data[i] === _SPACE_) {
                continue;
            }
            res = 0;
            if ((res = validateHTTPMethod(data, i, len)) !== 0) {
                resolvedType = TYPE_HTTP;
                debug('Determined HTTP');
            } else if ((res = validateTLSHello(data, i, len)) !== 0) {
                resolvedType = TYPE_TLS;
                debug('Determined TLS');
            } else if ((res = validateSSLv2(data, i, len)) !== 0) {
                resolvedType = TYPE_ERROR;
                debug('Determined SSLv2');
            } else if (server.rawFallback) {
                resolvedType = TYPE_RAW;
                debug('Determined RAW');
            } else {
                resolvedType = TYPE_ERROR;
                debug('Determined ERROR');
            }
            if (res === -1) {
                resolvedType = TYPE_ERROR;
                debug('Error with determined type. Changing resolved type to error');
            }
            //at this point we know the type
            break;
        }
        if (resolvedType !== 0) {
            socket.emit('_resolvedType', resolvedType);

            //we're no longer listening to readable anymore
            socket._readableState.readableListening = false;
            socket._readableState.reading = false;

            //put all the data we received back on the top of the stream
            //the tls socket will only work if we already have data in the stream
            socket.unshift(receivedData);

            //Because of Node Bug #9355, we won't get an error when there's a tls error
            typeDetermined(server, socket, resolvedType);
        }
    }
    socket.on('readable', onReadable);
    //since the http server is setup with allowHalfOpen, we need to end when we get a FIN
    socket.once('end', onEnd);
    socket.once('error', triggerClientError);
    socket.once('close', onClose);

    socket.once('_resolvedType', function(type) {
        clearTimeout(timeout);
        //clean up our listener since we resolved the type
        socket.removeListener('readable', onReadable);
        socket.removeListener('end', onEnd);
        socket.removeListener('error', triggerClientError);
        socket.removeListener('close', onClose);
    });
}

//todo: figure out a way to not store state on the socket
function emitConnect(server, socket, writer) {
    if (socket._connectEmitted || socket._disconnectEmitted || socket.ended) {
        return;
    }
    parentEmit.call(server, 'clientConnect', writer, socket);
    socket._connectEmitted = true;
}
function emitDisconnect(server, socket) {
    if (!socket._connectEmitted || socket._disconnectEmitted) {
        return;
    }
    parentEmit.call(server, 'clientDisconnect', socket);
    socket._disconnectEmitted = true;
}

function onNewRawClient(server, socket, writer) {
    emitConnect(server, socket, writer);
    socket.once('close', function() {
        //clean up any listeners on data since we already sent that we're disconnected
        socket.removeAllListeners('data');
        socket.removeAllListeners('end');
        emitDisconnect(server, socket);
    });
    socket.once('error', function(err) {
        parentEmit.call(server, 'clientError', err);
        writer.destroy();
    });
    //'end' listener needs to be added in listenForDelimiterData
}
//for http we need to listen for close on the socket and NOT the listener >_<
function onNewHTTPClient(server, listener, socket, writer) {
    emitConnect(server, socket, writer);
    //built-in http automatically handles closing on 'end'
    socket.once('close', function() {
        //clean up any listeners on data since we already sent that we're disconnected
        listener.removeAllListeners('data');
        listener.removeAllListeners('end');
        emitDisconnect(server, socket);
    });
    listener.once('error', function(err) {
        parentEmit.call(server, 'clientError', err);
        writer.destroy();
    });
    if (!server.explicitDone) {
        listener.once('end', function(err) {
            process.nextTick(function() {
                writer._defaultDone();
            });
        });
    }
}
function onNewWSClient(server, listener, socket, writer) {
    //ws resets the timeout to 0 for some reason but we want to keep it what the user wants
    socket.setTimeout(server.timeout);

    emitConnect(server, writer, socket);
    listener.once('close', function() {
        //clean up any listeners on data since we already sent that we're disconnected
        listener.removeAllListeners('message');
        emitDisconnect(server, socket);
    });
    listener.once('error', function(err) {
        parentEmit.call(server, 'clientError', err);
        writer.destroy();
    });
    listener.on('message', function(data) {
        if (data.length === 0) {
            return;
        }
        parentEmit.call(server, 'message', data, writer, socket);
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
    //if we get a FIN, end the writer on the next tick
    socket.once('end', function() {
        process.nextTick(function() {
            writer.end();
        });
    });
}

function pendingConnectionListener(server, socket) {
    var writer = new ResponseWriter(socket);
    emitConnect(server, socket, writer);
    function onClose() {
        emitDisconnect(server, socket);
    }
    function onEnd() {
        if (!socket.ended) {
            socket.end();
        }
    }
    socket.once('close', onClose);
    socket.once('end', onEnd);
    socket.once('_resolvedType', function() {
        socket.removeListener('end', onEnd);
        socket.removeListener('close', onClose);
    });
}

function listenForDelimiterData(server, listener, socket, writer) {
    //todo: allow passing in custom delimiter
    var delimiterWrap = DelimiterStream.wrap(function(data) {
        parentEmit.call(server, 'message', data, writer, socket);
    });
    listener.on('data', delimiterWrap);
    listener.once('end', function() {
        //send null to flush the rest of the data left buffered
        delimiterWrap(null);
    });
}

function onUpgrade(req, socket, upgradeHead) {
    var server = this;
    this._wss.handleUpgrade(req, socket, upgradeHead, function(client) {
        var writer = new ResponseWriter(client);
        onNewWSClient(server, client, socket, writer);
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
    this.explicitDone = options.explicitDone || false;
}
util.inherits(Portluck, https.Server);
parentEmit = https.Server.prototype.emit;
parentRemoveAllListeners = https.Server.prototype.removeAllListeners;

//should we fallback to a raw socket?
Portluck.prototype.rawFallback = true;

//override a bunch of the events in emit so they don't bubble up
Portluck.prototype.emit = function(type) {
    var msg, resp, writer, socket;
    switch (type) {
        case 'connection': //socket connection from net.Server
            onConnection(this, arguments[1]);
            break;
        case 'secureConnection': //tls connection from tls.Server
            this._httpConnectionListener(arguments[1]);
            break;
        case 'request': //msg, resp
            //take over the default HTTP "request" event so we can publish message
            msg = arguments[1];
            resp = arguments[2];
            debug('received request event', msg.method, msg.httpVersion);

            resp.setHeader('Connection', 'close');
            resp.setHeader('Content-Type', 'text/plain');
            resp.removeHeader('Transfer-Encoding');

            //call validateOrigin even if they didn't send one since we might require an origin
            if (!this.validateOrigin(msg.headers.origin)) {
                debug('invalid origin header sent', msg.headers.origin);
                resp.writeHead(400);
                resp.end();
                break;
            } else if (msg.headers.origin != null) { //only send back approved origin headers if they sent an origin
                resp.setHeader('Access-Control-Allow-Origin', msg.headers.origin);
                resp.setHeader('Access-Control-Allow-Methods', 'POST, PUT');
                resp.setHeader('Access-Control-Allow-Credentials', 'true');
            }

            //respond to OPTIONS requests for pre-flight access controls
            if (msg.method === 'OPTIONS') {
                resp.writeHead(200);
                resp.end();
                break;
            } else if (msg.method !== 'POST' && msg.method !== 'PUT') {
                //405 means "Method Not Allowed"
                resp.setHeader('Allow', 'POST,PUT');
                resp.writeHead(405);
                resp.end('Allowed methods are POST or PUT.');
                break;
            }
            resp.statusCode = 200; //default the statusCode to 200
            writer = new ResponseWriter(resp);
            onNewHTTPClient(this, msg, msg.socket, writer);
            //for a post/put the request can just be treated like a socket
            listenForDelimiterData(this, msg, msg.socket, writer);
            break;
        case 'upgrade': //req, socket, upgradeHead
            msg = arguments[1];
            socket = arguments[2];
            if (!this.validateOrigin(msg.headers.origin)) {
                debug('invalid origin header sent', msg.headers.origin);
                socket.end();
                return;
            }
            onUpgrade.call(this, msg, socket, arguments[3]);
            break;
        case 'clientError':
            parentEmit.call(this, arguments[0], arguments[1], arguments[2]);
            break;
        default:
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
