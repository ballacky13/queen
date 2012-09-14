var createLogger = require("./logger.js").create;
var createBrowser = require("./browser.js").create;
var _ = require("underscore");
var EventEmitter = require("events").EventEmitter;
var uuid = require('node-uuid');

exports.create = function(socketServer){
	var emitter = new EventEmitter();
	var browserHub = new BrowserHub(emitter);
	browserHub.attachToServer(socketServer);
	return browserHub;
};

exports.BrowserHub = BrowserHub = function(emitter){
	this._emitter = emitter;
	this._browsers = {};
	this._id = uuid.v4();
	this._connectionHandler = _.bind(this._connectionHandler, this);

	this._logger = createLogger({prefix: "BrowserHub-" + this._id.substr(0,4) });
	this._logger.trace("Created");
};

// DEFAULT ATTRIBUTES
BrowserHub.prototype.registerationTimeout = 2000;
BrowserHub.prototype.reconnectionTimeout = 1000;

BrowserHub.prototype.attachToServer = function(server){
	var self = this;
		
	server.on("connection", self._connectionHandler);
};

BrowserHub.prototype.detachFromServer = function(server){
	server.removeListener("connection", this._connectionHandler);
};

BrowserHub.prototype.getBrowsers = function(filters){
	if(!_.isArray(filters)){
		filters = [filters];
	}

	var browsers = _.filter(this._browsers, function(browser){
		return _.any(filters, function(filter){
			return browser.hasAttributes(filter);
		});
	});

	return browsers;
};

BrowserHub.prototype.getId = function(){
	return this._id;
};

// EVENT HANDLERS
BrowserHub.prototype.on = function(event, callback){
	this._emitter.on(event, callback);
};

BrowserHub.prototype.removeListener = function(event, callback){
	this._emitter.removeListener(event, callback);
};

// BROWSER CONNECTION HANDLERS
BrowserHub.prototype._browserConnectHandler = function(browser){
	browserId = browser.getId();
	this._browsers[browserId] = browser;
	this._logger.debug("New browser connected " + browserId);
	this._emitter.emit("connected", browser);
};

BrowserHub.prototype._browserReconnectHandler = function(browser, socket){
	browser.setSocket(socket);
	browser.setConnected(true);
	socket.emit("reconnected");
	self._logger.debug("Browser reconnected " + browser.getId());
};

BrowserHub.prototype._browserDisconnectHandler = function(browser, reason){
	var browserId = browser.getId();
	browser.kill();
	delete this._browsers[browserId];

	if(reason){
		reason = ". Reason: " + reason;
	} else {
		reason = "";
	}

	this._logger.info("Browser disconnected : " + browserId + reason);
	this._emitter.emit("disconnected", browser);
};

// SOCKET CONNECTION HANDLERS
BrowserHub.prototype._connectionHandler = function(socket){
	var self = this,
		browser,
		browserId,
		registered = false;

	socket.on("register", function(registerationData){
		registered = true;
		if(registerationData && registerationData.id && self._browsers[registerationData.id] !== void 0){
			browser = self._browsers[registerationData.id];
			self._browserReconnectionHandler(browser, socket);
		} else {
			browser = createBrowser(registerationData, socket);
			self._browserConnectHandler(browser);
		}

		socket.on("disconnect", function(){
			if(browser.getSocket() === socket){
				self._disconnectHandler(browser);	
			}
		});
	});

	// Kill sockets that don't register fast enough
	var killTime = new Date().getTime() + this.registerationTimeout;
	(function disconnectNonregistrants(){
		var now;

		if(registered){
			return;
		}

		now = new Date().getTime();

		if(now < killTime){
			process.nextTick(disconnectNonregistrants)
		} else {
			socket.emit("error", {
				fault: 'client',
				message: 'Client failed to register within ' + self.registerationTimeout + 'ms'
			});
			socket.disconnect();
			self._logger.info("Socket disconnected due to registeration timeout");
		}
	}());
};


BrowserHub.prototype._disconnectHandler = function(browser){
	var self = this,
		browserId = browser.getId(),
		isBrowserConnected = false;
	
	browser.setConnected(false);
	browser.once("connected", function(){
		isBrowserConnected = true;
	});

	// Kill browsers that don't reconnect
	var killTime = new Date().getTime() + this.reconnectionTimeout;
	(function killIfNoReconnect(){
		var now;

		if(isBrowserConnected){ // Has browser reconnected?
			return;
		}

		now = new Date().getTime();

		if(now < killTime){
			process.nextTick(killIfNoReconnect)
		} else {
			self._browserDisconnectHandler(browser, "Reconnection timeout");
		}
	}());
};