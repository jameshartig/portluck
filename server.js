var net = require('net'),
    http = require('http'),
    https = require('https'),
    util = require('util'),
    DelimiterStream = require('delimiterstream'),
    bufferConcatLimit = require('buffer-concat-limit'),
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
        "L".charCodeAt(0),
        "O".charCodeAt(0),
        "P".charCodeAt(0),
        "S".charCodeAt(0),
        "T".charCodeAt(0),
        "U".charCodeAt(0)
    ],
    _P_METHODSCHARS_ = [
        "A".charCodeAt(0),
        "O".charCodeAt(0),
        "U".charCodeAt(0)
    ],
    _PURGE_ = new Buffer("PURGE"),
    _PUT_ = new Buffer("PUT"),
    _METHODS_ = [
        new Buffer("CONNECT"),
        new Buffer("DELETE"),
        new Buffer("GET"),
        new Buffer("HEAD"),
        new Buffer("LOCK"),
        new Buffer("OPTIONS"),
        new Buffer("PATCH"),
        new Buffer("POST"),
        _PURGE_,
        _PUT_,
        new Buffer("SEARCH"),
        new Buffer("TRACE"),
        new Buffer("UNLOCK")
    ],
    _HTTP_ = [
        "H".charCodeAt(0),
        "T".charCodeAt(0),
        "T".charCodeAt(0),
        "P".charCodeAt(0),
        "/".charCodeAt(0)
    ],
    _TLSRECORD_ = 0x16,
    _TLS_SSL3_ = 0x03,
    _TLS_CLIENT_HELLO_ = 0x01,
    _SSL2HEADERBYTE_ = 0x80,
    TYPE_ERROR = -1, TYPE_HTTP = 1, TYPE_RAW = 2, TYPE_TLS = 3, TYPE_PENDING = 4,
    EMPTY_STRING = '',
    i;

function ResponseWriter(client) {
    this._client = client;
    if (!this._client) {
        throw new TypeError('Invalid client sent to ResponseWriter');
    }
    this._encoding = undefined;
    this.ended = false;
    this._pendingWrite = false;
    this._endAfterWrite = false;
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
    if (this._endAfterWrite) {
        this.end();
    }
};
ResponseWriter.prototype.writeHead = function(code, message, headers) {
    if (this._client instanceof http.ServerResponse && !this._client.headersSent) {
        this._client.writeHead(code, message, headers);
    }
};
ResponseWriter.prototype.setHeader = function(name, value) {
    if (this._client instanceof http.ServerResponse && !this._client.headersSent) {
        this._client.setHeader(name, value);
    }
};
ResponseWriter.prototype.removeHeader = function(name) {
    if (this._client instanceof http.ServerResponse && !this._client.headersSent) {
        this._client.removeHeader(name);
    }
};
ResponseWriter.prototype.getHeader = function(name) {
    if (this._client instanceof http.ServerResponse && !this._client.headersSent) {
        return this._client.getHeader(name);
    }
};
ResponseWriter.prototype.close = function() {
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
ResponseWriter.prototype._defaultEnd = function() {
    if (this._pendingWrite) {
        return;
    }
    return this.end();
};
ResponseWriter.prototype.end = function(message) {
    if (this._client.ended || (this._client instanceof WebSocket && this._client.readyState !== WebSocket.OPEN)) {
        this.ended = true;
        return;
    }
    if (message !== undefined) {
        this.write(message);
    }
    //automatically close http responses
    if (this._client instanceof http.ServerResponse) {
        this.ended = true;
        this._client.end();
    }
};
ResponseWriter.prototype.done = ResponseWriter.prototype.end;

ResponseWriter.prototype.endAfterWrite = function() {
    this._pendingWrite = true;
    this._endAfterWrite = true;
};
ResponseWriter.prototype.doneAfterWrite = ResponseWriter.prototype.endAfterWrite;
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
        methodMatch = null,
        methodMatchIndex = 0,
        methodMatchLen = 0;
    for (; i < l; i++) {
        //ignore these characters and continue looping
        if (data[i] !== _CR_ && data[i] !== _LF_ && data[i] !== _SPACE_) {
            break;
        }
    }
    //if we already hit the end then we don't have enough data
    if (i >= l) {
        return -2;
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
        case _METHODSCHARS_[4]: //L
            methodMatch = _METHODS_[4];
            methodMatchIndex = 1;
            break;
        case _METHODSCHARS_[5]: //O
            methodMatch = _METHODS_[5];
            methodMatchIndex = 1;
            break;
        case _METHODSCHARS_[6]: //P
            switch (data[i + 1]) {
                case _P_METHODSCHARS_[0]: //A
                    methodMatch = _METHODS_[6];
                    //we just verified the next char so skip it
                    i++;
                    methodMatchIndex = 2;
                    break;
                case _P_METHODSCHARS_[1]: //O
                    methodMatch = _METHODS_[7];
                    //we just verified the next char so skip it
                    i++;
                    methodMatchIndex = 2;
                    break;
                case _P_METHODSCHARS_[2]: //U
                    switch (data[i + 2]) {
                        case _PURGE_[2]:
                            methodMatch = _METHODS_[8];
                            break;
                        case _PUT_[2]:
                            methodMatch = _METHODS_[9];
                            break;
                        case undefined: //not enough data
                            return -2;
                        default:
                            break;
                    }
                    //we just verified the next and next next char so skip them
                    i += 2;
                    methodMatchIndex = 3;
                    break;
                case undefined: //not enough data
                    return -2;
                default:
                    //no match so we don't set methodMatch which will cause us to return 0 after the outer switch
                    break;
            }
            break;
        case _METHODSCHARS_[7]: //S
            methodMatch = _METHODS_[10];
            methodMatchIndex = 1;
            break;
        case _METHODSCHARS_[8]: //T
            methodMatch = _METHODS_[11];
            methodMatchIndex = 1;
            break;
        case _METHODSCHARS_[9]: //U
            methodMatch = _METHODS_[12];
            methodMatchIndex = 1;
            break;
    }
    if (methodMatch === null) {
        return 0;
    }
    //skipping next char since we just matched it above
    i++;
    //finishing the loop down here so we don't have to check methodMatch !=== undefined at the top every char
    methodMatchLen = methodMatch.length;
    for (; i < l && methodMatchIndex < methodMatchLen; i++, methodMatchIndex++) {
        //if the method name does not match, invalid method name, return
        if (methodMatch[methodMatchIndex] !== data[i]) {
            return 0;
        }
    }
    //if we don't have at least 8 bytes left (for (space)/(space)HTTP/) then we don't have enough data
    if (i + 8 >= l) {
        return -2;
    }
    //the next character after METHOD is space then a URL
    if (data[i] !== _SPACE_) {
        return 0;
    }
    i++;
    //we've found a valid command, now look for HTTP/
    for (; (i + 4) < l; i++) {
        //todo: is there a better way to do this?
        if (data[i] === _HTTP_[0] && data[i + 1] === _HTTP_[1] && data[i + 2] === _HTTP_[2] && data[i + 3] === _HTTP_[3] && data[i + 4] === _HTTP_[4]) {
            return 1;
        }
        //we didn't find HTTP since we already got to a control character
        if (data[i] <= 19) {
            return 0;
        }
        //todo: we should verify the url characters are valid (like http_parser.c's normal_url_char)
    }
    //apache has a max header length of 8kb so if they already sent more than 8kb stop trying to think its HTTP and give up
    if (l > 8192) {
        return 0;
    }
    //we must've not found a newline character so we don't have enough data
    return -2;
}

//via http://security.stackexchange.com/questions/34780/checking-client-hello-for-https-classification
//also see node_crypto_clienthello.cc ParseRecordHeader
function validateTLSHello(data, index, len) {
    var i = index || 0,
        l = len || data.length;
    if (data[i] !== _TLSRECORD_) {
        return 0;
    }
    if (i + 5 >= l) {
        return -2;
    }
    if (data[i + 1] === _TLS_SSL3_) {
        if (data[i + 5] !== _TLS_CLIENT_HELLO_) {
            //invalid message type but still tls
            return -1;
        }
        return 1;
    }
    return 0;
}

//via http://stackoverflow.com/questions/3897883/how-to-detect-an-incoming-ssl-https-handshake-ssl-wire-format
//also see node_crypto_clienthello.cc ParseRecordHeader
function validateSSLv2(data, index, len) {
    var i = index || 0,
        l = len || data.length;
    if ((data[i] & _SSL2HEADERBYTE_) === 0) {
        return 0;
    }
    if (i + 2 >= l) {
        return -2;
    }
    if (data[i + 2] === _TLS_CLIENT_HELLO_) {
        return 1;
    }
    //some clients are sending 80 03 00 04 00 00 00 14 00 00 00 02 00 00 00 04 00 00 03 e8 00 00 00 07 00 a0 00 00 80 03 00 09 00 00 00 08 00 00 00 00 00 9f 00 00
    //which I'm not sure what protocol except that it looks like SSLv2 and we should reject it
    if (data[i + 1] === 0x03 && data[i + 3] === 0x04) {
        return -1;
    }
    return 0;
}

function ParseError(code) {
    this.message = 'Parse Error';
    this.code = code;
}
util.inherits(ParseError, Error);

function ReadError(code) {
    this.message = 'Read Error';
    this.code = code;
}
util.inherits(ReadError, Error);

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
    }
    //need to call ondata for v0.10.x
    if (typeof socket.ondata === 'function') {
        var pendingData = socket.read();
        socket.ondata(pendingData, 0, pendingData.length);
    }
}

function setTimeoutForSocket(server, socket) {
    return setTimeout(function() {
        if (!socket.readable || !socket.writable || socket.ended) {
            if (!socket.ended) {
                socket.end();
            }
            return;
        }
        socket.emit('_resolveTimeout');
    }, 1000);
}

function onConnection(server, socket) {
    var resolvedType = 0,
        receivedData, timeout;

    //todo: move these all to named functions somehow
    function triggerClientError(err) {
        debug('socket error', err);
        clearTimeout(timeout);
        timeout = null;
        server.emit('clientError', err, socket);
    }
    function onEnd() {
        debug('socket end');
        clearTimeout(timeout);
        timeout = null;
        if (!socket.ended) {
            socket.end();
        }
    }
    function onClose() {
        debug('socket close');
        triggerClientError(new ReadError('ECONNRESET'));
    }
    function onTimeout() {
        debug('socket timeout');
        server.emit('timeout', socket);
    }
    function onResolveTimeout() {
        if (server.rawFallback) {
            //stop listening for close now since were passing it off to pendingConnectionListener
            //keep listening to end since that means the client sent a FIN
            socket.removeListener('close', onClose);
            debug('timeout waiting for first byte');
            typeDetermined(server, socket, TYPE_PENDING);
        } else {
            debug('timeout waiting for first byte but rawFallback is false. Setting socket timeout');
            //set the timeout now to the value the user wants so it'll close if no more data is sent
            socket.setTimeout(server.timeout);
            socket.once('timeout', onTimeout);
        }
        timeout = null;
    }

    //we're handling our own timeouts for now
    socket.setTimeout(0);

    //wait at most 1 seconds to determine type, otherwise emit connect and wait till we are told how to handle data
    timeout = setTimeoutForSocket(server, socket);

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
        //ignore the limit for the first packet since node already allocated that memory and delimiter stream will handle limiting the chunks
        if (receivedData === undefined) {
            receivedData = data;
        } else {
            receivedData = bufferConcatLimit(receivedData, data, server.messageLimit);
        }
        //data is a buffer
        len = receivedData.length;
        //this is assuming that ALL of these methods start with a different first character
        if ((res = validateHTTPMethod(receivedData, i, len)) !== 0) {
            resolvedType = TYPE_HTTP;
            debug('Determined HTTP');
        } else if ((res = validateTLSHello(receivedData, i, len)) !== 0) {
            resolvedType = TYPE_TLS;
            debug('Determined TLS');
        } else if ((res = validateSSLv2(receivedData, i, len)) !== 0) {
            resolvedType = TYPE_ERROR;
            debug('Determined SSLv2');
        } else if (server.rawFallback) {
            resolvedType = TYPE_RAW;
            debug('Determined RAW');
        } else {
            resolvedType = TYPE_ERROR;
            debug('Determined ERROR');
        }
        //result of -2 means we don't know the type yet but we sorta matched so keep waiting and restart the waiting timeout
        if (res === -2) {
            if (timeout !== null) {
                clearTimeout(timeout);
                //restart the timeout to wait another second before marking as pending
                timeout = setTimeoutForSocket(server, socket);
            }
            debug('Not enough data for a resolution, waiting for more data');
            resolvedType = 0;
        } else if (res === -1) {
            resolvedType = TYPE_ERROR;
            debug('Error with determined type. Changing resolved type to error');
        }
        if (resolvedType !== 0) {
            //clean up everything since we resolved the type
            clearTimeout(timeout);
            timeout = null;
            socket.removeListener('readable', onReadable);
            socket.removeListener('end', onEnd);
            socket.removeListener('error', triggerClientError);
            socket.removeListener('close', onClose);
            socket.removeListener('_resolveTimeout', onResolveTimeout);
            socket.removeListener('timeout', onTimeout);

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
    socket.once('_resolveTimeout', onResolveTimeout);
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
        socket.removeAllListeners('timeout');
        emitDisconnect(server, socket);
    });
    socket.once('error', function(err) {
        parentEmit.call(server, 'clientError', err, socket);
        writer.destroy();
    });
    socket.once('timeout', function() {
        server.emit('timeout', socket);
    });
    //'end' listener needs to be added in listenForDelimiterData
}
//for http we need to listen for close on the socket and NOT the listener >_<
function onNewHTTPClient(server, listener, socket, writer) {
    emitConnect(server, socket, writer);
    //built-in http automatically handles closing on 'end'
    //built-in http automatically fires timeout so we can ignore that here
    socket.once('close', function() {
        //clean up any listeners on data since we already sent that we're disconnected
        listener.removeAllListeners('data');
        listener.removeAllListeners('end');
        emitDisconnect(server, socket);
    });
    listener.once('error', function(err) {
        parentEmit.call(server, 'clientError', err, socket);
        writer.destroy();
    });
    if (!server.explicitEnd) {
        listener.once('end', function() {
            process.nextTick(function() {
                writer._defaultEnd();
            });
        });
    }
}
function onNewWSClient(server, listener, socket, writer) {
    //ws resets the timeout to 0 for some reason but we want to keep it what the user wants
    //built-in http server automatically fires timeout so we can ignore that here
    socket.setTimeout(server.timeout);

    emitConnect(server, socket, writer);
    listener.once('close', function() {
        //clean up any listeners on data since we already sent that we're disconnected
        listener.removeAllListeners('message');
        emitDisconnect(server, socket);
    });
    listener.once('error', function(err) {
        parentEmit.call(server, 'clientError', err, socket);
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
            writer.close();
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
    function onTimeout() {
        server.emit('timeout', socket);
    }
    socket.once('timeout', onTimeout);
    socket.once('close', onClose);
    socket.once('end', onEnd);
    socket.once('_resolvedType', function() {
        socket.removeListener('end', onEnd);
        socket.removeListener('close', onClose);
        socket.removeListener('timeout', onTimeout);
    });
}

function listenForDelimiterData(server, listener, socket, writer) {
    //todo: allow passing in custom delimiter
    var delimiterWrap = DelimiterStream.wrap({dataLimit: server.messageLimit}, function(data) {
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
    server.addListener('clientError', function(err, socket) {
        debug('clientError', err);
        socket.destroy();
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
        debug('Setting timeout to ' + options.timeout);
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
    this.explicitEnd = options.explicitEnd || options.explicitDone || false;
    if (options.messageLimit >= 0) {
        if (typeof options.messageLimit !== 'number') {
            throw new TypeError('options.messageLimit must be a number');
        }
        debug('Setting message limit to ' + options.messageLimit);
        this.messageLimit = options.messageLimit;
    } else {
        this.messageLimit = 0; //default is unlimited
    }
}
util.inherits(Portluck, https.Server);
parentEmit = https.Server.prototype.emit;
parentRemoveAllListeners = https.Server.prototype.removeAllListeners;

//should we fallback to a raw socket?
Portluck.prototype.rawFallback = true;

Portluck.prototype.invalidMethodHandler = function(msg, resp) {
    //405 means "Method Not Allowed"
    resp.setHeader('Allow', 'POST,PUT');
    resp.writeHead(405);
    resp.end('Allowed methods are POST or PUT.');
};

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
                //allow some common headers (http://www.w3.org/TR/cors/#simple-header are automatically allowed)
                resp.setHeader('Access-Control-Allow-Headers', 'DNT,User-Agent,X-Requested-With,Content-Type');
            }

            //respond to OPTIONS requests for pre-flight access controls
            if (msg.method === 'OPTIONS') {
                resp.writeHead(200);
                resp.end();
                break;
            } else if (msg.method !== 'POST' && msg.method !== 'PUT') {
                this.invalidMethodHandler(msg, resp);
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
            return parentEmit.call(this, arguments[0], arguments[1], arguments[2]);
        case 'timeout': //socket
            socket = arguments[1];
            //if we get a timeout then immediately end socket
            if (!socket.ended) {
                debug('socket timed out and were ending');
                socket.destroy();
            }
            break;
        default:
            return parentEmit.apply(this, Array.prototype.slice.call(arguments, 0));
    }
    //we handled it so return true
    return true;
};
Portluck.prototype.removeAllListeners = function(type) {
    var result = parentRemoveAllListeners.apply(this, Array.prototype.slice.call(arguments, 0));
    if (arguments.length === 0) {
        addRequiredListeners(this);
    }
    return result;
};

exports.Server = Portluck;
