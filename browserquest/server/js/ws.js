var cls = require("./lib/class"),
    url = require("url"),
    fs = require("fs"),
    pathModule = require("path"),
    WebSocket = require("websocket"),
    http = require("http"),
    Utils = require("./utils"),
    _ = require("underscore"),
    BISON = require("bison"),
    WS = {},
    useBison = false;

module.exports = WS;

var Server = cls.Class.extend({
    init: function(port) {
        this.port = port;
    },

    onConnect: function(callback) {
        this.connection_callback = callback;
    },

    onError: function(callback) {
        this.error_callback = callback;
    },

    broadcast: function(message) {
        throw "Not implemented";
    },

    forEachConnection: function(callback) {
        _.each(this._connections, callback);
    },

    addConnection: function(connection) {
        this._connections[connection.id] = connection;
    },

    removeConnection: function(id) {
        delete this._connections[id];
    },

    getConnection: function(id) {
        return this._connections[id];
    }
});

var Connection = cls.Class.extend({
    init: function(id, connection, server) {
        this._connection = connection;
        this._server = server;
        this.id = id;
    },

    onClose: function(callback) {
        this.close_callback = callback;
    },

    listen: function(callback) {
        this.listen_callback = callback;
    },

    broadcast: function(message) {
        throw "Not implemented";
    },

    send: function(message) {
        throw "Not implemented";
    },

    sendUTF8: function(data) {
        throw "Not implemented";
    },

    close: function(logError) {
        log.info("Closing connection to " +
            this._connection.remoteAddress + ". Error: " + logError);
        this._connection.close();
    }
});

WS.MultiVersionWebsocketServer = Server.extend({
    worlizeServerConfig: {
        maxReceivedFrameSize: 0x10000,
        maxReceivedMessageSize: 0x100000,
        fragmentOutgoingMessages: true,
        fragmentationThreshold: 0x4000,
        keepalive: true,
        keepaliveInterval: 20000,
        assembleFragments: true,
        disableNagleAlgorithm: true,
        closeTimeout: 5000
    },

    _connections: {},
    _counter: 0,

    init: function(port) {
        var self = this;

        this._super(port);

        var clientRoot = pathModule.resolve(__dirname, "../../client-build");

        this._httpServer = http.createServer(function(request, response) {
            var pathname = url.parse(request.url).pathname;

            if(pathname === "/status" && self.status_callback) {
                response.writeHead(200, {
                    "Content-Type": "application/json"
                });
                response.end(self.status_callback());
                return;
            }

            if(request.method !== "GET" && request.method !== "HEAD") {
                response.writeHead(405, { "Allow": "GET, HEAD" });
                response.end("Method Not Allowed");
                return;
            }

            try {
                pathname = decodeURIComponent(pathname);
            } catch(error) {
                response.writeHead(400);
                response.end("Bad Request");
                return;
            }

            var filePath = pathModule.resolve(clientRoot, "." + pathname);

            if(filePath !== clientRoot &&
               !filePath.startsWith(clientRoot + pathModule.sep)) {
                response.writeHead(403);
                response.end("Forbidden");
                return;
            }

            if(filePath === clientRoot) {
                filePath = pathModule.join(clientRoot, "index.html");
            }

            fs.stat(filePath, function(error, stats) {
                if(error || !stats.isFile()) {
                    response.writeHead(404);
                    response.end("Not Found");
                    return;
                }

                var extension = pathModule.extname(filePath).toLowerCase();
                var mimeTypes = {
                    ".html": "text/html; charset=utf-8",
                    ".js": "application/javascript; charset=utf-8",
                    ".css": "text/css; charset=utf-8",
                    ".json": "application/json; charset=utf-8",
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".gif": "image/gif",
                    ".svg": "image/svg+xml",
                    ".ico": "image/x-icon",
                    ".mp3": "audio/mpeg",
                    ".ogg": "audio/ogg",
                    ".wav": "audio/wav",
                    ".woff": "font/woff",
                    ".woff2": "font/woff2",
                    ".ttf": "font/ttf",
                    ".eot": "application/vnd.ms-fontobject"
                };

                response.writeHead(200, {
                    "Content-Type": mimeTypes[extension] || "application/octet-stream",
                    "Content-Length": stats.size,
                    "Cache-Control": "no-cache"
                });

                if(request.method === "HEAD") {
                    response.end();
                    return;
                }

                var stream = fs.createReadStream(filePath);
                stream.on("error", function() {
                    if(!response.headersSent) {
                        response.writeHead(500);
                    }
                    response.end("Internal Server Error");
                });
                stream.pipe(response);
            });
        });

        this._httpServer.on("upgrade", function(req, socket, head) {
            var wsRequest = new WebSocket.request(
                socket,
                req,
                self.worlizeServerConfig
            );

            try {
                wsRequest.readHandshake();

                var protocol = wsRequest.requestedProtocols.length > 0
                    ? wsRequest.requestedProtocols[0]
                    : null;

                var wsConnection = wsRequest.accept(
                    protocol,
                    wsRequest.origin
                );

                var connection = new WS.worlizeWebSocketConnection(
                    self._createId(),
                    wsConnection,
                    self
                );

                connection._connection.remoteAddress =
                    req.socket.remoteAddress;

                if(self.connection_callback) {
                    self.connection_callback(connection);
                }

                self.addConnection(connection);
            } catch(e) {
                console.error("WebSocket handshake failed:", e.message);
                socket.destroy();
            }
        });

        this._httpServer.on("error", function(error) {
            if(self.error_callback) {
                self.error_callback(error);
            } else {
                console.error("HTTP server error:", error);
            }
        });

        this._httpServer.listen(port, function() {
            log.info("Server is listening on port " + port);
        });
    },

    _createId: function() {
        return "5" + Utils.random(99) + "" + (this._counter++);
    },

    broadcast: function(message) {
        this.forEachConnection(function(connection) {
            connection.send(message);
        });
    },

    onRequestStatus: function(status_callback) {
        this.status_callback = status_callback;
    }
});

WS.worlizeWebSocketConnection = Connection.extend({
    init: function(id, connection, server) {
        var self = this;

        this._super(id, connection, server);

        this._connection.on("message", function(message) {
            if(self.listen_callback && message.type === "utf8") {
                if(useBison) {
                    self.listen_callback(BISON.decode(message.utf8Data));
                } else {
                    try {
                        self.listen_callback(JSON.parse(message.utf8Data));
                    } catch(e) {
                        if(e instanceof SyntaxError) {
                            self.close("Received message was not valid JSON.");
                        } else {
                            throw e;
                        }
                    }
                }
            }
        });

        this._connection.on("close", function() {
            if(self.close_callback) {
                self.close_callback();
            }

            self._server.removeConnection(self.id);
        });
    },

    send: function(message) {
        var data = useBison
            ? BISON.encode(message)
            : JSON.stringify(message);

        this.sendUTF8(data);
    },

    sendUTF8: function(data) {
        this._connection.sendUTF(data);
    }
});
