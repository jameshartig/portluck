var portluck = require('../server.js'),
    net = require('net'),
    http = require('http'),
    listenOptions = {port: 14999, host: '127.0.0.1'},
    httpOptions = {port: listenOptions.port, hostname: listenOptions.host, method: 'POST', path: '/', agent: false},
    testString = '{"test":true}',
    serverOptions = {allowOrigin: '*.example.com'},
    server = new portluck.Server(null, serverOptions),
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
function reListen(cb) {
    if (listening) {
        server.close(function() {
            server = new portluck.Server(null, serverOptions);
            listen(cb);
        });
        return;
    }
    listen(cb);
}

exports.wildcardTestExampleCom = function(test) {
    test.expect(4);
    serverOptions.allowOrigin = '*.example.com';
    reListen(function() {
        var conn;
        server.once('clientConnect', function(writer, socket) {
            test.ok(socket.remoteAddress, listenOptions.host);
        });
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.headers['access-control-allow-origin'], 'test.example.com');
            test.equal(resp.headers['access-control-allow-headers'], 'DNT,User-Agent,X-Requested-With,Content-Type');
            test.equal(resp.statusCode, 200);
            test.done();
        });
        conn.setHeader('Origin', 'test.example.com');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.wildcardExampleCom = function(test) {
    test.expect(2);
    serverOptions.allowOrigin = '*.example.com';
    reListen(function() {
        var conn;
        server.once('clientConnect', function(writer, socket) {
            test.equal(socket.remoteAddress, listenOptions.host);
        });
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 200);
            test.done();
        });
        conn.setHeader('Origin', 'example.com');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.wildcardFailCom = function(test) {
    test.expect(1);
    serverOptions.allowOrigin = '*.example.com';
    reListen(function() {
        var conn;
        server.once('clientConnect', function() {
            test.equal(false);
        });
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 400);
            test.done();
        });
        conn.setHeader('Origin', 'fail.com');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.wwwExampleCom = function(test) {
    test.expect(1);
    serverOptions.allowOrigin = 'example.com';
    reListen(function() {
        var conn;
        server.once('clientConnect', function() {
            test.equal(false);
        });
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 400);
            test.done();
        });
        conn.setHeader('Origin', 'www.example.com');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.exampleCom = function(test) {
    test.expect(4);
    serverOptions.allowOrigin = 'example.com';
    reListen(function() {
        var conn;
        server.once('clientConnect', function(writer, socket) {
            test.equal(socket.remoteAddress, listenOptions.host);
        });
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.headers['access-control-allow-origin'], 'example.com');
            test.equal(resp.headers['access-control-allow-headers'], 'DNT,User-Agent,X-Requested-With,Content-Type');
            test.equal(resp.statusCode, 200);
            test.done();
        });
        conn.setHeader('Origin', 'example.com');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.exampleComSetValidOrigin = function(test) {
    test.expect(1);
    serverOptions.allowOrigin = 'nowork.com';
    reListen(function() {
        var conn;
        server.setValidOrigin('example.com');
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 200);
            test.done();
        });
        conn.setHeader('Origin', 'example.com');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

//for some reason this throws a HPE_INVALID_METHOD if you write a http body
exports.exampleComPreflight = function(test) {
    test.expect(2);
    serverOptions.allowOrigin = 'example.com';
    reListen(function() {
        var conn;
        server.once('clientConnect', function() {
            test.ok(false);
        });
        conn = http.request(Object.extend(httpOptions, {method: 'OPTIONS'}), function(resp) {
            test.equal(resp.headers['access-control-allow-origin'], 'example.com');
            test.equal(resp.statusCode, 200);
            test.done();
        });
        conn.setHeader('Origin', 'example.com');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.end();
    });
};

exports.exampleComFaked = function(test) {
    test.expect(1);
    serverOptions.allowOrigin = 'example.com';
    reListen(function() {
        var conn;
        server.once('clientConnect', function(writer, socket) {
            test.ok(false);
        });
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 400);
            test.done();
        });
        conn.setHeader('Origin', 'example.com.co.nz');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.starExampleComFaked = function(test) {
    test.expect(1);
    serverOptions.allowOrigin = '*.example.com';
    reListen(function() {
        var conn;
        server.once('clientConnect', function(writer, socket) {
            test.ok(false);
        });
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 400);
            test.done();
        });
        conn.setHeader('Origin', 'example.com.co.nz');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.exampleComAnyPort80 = function(test) {
    test.expect(1);
    serverOptions.allowOrigin = 'example.com:*';
    reListen(function() {
        var conn;
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 200);
            test.done();
        });
        conn.setHeader('Origin', 'example.com');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.exampleComAnyPort4000 = function(test) {
    test.expect(1);
    serverOptions.allowOrigin = 'example.com:*';
    reListen(function() {
        var conn;
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 200);
            test.done();
        });
        conn.setHeader('Origin', 'example.com:4000');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.exampleComFakedAnyPort4000 = function(test) {
    test.expect(1);
    serverOptions.allowOrigin = 'example.com:*';
    reListen(function() {
        var conn;
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 400);
            test.done();
        });
        conn.setHeader('Origin', 'example.com.co.nz:4000');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.originNotCheckedForGet = function(test) {
    test.expect(1);
    serverOptions.allowOrigin = 'example.com';
    reListen(function() {
        var conn;
        conn = http.request(Object.extend(httpOptions, {method: 'GET'}), function(resp) {
            test.equal(resp.statusCode, 405);
            test.done();
        });
        conn.setHeader('Origin', 'somethingelse.com');
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.originUndefinedDefault = function(test) {
    test.expect(1);
    serverOptions.allowOrigin = 'example.com';
    reListen(function() {
        var conn;
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 200);
            test.done();
        });
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
};

exports.originUndefinedBlock = function(test) {
    test.expect(1);
    serverOptions.allowUndefinedOrigin = false;
    reListen(function() {
        delete serverOptions.allowUndefinedOrigin;
        var conn;
        conn = http.request(httpOptions, function(resp) {
            test.equal(resp.statusCode, 400);
            test.done();
        });
        conn.setTimeout(5000);
        conn.once('timeout', function() {
            conn.destroy();
            test.ok(false);
        });
        //send our post body and finish
        conn.write(testString);
        conn.end();
    });
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
