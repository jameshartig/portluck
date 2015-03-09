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
    server.once('clientConnect', function(socket) {
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
    server.once('clientConnect', function(socket) {
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
        }, 3000);
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
    server.once('clientConnect', function(socket) {
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
    server.once('clientConnect', function(socket) {
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

exports.testSocketResponse = function(test) {
    test.expect(1);
    var conn;
    server.removeAllListeners();
    server.once('clientConnect', function(socket, writer) {
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

exports.testSocketResponseNoSend = function(test) {
    test.expect(1);
    var conn;
    server.removeAllListeners();
    server.once('clientConnect', function(socket, writer) {
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

exports.testGETHTTP = function(test) {
    test.expect(1);
    var conn;

    server.removeAllListeners();
    server.once('clientConnect', function(socket) {
        test.ok(false);
    });
    server.once('message', function(message) {
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

exports.testClose = function(test) {
    if (!listening) {
        test.done();
        return;
    }
    server.close(function() {
        test.done();
    });
};
