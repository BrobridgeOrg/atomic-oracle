const atomicSDK = require('@brobridge/atomic-sdk');

module.exports = function(RED) {

	function genQueryCmd() {
		return Array.from(arguments);
	}

	function genQueryCmdParameters(tpl, msg) {
		const regex = /\$\{([^}]+)\}/g;  // 找到所有 ${變數}
		let index = 1;
		let binds = {};

		// 1. 保留註解中的變數 (適用於 `--` 單行註解)
		tpl = tpl.replace(/--(.*)$/gm, (match, comment) => {
			return `--` + comment.replace(regex, (_, key) => `<!--${key}-->`);
		});

		// 2. 保留註解中的變數 (適用於 `/* ... */` 多行註解)
		tpl = tpl.replace(/\/\*([\s\S]*?)\*\//gm, (match, comment) => {
			return `/*` + comment.replace(regex, (_, key) => `<!--${key}-->`) + `*/`;
		});

		// 3. 替換 SQL 變數為 `:paramX`
		let sql = tpl.replace(regex, (_, key) => {
			const paramName = `param${index++}`;
			try {
			    binds[paramName] = new Function("msg", `return ${key};`)(msg); // **避免使用 eval**
			} catch (error) {
			    console.error(`Error processing variable: ${key}`, error);
			    binds[paramName] = null; // 若取值失敗，預設為 `null`
			}
			return `:${paramName}`; // 讓 SQL 語法符合 OracleDB 標準
		});

		// 4. 恢復註解內的變數
		sql = sql.replace(/<!--([\s\S]*?)-->/gm, (_, key) => `\${${key.trim()}}`);

		return { sql, binds };
	}

	function sanitizedCmd(raw) {
		return raw.replaceAll('\`', '\\\`');
	}

	function ExecuteNode(config) {
		RED.nodes.createNode(this, config);

		var node = this;
		this.connection = RED.nodes.getNode(config.connection)
		this.config = config;
		this.config.outputPropType = config.outputPropType || 'msg';
		this.config.outputProp = config.outputProp || 'payload';
		this.tpl = sanitizedCmd(node.config.command) || '';

		this.config.maxbatchrecords = parseInt(config.maxbatchrecords) || 100;
		this.config.stream = (config.deliveryMethod == 'streaming') ? true : false;

		// Register the node as a Atomic Component
		atomicSDK.registerAtomicComponent(node);
		atomicSDK.enableSessionManager(node);

		// Get the session manager
		let sm = node.atomic.getModule('SessionManager');

		if (!this.connection) {
			node.status({
				fill: 'red',
				shape: 'ring',
				text: 'disconnected'
			});
			return;
		}

		node.on('input', async (msg, send, done) => {

			if (node.config.querySource === 'dynamic' && !msg.query)
				return;

			let conn = null;
			try {
				conn = await node.connection.getConn();
			} catch (e) {
				console.error('[Oracle Connect Error]', e.stack);
				node.status({ fill: 'red', shape: 'ring', text: e.toString() });
				done(e);
				return;
			}

			let tpl = node.tpl;
			if (msg.query) {
				// higher priority for msg.query
				tpl = sanitizedCmd(msg.query);
			}

			node.status({
				fill: 'blue',
				shape: 'dot',
				text: 'requesting'
			});

			// Prparing request
			let err = null;
			let rows = [];
			let request = {
				stream: true,
				conn: conn,
				cancelled: false
			};

			// Create a session for the reader
			let session = (node.config.stream) ? sm.createSession() : null;
			if (session) {
			  session.request = request;
			  session.on('resume', function() {
				if (request.streamObj && request.streamObj.readable) {
					request.streamObj.resume();
				}
			  });

			  session.once('close', function() {
				request.cancelled = true;
				if (request.streamObj) {
					request.streamObj.destroy();
				}
				if (request.conn) {
					try {
						request.conn.close();
					} catch (e) {
						console.warn("Connection close failed:", e);
					}
				}
				done();
			  });
			}

			// Simulate request.on('row') event handling
			const handleRowEvent = (row) => {
				rows.push(row);

				// not streaming
				if (!node.config.stream)
					return;

				if (rows.length < node.config.maxbatchrecords)
					return;

				if (request.streamObj && request.streamObj.pause) {
					request.streamObj.pause();
				}

				if (node.config.outputPropType == 'msg') {
					let m = Object.assign({}, msg);
					if (session) {
					  session.bindMessage(m);
					}

					m[node.config.outputProp] = {
						results: rows,
						rowsAffected: rows.length,
						complete: false,
					}

					node.status({
						fill: 'blue',
						shape: 'dot',
						text: 'streaming'
					});

					node.send(m);

					// Reset buffer
					rows = [];
				}
			};

			// Simulate request.on('done') event handling
			const handleDoneEvent = (returnedValue) => {
				if (err) {
					done(err);
					return;
				}

				node.status({
					fill: 'green',
					shape: 'dot',
					text: 'done'
				});

				// Preparing result
				if (node.config.outputPropType == 'msg') {
					msg[node.config.outputProp] = {
						results: rows,
						rowsAffected: returnedValue || rows.length,
						complete: true,
					}
				}

				node.send(msg);

				if (session) {
				  session.close();
				} else if (request.conn) {
					try {
						request.conn.close();
					} catch (e) {
						console.warn("Connection close failed:", e);
					}
				}

				// Reset buffer
				rows = [];

				done();
			};

			// Simulate request.on('error') event handling
			const handleErrorEvent = (e) => {
			  console.error('[Oracle Query Error Stack]', e.stack);

			  if (session) {
				session.close();
			  } else if (request.conn) {
				try {
					request.conn.close();
				} catch (closeError) {
					console.warn("Connection close failed during error handling:", closeError);
				}
			  }

			  // Reset buffer
			  rows = [];

			  err = e;

			  node.status({
				fill: 'red',
				shape: 'ring',
				text: err.toString()
			  });

			  msg.error = {
				code: err.errorNum || err.code,
				lineNumber: err.offset || err.lineNumber,
				message: err.message,
				name: err.name,
				number: err.errorNum || err.number,
			  };

			  node.send(msg);
			};

			let sql = null;
			let binds = null;
			try {
				let queryParams = genQueryCmdParameters(tpl, msg);
				sql = queryParams.sql;
				binds = queryParams.binds;
			} catch (e) {
				node.error(e);
				if (request.conn) {
					try {
						request.conn.close();
					} catch (closeError) {
						console.warn("Connection close failed:", closeError);
					}
				}
				done();
				return
			}

			// Execute SQL command - adapting Oracle API to match MSSQL pattern
			if (node.config.stream) {
				try {
					// Use queryStream for streaming, but wrap it to match MSSQL request pattern
					request.streamObj = request.conn.queryStream(sql, binds);
					
					request.streamObj.on('data', (row) => {
						if (request.cancelled) return;
						handleRowEvent(row);
					});

					request.streamObj.once('end', () => {
						if (request.cancelled) return;
						handleDoneEvent(rows.length);
					});

					request.streamObj.once('error', (e) => {
						if (request.cancelled) return;
						handleErrorEvent(e);
					});

				} catch (e) {
					handleErrorEvent(e);
				}
			} else {
				// For non-streaming, use execute but process through the same event handlers
				try {
					let rs = await request.conn.execute(sql, binds);
					
					// Process all rows through the row handler
					if (rs.rows && rs.rows.length > 0) {
						rs.rows.forEach(row => handleRowEvent(row));
					}

					handleDoneEvent(rs.rowsAffected || 0);
				} catch (queryErr) {
					handleErrorEvent(queryErr);
				}
			}
		});

		node.on('close', async () => {

		  // Release all sessions
		  for (let session of sm.sessions) {
			session.close();
			if (session.request && session.request.conn) {
				try {
					session.request.conn.close();
				} catch (e) {
					console.warn("Connection close failed during cleanup:", e);
				}
			}
		  }

		  atomicSDK.releaseNode(node);
		});
	}

	// Admin API
	const api = require('./apis');
	api.init(RED);

	RED.nodes.registerType('Oracle Execute', ExecuteNode, {
		credentials: {
		}
	});
}
