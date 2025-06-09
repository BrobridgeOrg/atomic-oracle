const events = require('events');
const util = require('util');
const oracledb = require('oracledb');

module.exports = class Client extends events.EventEmitter {

	constructor(conn = null, opts = {}) {
		super();

		// INSERT_YOUR_CODE
		// Note: Developers can modify the Oracle driver location here during development
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
			queueMax: 100,
			queueTimeout: 15000,

		};

		return configs;
	}

	getPool() {
		return this.pool;
	}

	async getConn() {
		let conn = await this.pool.getConnection()
		conn.callTimeout = 1000;
		return conn
	}

	connect() {
		//console.debug("[oracle-client] Initiating connection test...");

		// 若已有 timer 正在等待，先清除
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		this.pool.getConnection()
			.then(async (conn) => {
				try {
					//conn.callTimeout = 500;
					await conn.close();
					this.emit('connected');
				} catch (closeErr) {
					console.warn("[oracle-client] Connection test succeeded but close failed:", closeErr);
					this.emit('connected'); // 即使 close 錯，仍算 connected
				}
			})
			.catch((e) => {
				console.warn("[oracle-client] Connection failed. Will retry in", this.opts.connectionRetryInterval, "ms");

				this.timer = setTimeout(() => {
					this.emit('reconnect');
					this.connect();
				}, this.opts.connectionRetryInterval);
			});
	}

	async disconnect() {
		clearTimeout(this.timer);

		const forceExit = setTimeout(() => {
			console.warn("[oracle-client] Force shutdown due to stuck pool.close()");
			process.exit(0);
		}, 15000); // fallback 防止永遠卡死

		try {

			//console.log('[oracle-client] Pool connections in use:', this.pool.connectionsInUse);
			// Wait a little to avoid Oracle internal close bug
			await new Promise(resolve => setTimeout(resolve, 100));

			await this.pool.close(0);
			console.log('[oracle-client] Pool closed successfully.');
			this.pool = null;
		} catch (e) {
			console.warn('[oracle-client] Pool close failed:', e);
		} finally {
			clearTimeout(forceExit);
			this.emit("disconnect");
			this.removeAllListeners();
			console.log("[oracle-client] Cleaned up listeners and pool.");
		}
	}
};
