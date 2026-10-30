var levels = {
    ERROR: 0,
    INFO: 1,
    DEBUG: 2
};

function Logger(level) {
    this.level = level;
}

Logger.ERROR = levels.ERROR;
Logger.INFO = levels.INFO;
Logger.DEBUG = levels.DEBUG;

Logger.prototype.error = function(message) {
    if(this.level >= levels.ERROR) {
        console.error("[ERROR] " + message);
    }
};

Logger.prototype.info = function(message) {
    if(this.level >= levels.INFO) {
        console.log("[INFO] " + message);
    }
};

Logger.prototype.debug = function(message) {
    if(this.level >= levels.DEBUG) {
        console.log("[DEBUG] " + message);
    }
};

module.exports = Logger;
