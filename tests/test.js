var portluck = require('../server.js'),
    net = require('net'),
    http = require('http'),
    listenOptions = {port: 14999, host: '127.0.0.1'},
    httpOptions = {port: listenOptions.port, hostname: listenOptions.host, method: 'POST', path: '/', agent: false},
    testString = '{"test":true}',
    server = new portluck.Server(),
    listening = false;

exports.setUp = function(callback) {
    if (listening) {
        return;
    }
    server.listen(listenOptions, callback);
    //we don't care if we die and the server is still around
    server.unref();
};


exports.testSimpleSocket = function(test) {
    test.expect(2);
    var conn;
    server.once('clientConnect', function(socket) {
        test.equal(socket.remoteAddress, listenOptions.host);
    });
    server.once('message', function(message) {
        test.strictEqual(message.toString(), testString);
    });
    server.once('clientDisconnect', function(socket) {
        test.done();
    });
    conn = net.createConnection(listenOptions, function() {
        conn.end(testString + "\n");
    });
};

exports.testSimpleHTTP = function(test) {
    test.expect(3);
    var conn;
    server.once('clientConnect', function(socket) {
        test.equal(socket.remoteAddress, listenOptions.host);
    });
    server.once('message', function(message) {
        test.strictEqual(message.toString(), testString);
    });
    server.once('clientDisconnect', function(socket) {
        process.nextTick(function() {
            test.done();
        });
    });
    conn = http.request(httpOptions, function(resp) {
        test.equal(resp.statusCode, 200);
    });
    conn.write(testString);
    conn.end();
};
