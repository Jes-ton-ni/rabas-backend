const mysql = require('mysql2/promise');
const { Client } = require('ssh2');

const sshConfig = {
    host: process.env.SSH_HOST,
    port: process.env.SSH_PORT,
    username: process.env.SSH_USER,
    password: process.env.SSH_PASSWORD
};

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT
};

let globalPool = null;

const getPool = async () => {
    try {
        if (globalPool) {
            return globalPool;
        }

        console.log('Establishing SSH connection...');
        
        // Create SSH tunnel
        const sshConnection = new Client();
        
        // Wait for SSH connection
        await new Promise((resolve, reject) => {
            sshConnection
                .on('ready', () => {
                    console.log('SSH Connection established');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('SSH Connection error:', err);
                    reject(err);
                })
                .connect(sshConfig);
        });

        // Create port forward
        const stream = await new Promise((resolve, reject) => {
            sshConnection.forwardOut(
                '127.0.0.1',
                0,
                dbConfig.host,
                dbConfig.port,
                (err, stream) => {
                    if (err) {
                        console.error('Port forwarding error:', err);
                        reject(err);
                        return;
                    }
                    console.log('Port forwarding established');
                    resolve(stream);
                }
            );
        });

        // Create connection pool
        globalPool = mysql.createPool({
            ...dbConfig,
            stream: stream
        });

        // Set max listeners for the pool
        globalPool.setMaxListeners(15);

        // Add pool error handler
        globalPool.on('error', (err) => {
            console.error('Pool error:', err);
            globalPool = null;
        });

        return globalPool;
    } catch (err) {
        console.error('Error creating pool:', err);
        globalPool = null;
        throw err;
    }
};

const closePool = async () => {
    if (globalPool) {
        await globalPool.end();
        globalPool = null;
    }
};

module.exports = { getPool, closePool }; 