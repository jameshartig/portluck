## Changelog ##

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