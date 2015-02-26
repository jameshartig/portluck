var net = require('net'),
    http = require('http'),
    util = require('util'),
    DelimiterStream = require('DelimiterStream'),
    WebSocketServer = require('ws').Server;

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

function onConnection(self, socket) {
    var isHTTP = false,
        isRaw = false,
        isError = false;

    //set our timeout so we don't wait forever
    socket.setTimeout(self.timeout);

    socket.on('data', function onData(data) {
        //data is a buffer
        for (var i = 0; i < data.length; i++) {
            //ignore these
            if (data[i] === _CR_ || data[i] === _LF_ || data[i] === _SPACE_) {
                console.log("Ignoring newlines or spaces");
                continue;
            }
            //check to see if its a { (start of json blob) or if its one of the HTTP methods
            //otherwise its an error
            if (data[i] === _OBRACKET_) {
                console.log("Received OBRACKET.");
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
            console.log("Destroying becuase of error");
            socket.destroy();
            return;
        }
        if (!isHTTP && !isRaw) {
            return;
        }

        //clean up our listener before we pass onto http/raw sockets
        socket.removeListener('data', onData);
        if (isHTTP) {
            console.log("Switching to HTTP");
            httpConnectionListener(self, socket);
        } else {
            console.log("Switching to raw");
            rawConnectionListener(self, socket);
        }
        //re-send our data we just got to emulate this listener
        socket.emit('data', data);
    });
}

function httpConnectionListener(self, socket) {
    http._connectionListener.call(self, socket);
}

function rawConnectionListener(self, socket) {
    socket.on('data', self._delimiterWrap);
    /*socket.once('end', function() {
        socket.off('data', self._delimiterWrap);
    });*/
}

function Portluck(messageListener) {
    //don't call http.Server constructor since we need to overwrite the connection handler
    http.Server.call(this);

    //remove the listner for connection from http.Server
    this.removeAllListeners('connection');

    if (messageListener) {
        this.addListener('message', messageListener);
    }

    //"start" the websocket server
    this._wss = new WebSocketServer({noServer: true});
    //todo: allow passing in custom delimiter
    this._delimiterWrap = DelimiterStream.wrap(function(data) {
        this.emit('message', data);
    }, this);
}
util.inherits(Portluck, http.Server);

//override a bunch of the events
Portluck.prototype.emit = function(type) {
    var self = this,
        req, data, resp;
    switch (type) {
        case 'connection': //socket
            onConnection(this, arguments[1]);
            break;
        case 'request': //req, resp
            //take over the default HTTP "request" event so we can publish message
            req = arguments[1];
            resp = arguments[2];
            if (req.method !== 'POST' && req.method !== 'PUT') {
                //405 means "Method Not Allowed"
                resp.writeHead(405, {Allow: 'POST,PUT', 'Content-Type': 'text/plain'});
                resp.end('Allowed methods are POST or PUT.');
            }
            //for a post/put the request can just be treated like a socket
            rawConnectionListener(this, req);
            //on end though we need to write a response and trigger a delimiter
            //when the POST body ends we should trigger a message for whatever is left over
            req.once('end', function() {
                //todo: when we allow a custom delimiter, send it here
                self._delimiterWrap(_LF_);
                resp.writeHead(200);
                resp.end();
            });
            break;
        case 'upgrade': //req, socket, upgradeHead
            this._wss.handleUpgrade.call(arguments[1], arguments[2], arguments[3], function(client) {
                console.log('connected!');
                //self.emit('connection', client);
            });
            break;
        case 'data': //data
            //let the delimiter stream handle emitting message
            this._delimiterWrap(arguments[0]);
            break;
        default:
            http.Server.prototype.emit.apply(this, Array.prototype.slice.call(arguments, 0));
            return;
    }
};

exports.Server = Portluck;