module.exports = function(RED) {

	function genQueryCmd() {
		return Array.from(arguments);
	}

	function genQueryCmdParameters(tpl, msg) {
		return eval('genQueryCmd`' + tpl + '`');
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
		this.onStop = false;

		if (!this.connection) {
			node.status({
				fill: 'red',
				shape: 'ring',
				text: 'disconnected'
			});
			return;
		}

		node.on('input', async (msg, send, done) => {
			if (this.onStop) {
				node.error('atomic on stopping ...')
				return;
			}

			if (node.config.querySource === 'dynamic' && !msg.query)
				return;

			let tpl = node.tpl;
			if (msg.query) {
				// higher priority for msg.query
				tpl = sanitizedCmd(msg.query);
			}

			let conn = null;
			try {
				conn = await this.connection.getConn()
				//conn.callTimeout = 1000;
				node.status({
					fill: 'blue',
					shape: 'dot',
					text: 'requesting'
				});

				let { sql, binds } = genQueryCmdParameters(tpl, msg);
				let rs = await conn.execute(sql, binds);
				node.status({
					fill: 'green',
					shape: 'dot',
					text: 'done'
				});

				// Preparing result
				if (node.config.outputPropType == 'msg') {
					msg[node.config.outputProp] = {
						results: rs.rows || [],
						rowsAffected: rs.rowsAffected || null,
					}
				}

				node.send(msg);
				done();
			} catch(e) {
				node.status({
					fill: 'red',
					shape: 'ring',
					text: e.toString()
				});

				if (!msg.error) {
					msg.error = {
						code: e.errorNum || null,
						message: e.message || null,
						stack: e.stack || null,
						lineNumber: e.offset || null,
					};
				}

				node.error(e);
				done(e)
			} finally {
				if (conn) {
					try{
						await conn.close();
						conn = null
					} catch(e){
						//console.log(e);
						//console.warn("Connection might already be closed.");
					}
				}
			}
		});

		node.on('close', async () => {
			this.onStop=true;
			/*
				if (this.conn) {
					try{
						await this.conn.close();
					} catch(e){
						console.log(e);
						//console.warn("Connection might already be closed.");
					}
				}
			*/
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
