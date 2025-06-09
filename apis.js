module.exports = {
	init: init 
};

function init(RED) {
	var prefix = '/nodes/@brobridge/atomic-oracle/apis';

	RED.httpAdmin.post(prefix + '/execute', RED.auth.needsPermission('flows.write'), function(req, res) {

		let connection = RED.nodes.getNode(req.body.connection);
		if (!connection) {
			res.end();
			return;
		}

		(async () => {

			try {
				let rs = await request(connection, req.body.query);

				res.json({
					success: true,
					finished: rs.finished,
					results: rs.recordset || [],
					rowsAffected: rs.rowsAffected,
				});
			} catch(e) {
				console.log(e);

				res.json({
					success: false,
					error: {
						code: e.errorNum || null,
						message: e.message || null,
						stack: e.stack || null,
						lineNumber: e.offset || null,
					}
				});
			}
		})();
	});

	RED.httpAdmin.get(prefix + '/oracle-execute-nodes', RED.auth.needsPermission('flows.write'), function(req, res) {
		// Retrieve all nodes of type "Oracle Execute"
		const nodes = [];
		RED.nodes.eachNode(function(node) {
			if (node.type === 'Oracle Execute') {
				nodes.push({
					id: node.id,
					name: node.name || node.id,
					z: node.z // Get the flow ID
				});
			}
		});
		res.json(nodes);
	});
}

function request(connection, query) {

	return new Promise(async (resolve, reject) => {

		//Get connection pool
		let conn = await connection.getConn();
		//conn.callTimeout = 500;
		// use query stream
		let stream = conn.queryStream(query);

		let rows = [];
		stream.on('error', async err =>{
			stream.destroy();
			try {
				await conn.close();
			} catch (e) {
				console.warn("conn.close() failed during error handling:", e);
			}
			reject(err);
		})

		stream.on('data', async row => {

			// Do not return results which are more than 1,000
			if (rows.length == 1000) {
				//stream.pause();
				stream.destroy();
				try {
					await conn.close();
				} catch (e) {
					console.warn("conn.close() failed during error handling:", e);
				}
				resolve({
					finished: false,
					recordset: rows,
					//rowsAffected: rowsAffected,
				});

				return;
			}

			rows.push(row);
		});

		stream.on('end', async () => {
			stream.destroy();
			try {
				await conn.close();
			} catch (e) {
				console.warn("conn.close() failed during error handling:", e);
			}
			resolve({
				finished: true,
				recordset: rows,
			//	rowsAffected: rowsAffected,
			//	output: result.output,
			});
		});
	});
}
