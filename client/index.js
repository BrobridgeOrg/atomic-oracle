const events = require('events');
const util = require('util');
const oracledb = require('oracledb');

module.exports = class Client extends events.EventEmitter {

	constructor(conn = null, opts = {}) {
		super();

		oracledb.initOracleClient({ libDir: "/usr/lib/instantclient" });
		oracledb.autoCommit = true;
		oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

		this.opts = Object.assign({
				server: '0.0.0.0',
				port: 1521,
				database: '',
				connectionRetryInterval: 3000,
			}, opts.connection, {
				auth: Object.assign({
					//type: 'default',
					username: '',
					password: '',
				}, opts.connection.auth || {})
			});

		this.poolOpts = Object.assign({
			min: 1,
			max: 10,
			poolTimeout: 60, //second
			poolPingInterval: 60000, //Millisecond
			poolPingTimeout: 5000, // Millisecond
		}, opts.pool);

		this.status = 'disconnected';
		this.timer = null;
		this.pool = null;
	}

	async initPool() {
		try {
		    this.pool = await oracledb.createPool(this.getConnectionConfigs());
		    this.pool.setMaxListeners(0);
		    console.log("Connection pool created.");
		    this.status = 'connected';

		} catch (error) {

		    console.error("Error creating connection pool:", error);
		    this.status = 'disconnected';
		    this.emit('error', error);
		    throw error;
		}
	    }

	getConnectionConfigs() {

		// Preparing configurations
		let connectString = this.opts.server + ":" + this.opts.port + (this.opts.database ? "/" + this.opts.database : "");
		let configs = {
			user: this.opts.auth.username || '',
			password: this.opts.auth.password || '',
			connectString: connectString,
			poolMax:	this.poolOpts.max,
			poolMin:	this.poolOpts.min,
			poolTimeout: this.poolOpts.poolTimeout,
			poolPingInterval: this.poolOpts.poolPingInterval, //default
			poolPingTimeout: this.poolOpts.poolPingTimeout, //default
			//queueMax: 100,
			//queueTimeout: 500,

		};

		return configs;
	}

	getPool() {
		return this.pool;
	}

	async getConn() {
		return await this.pool.getConnection()
	}

	connect() {

		this.pool.getConnection()
			.then((conn) => {
				conn.callTimeout = 500;
				conn.close().then(() =>{
				});
				this.emit('connected');
			})
			.catch((e) => {

				// Reconnecting
				this.timer = setTimeout(() => {
					this.emit('reconnect')
					this.connect();
				}, this.opts.connectionRetryInterval);
			});

		clearTimeout(this.timer);
	};

	async disconnect() {
		try {
			await this.pool.close(0); // 30 seconds timeout for graceful termination
		}catch(e){
			throw e;
		}
	    	this.emit("disconnect");
	};
};
