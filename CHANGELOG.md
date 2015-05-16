## Changelog ##

### 0.3.0 ###
* ResponseWriter.end is now ResponseWriter.close
* ResponseWriter.end is now an alias for done
* ResponseWriter gets header methods like http.ServerResponse

### 0.2.0 ###
* Completely rewritten parsers
* Support for partial parser matches
* options.messageLimit added
* Fixed socket timeout handling