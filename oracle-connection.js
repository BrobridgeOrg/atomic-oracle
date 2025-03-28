module.exports = function (RED) {
    function OracleConnectionNode(n) {
        RED.nodes.createNode(this, n)
        let node = this;

        this.client = null;
        this.status = 'disconnected';
        // Options
        this.connConfig = {
            server: n.server,
            port: Number(n.port),
            database: n.database,
            connectionRetryInterval: Number(n.connectionRetryInterval) || 3000,
            auth: {
                //type: n.authType || 'default',
                username: this.credentials.username || 'sa',
                password: this.credentials.password || ''
            },
        };
        //console.log(n);
        this.poolConfig = {
            min: (Number(n.poolMin) >= 0)? Number(n.poolMin):1,
            max: Number(n.poolMax) || 10,
            poolPingInterval: Number(n.poolPingInterval)*1000 || 60000,
            poolPingTimeout: Number(n.poolPingTimeout)*1000 || 5000,
            poolTimeout: Number(n.poolTimeout) || 60, // second
        };
        // Create original client
        let Client = require('./client');
        this.client = new Client(null, {
            connection: this.connConfig,
            pool: this.poolConfig,
        });
        //this.client.initPool();
        this.client.initPool().then(() => {
            // Setup events
            this.client.on('disconnect', () => {
                this.status = 'disconnected';
                node.log('Disconnected from server: ' + node.connConfig.server + ':' + node.connConfig.port);
            });
            this.client.on('reconnect', () => {
                this.status = 'reconnecting';
                node.log('Reconnecting to server: ' + node.connConfig.server + ':' + node.connConfig.port);
            });
            this.client.on('connected', (err) => {
                if (err) {
                    node.log('Failed to connect to Oracle Database: ' + err)
                    this.status = 'disconnected';
                    return
                }
                node.log('Connected to Oracle Database: ' + node.connConfig.server + ':' + node.connConfig.port);
                    node.log("Connection pool initialized.");
                this.status = 'connected';
            });
            this.client.on('error', (err) => {
                node.error(err)
            });
            node.log('Connecting to Oracle Database: ' + node.connConfig.server + ':' + node.connConfig.port);
            this.client.connect();
            this.getPool = function() {
                return node.client.getPool();
            };
            this.getConn = async function() {
                return await node.client.getConn();
            };
	
            node.on('close', async function() {
		    try{
			    await node.client.disconnect();
		    }catch(e){
			    console.log(e);
		    }
            })
        }).catch((err) => {
            console.error("Failed to initialize connection pool:", err);
        });
    }


    RED.nodes.registerType('Oracle Connection', OracleConnectionNode, {
        credentials: {
            username: {
                    type: 'text'
            },
            password: {
                    type: 'password'
            }
        }
    })
}
