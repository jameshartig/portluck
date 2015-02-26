var portluck = require('./server.js');

var s = new portluck.Server();
s.on('message', function(message) {
    console.log('message', message);
});

s.listen(9999, function() {
    console.log("Listening on port 9999");
});