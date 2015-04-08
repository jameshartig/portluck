var portluck = require('../server.js'),
    net = require('net'),
    http = require('http'),
    listenOptions = {port: 14999, host: '127.0.0.1'},
    httpOptions = {port: listenOptions.port, hostname: listenOptions.host, method: 'POST', path: '/', agent: false},
    testString = '{"test":true}',
    server = new portluck.Server(),
    listening = false;

Object.extend = function(obj, obj2) {
    var dest = {},
        key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) {
            dest[key] = obj[key];
        }
    }
    for (key in obj2) {
        if (obj2.hasOwnProperty(key)) {
            dest[key] = obj2[key];
        }
    }
    return dest;
};

function listen(cb) {
    listening = true;
    server.listen(listenOptions.port, listenOptions.host, cb);
    //we don't care if we die and the server is still around
    server.unref();
}

exports.setUp = function(callback) {
    if (listening) {
        callback();
        return;
    }
    listen(callback);
};

exports.testSimpleSocket = function(test) {
    test.expect(5);
    var conn;
    function testNoConnectionsLeft() {
        server.getConnections(function(err, count) {
            test.equal(count, 0);
            test.done();
        });
    }
    server.removeAllListeners();
    server.once('clientConnect', function(writer, socket) {
        test.ok(socket instanceof net.Socket);
        test.equal(socket.remoteAddress, listenOptions.host);
    });
    server.once('message', function(message) {
        test.strictEqual(message.toString(), testString);
    });
    server.once('clientDisconnect', function(socket) {
        test.ok(socket instanceof net.Socket);
        testNoConnectionsLeft();
    });
    conn = net.createConnection(listenOptions, function() {
        conn.end(testString + "\n");
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
};

exports.testSimpleSocketDelayed = function(test) {
    test.expect(5);
    var conn;

    function testNoConnectionsLeft() {
        server.getConnections(function(err, count) {
            test.equal(count, 0);
            test.done();
        });
    }

    server.removeAllListeners();
    server.once('clientConnect', function(writer, socket) {
        test.ok(socket instanceof net.Socket);
        test.equal(socket.remoteAddress, listenOptions.host);
    });
    server.once('message', function(message) {
        test.strictEqual(message.toString(), testString);
    });
    server.once('clientDisconnect', function(socket) {
        test.ok(socket instanceof net.Socket);
        testNoConnectionsLeft();
    });
    conn = net.createConnection(listenOptions, function() {
        setTimeout(function() {
            conn.end(testString + "\n");
        }, 1500);
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
};

exports.testSimpleSocketNoNewLine = function(test) {
    test.expect(5);
    var conn;

    function testNoConnectionsLeft() {
        server.getConnections(function(err, count) {
            test.equal(count, 0);
            test.done();
        });
    }

    server.removeAllListeners();
    server.once('clientConnect', function(writer, socket) {
        test.ok(socket instanceof net.Socket);
        test.equal(socket.remoteAddress, listenOptions.host);
    });
    server.once('message', function(message) {
        test.strictEqual(message.toString(), testString);
    });
    server.once('clientDisconnect', function(socket) {
        test.ok(socket instanceof net.Socket);
        testNoConnectionsLeft();
    });
    conn = net.createConnection(listenOptions, function() {
        conn.end(testString);
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
};

exports.testSimpleHTTP = function(test) {
    test.expect(6);
    var receivedResp = false,
        receivedDisconnect = false,
        conn;
    function testNoConnectionsLeft() {
        server.getConnections(function(err, count) {
            test.equal(count, 0);
            test.done();
        });
    }
    server.removeAllListeners();
    server.once('clientConnect', function(writer, socket) {
        test.ok(socket instanceof net.Socket);
        test.equal(socket.remoteAddress, listenOptions.host);
    });
    server.once('message', function(message) {
        test.strictEqual(message.toString(), testString);
    });
    server.once('clientDisconnect', function(socket) {
        //wait for the response if we haven't already gotten it
        test.ok(socket instanceof net.Socket);
        if (receivedResp) {
            testNoConnectionsLeft();
        }
        receivedDisconnect = true;
    });
    conn = http.request(httpOptions, function(resp) {
        test.equal(resp.statusCode, 200);
        if (receivedDisconnect) {
            testNoConnectionsLeft();
        }
        receivedResp = true;
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
    //send our post body and finish
    conn.write(testString);
    conn.end();
};

exports.testHTTPPartials = function(test) {
    test.expect(1);
    var conn;
    server.removeAllListeners();
    server.once('message', function(message) {
        test.strictEqual(message.toString(), testString);
    });
    server.once('clientDisconnect', function() {
        test.done();
    });
    conn = net.createConnection(listenOptions, function() {
        conn.write('POS');
        setTimeout(function() {
            conn.write('T');
        }, 500);
        setTimeout(function() {
            var postReq = [' /HTiTP HTTP/1.1',
                'User-Agent: Test',
                'Host: 127.0.0.1:14999',
                'Content-Length: ' + (testString.length + 1),
                '',
                ''
            ];
            conn.end(postReq.join('\r\n') + testString + '\n');
        }, 1500);
    });
    conn.setNoDelay(true);
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
};

exports.testSocketResponse = function(test) {
    test.expect(1);
    var conn;
    server.removeAllListeners();
    server.once('clientConnect', function(writer) {
        writer.write(testString);
    });
    conn = net.createConnection(listenOptions, function() {
        conn.end("{}\n");
    });
    conn.on('data', function(data) {
        test.strictEqual(data.toString(), testString);
        conn.destroy();
        test.done();
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
};

exports.testSocketResponseTwice = function(test) {
    test.expect(4);
    var sendTwice = false,
        conn;
    server.removeAllListeners();
    server.on('message', function(message, writer) {
        test.strictEqual(message.toString(), '{}');
        //done SHOULDN'T end the writer
        writer.done(testString);
    });
    conn = net.createConnection(listenOptions, function() {
        conn.write("{}\n");
    });
    conn.on('data', function(data) {
        test.strictEqual(data.toString(), testString);
        if (!sendTwice) {
            sendTwice = true;
            conn.end("{}\n");
            return;
        }
        conn.destroy();
        test.done();
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
};

exports.testSocketResponseNoSend = function(test) {
    test.expect(1);
    var conn;
    server.removeAllListeners();
    server.once('clientConnect', function(writer) {
        writer.write(testString);
    });
    conn = net.createConnection(listenOptions);
    conn.on('data', function(data) {
        test.strictEqual(data.toString(), testString);
        conn.destroy();
        test.done();
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
};

exports.testHTTPResponseNoSend = function(test) {
    test.expect(2);
    var conn;
    server.removeAllListeners();
    server.once('clientConnect', function(writer) {
        writer.write(testString);
        writer.done();
    });
    conn = http.request(httpOptions, function(resp) {
        test.equal(resp.statusCode, 200);
        resp.on('data', function(data) {
            test.strictEqual(data.toString(), testString);
        });
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
    conn.once('close', function() {
        test.done();
    });
    conn.end();
};

exports.testHTTPResponse = function(test) {
    test.expect(2);
    var conn;
    server.removeAllListeners();
    server.once('message', function(message, writer) {
        test.strictEqual(message.toString(), testString);
        writer.write(testString);
    });
    conn = http.request(httpOptions, function(resp) {
        resp.on('data', function(data) {
            test.strictEqual(data.toString(), testString);
        });
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
    conn.once('close', function() {
        test.done();
    });
    conn.write(testString);
    conn.end();
};

exports.testHTTPResponseDelayed = function(test) {
    test.expect(2);
    var conn;
    server.explicitDone = true;
    server.removeAllListeners();
    server.once('message', function(message, writer) {
        test.strictEqual(message.toString(), testString);
        setTimeout(function() {
            writer.done(testString);
        }, 100);
    });
    conn = http.request(httpOptions, function(resp) {
        resp.on('data', function(data) {
            test.strictEqual(data.toString(), testString);
        });
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
    conn.once('close', function() {
        server.explicitDone = false;
        test.done();
    });
    conn.write(testString);
    conn.end();
};

exports.testHTTPResponseDoneAfterWrite = function(test) {
    test.expect(2);
    var conn;
    server.removeAllListeners();
    server.once('message', function(message, writer) {
        test.strictEqual(message.toString(), testString);
        writer.doneAfterWrite();
        setTimeout(function() {
            writer.write(testString);
        }, 100);
    });
    conn = http.request(httpOptions, function(resp) {
        resp.on('data', function(data) {
            test.strictEqual(data.toString(), testString);
        });
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
    conn.once('close', function() {
        test.done();
    });
    conn.write(testString);
    conn.end();
};

exports.testHTTPImmediatelyDoneAfterWrite = function(test) {
    test.expect(2);
    var conn;
    server.removeAllListeners();
    server.once('message', function(message, writer) {
        test.strictEqual(message.toString(), testString);
        writer.doneAfterWrite();
        writer.done(testString);
    });
    conn = http.request(httpOptions, function(resp) {
        resp.on('data', function(data) {
            test.strictEqual(data.toString(), testString);
        });
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
    conn.once('close', function() {
        test.done();
    });
    conn.write(testString);
    conn.end();
};

exports.testGETHTTP = function(test) {
    test.expect(1);
    var conn;

    server.removeAllListeners();
    server.once('clientConnect', function() {
        test.ok(false);
    });
    server.once('message', function() {
        test.ok(false);
    });
    conn = http.request(Object.extend(httpOptions, {method: 'GET'}), function(resp) {
        test.equal(resp.statusCode, 405);
        test.done();
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
    conn.end();
};

exports.testRejectSSLv2 = function(test) {
    test.expect(1);
    var conn;
    server.removeAllListeners();
    server.once('clientConnect', function() {
        test.ok(false);
    });
    conn = net.createConnection(listenOptions, function() {
        conn.end(new Buffer('80 2b 01 00 02 00 12 00 00 00 10 07 00 c0 03 00 80 01 00 80 06 00 40 04 00 80 02 00 80 bb 14 91 20 9e 85 ac 3b c1 11 23 8f 25 3d 32 da'.replace(/\s/g, ''), 'hex'));
    });
    conn.on('close', function() {
        test.ok(true);
        test.done();
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
};

exports.testRejectInvalidSSLv3 = function(test) {
    test.expect(1);
    var conn;
    server.removeAllListeners();
    server.once('clientConnect', function() {
        test.ok(false);
    });
    server.once('clientError', function() {
        test.ok(true);
    });
    conn = net.createConnection(listenOptions, function() {
        //6th byte should be clientHello (01) but instead we've changed it to FF
        conn.end(new Buffer('16 03 00 00 85 FF 00 00'.replace(/\s/g, ''), 'hex'));
    });
    conn.on('close', function() {
        test.done();
    });
    conn.setTimeout(5000);
    conn.once('timeout', function() {
        conn.destroy();
        test.ok(false);
    });
};


/**
 * This MUST be the last test run!
 */
exports.testClose = function(test) {
    if (!listening) {
        test.done();
        return;
    }
    server.close(function() {
        test.done();
    });
};
