var net = require('net'),
    http = require('http'),
    util = require('util'),
    DelimiterStream = require('delimiterstream'),
    WebSocketServer = require('ws').Server,
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

function onNewClient(server, socket) {
    parentEmit.call(server, 'clientConnect', socket);
    socket.once('close', function() {
        //clean up any listeners on data since we already sent that we're disconnected
        socket.removeAllListeners('data');
        parentEmit.call(server, 'clientDisconnect', socket);
    });
}

function httpConnectionListener(server, socket) {
    socket.setTimeout(server.timeout);
    http._connectionListener.call(server, socket);
}

function rawConnectionListener(server, socket) {
    socket.setTimeout(server.timeout);
    onNewClient(server, socket);
    listenForDelimiterData(server, socket);

    //since the http server is setup with allowHalfOpen, we need to end when we get a FIN
    socket.once('end', function() {
        if (!socket.ended) {
            socket.end();
        }
    });
}

function listenForDelimiterData(server, socket) {
    //todo: allow passing in custom delimiter
    var delimiterWrap = DelimiterStream.wrap(function(data) {
        parentEmit.call(server, 'message', data, socket);
    });
    socket.on('data', delimiterWrap);
}

function onUpgrade(req, socket, upgradeHead) {
    var self = this;
    this._wss.handleUpgrade(req, socket, upgradeHead, function(client) {
        if (socket.readable && socket.writable) {
            onNewClient(self, socket);
        }
        client.on('message', function(data, opts) {
            parentEmit.call(self, 'message', opts.buffer || data, socket);
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
    this._wss = new WebSocketServer({noServer: true});
}
util.inherits(Portluck, http.Server);
parentEmit = http.Server.prototype.emit;

//override a bunch of the events
Portluck.prototype.emit = function(type) {
    var msg, resp;
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
            //when the POST body ends we should trigger a message for whatever is left over
            msg.once('end', function() {
                //todo: when we allow a custom delimiter, send it here
                msg.emit('data', _LF_);
                resp.writeHead(200);
                resp.end();
            });
            onNewClient(this, msg.socket);
            //for a post/put the request can just be treated like a socket
            listenForDelimiterData(this, msg);
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
