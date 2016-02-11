## Changelog ##

### 0.4.3 ###
* Send along `source` to `message` event
* Added tests for websockets

### 0.4.2 ###
* Updated dependencies

### 0.4.1 ###
* Updated dependencies

### 0.4.0 ###
* Added `allowUndefinedOrigin` which defaults to true

### 0.3.5 ###
* Do not check origin for GET requests

### 0.3.4 ###
* Added setValidOrigin(newOrigin) to Portluck
* Fixed origin domain checking
* Added `:*` to special origin handling

### 0.3.3 ###
* Added Access-Control-Allow-Headers

### 0.3.2 ###
* Added overridable invalidMethodHandler to handle GET requests
* Detect when websocket is closed before writing in end()

### 0.3.1 ###
* Update to latest delimiterstream

### 0.3.0 ###
* ResponseWriter.end is now ResponseWriter.close
* ResponseWriter.end is now an alias for done
* ResponseWriter gets header methods like http.ServerResponse

### 0.2.0 ###
* Completely rewritten parsers
* Support for partial parser matches
* options.messageLimit added
* Fixed socket timeout handling
