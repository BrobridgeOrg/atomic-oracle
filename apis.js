module.exports = {
	init: init 
};

function init(RED) {
	var prefix = '/nodes/atomic-oracle/apis';

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
						state: e.code,
						number: e.errorNum,
						lineNumber: e.offset,
						message: e.message
					}
				});
			}
		})();
	});
}

function request(connection, query) {

	return new Promise(async (resolve, reject) => {

		//Get connection pool
		let conn = await connection.getConn();
		conn.callTimeout = 500;
		// use query stream
		let stream = conn.queryStream(query);

		let rows = [];
		stream.on('error', err =>{
			reject(err);
			conn.close().then((err) => {
				console.log(err);
			});
		})

		stream.on('data', row => {

			// Do not return results which are more than 1,000
			if (rows.length == 1000) {
				stream.pause();
				resolve({
					finished: false,
					recordset: rows,
					//rowsAffected: rowsAffected,
				});

				return;
			}

			rows.push(row);
		});

		stream.on('end', () => {
			resolve({
				finished: true,
				recordset: rows,
			//	rowsAffected: rowsAffected,
			//	output: result.output,
			});
			stream.destroy();
			conn.close().then((err) => {
				//console.log(err);
			});
		});
	});
}
