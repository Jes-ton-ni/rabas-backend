const mysql = require('mysql2/promise');
const { Client } = require('ssh2');

const sshConfig = {
    host: '153.92.11.26',
    port: 65002,
    username: 'u856995433',
    password: '@Rabas12345'
};

const dbConfig = {
    host: '127.0.0.1',
    user: 'u856995433_root',
    password: 'Rabas12345',
    database: 'u856995433_rabas',
    port: 3306
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