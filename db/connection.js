const mysql = require('mysql2/promise');
const { Client } = require('ssh2');

let globalPool = null;
let sshConnection = null;
let isConnecting = false;
let reconnectTimeout = null;

const RETRY_DELAY = 5000; // 5 seconds
const MAX_RETRIES = 3;

const createSSHTunnel = async (retryCount = 0) => {
    if (isConnecting) {
        console.log('Connection attempt already in progress...');
        return null;
    }

    try {
        isConnecting = true;

        if (sshConnection) {
            sshConnection.end();
            sshConnection = null;
        }

        sshConnection = new Client();

        const stream = await new Promise((resolve, reject) => {
            sshConnection
                .on('ready', () => {
                    console.log('SSH Connection established');
                    sshConnection.forwardOut(
                        '127.0.0.1',
                        0,
                        process.env.DB_HOST,
                        parseInt(process.env.DB_PORT),
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
                })
                .on('error', (err) => {
                    console.error('SSH Connection error:', err);
                    reject(err);
                })
                .on('end', () => {
                    console.log('SSH Connection ended normally');
                })
                .on('close', () => {
                    console.log('SSH Connection closed');
                    if (globalPool) {
                        handleReconnect();
                    }
                })
                .connect({
                    host: process.env.SSH_HOST,
                    port: parseInt(process.env.SSH_PORT),
                    username: process.env.SSH_USER,
                    password: process.env.SSH_PASSWORD,
                    keepaliveInterval: 30000,
                    keepaliveCountMax: 5,
                    readyTimeout: 30000,
                    
                    // debug: (msg) => console.log('SSH Debug:', msg)
                });
        });

        return stream;
    } catch (err) {
        console.error(`SSH tunnel creation failed (attempt ${retryCount + 1}/${MAX_RETRIES}):`, err);
        
        if (retryCount < MAX_RETRIES - 1) {
            console.log(`Retrying in ${RETRY_DELAY/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return createSSHTunnel(retryCount + 1);
        }
        
        throw err;
    } finally {
        isConnecting = false;
    }
};

const handleReconnect = async () => {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }

    reconnectTimeout = setTimeout(async () => {
        try {
            console.log('Attempting to reconnect...');
            await getPool(true);
        } catch (err) {
            console.error('Reconnection failed:', err);
        }
    }, RETRY_DELAY);
};

const getPool = async (forceNew = false) => {
    try {
        if (!forceNew && globalPool) {
            try {
                await globalPool.query('SELECT 1');
                return globalPool;
            } catch (err) {
                console.log('Existing connection failed, creating new one...');
                if (globalPool) {
                    await globalPool.end().catch(console.error);
                }
                globalPool = null;
            }
        }

        const stream = await createSSHTunnel();
        if (!stream) return null;

        globalPool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE,
            port: parseInt(process.env.DB_PORT),
            stream: stream,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 30000,
            multipleStatements: true,
            connectTimeout: 60000
        });

        // Test the connection
        await globalPool.query('SELECT 1');
        console.log('Database connection successful');

        return globalPool;
    } catch (err) {
        console.error('Error creating pool:', err);
        if (globalPool) {
            await globalPool.end().catch(console.error);
            globalPool = null;
        }
        throw err;
    }
};

const closeConnections = async () => {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    try {
        if (globalPool) {
            await globalPool.end();
            globalPool = null;
            console.log('Database pool closed');
        }
        if (sshConnection) {
            sshConnection.end();
            sshConnection = null;
            console.log('SSH connection closed');
        }
    } catch (err) {
        console.error('Error closing connections:', err);
    }
};

// Handle process termination
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await closeConnections();
    process.exit(0);
});

process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
    await closeConnections();
    process.exit(1);
});

module.exports = { getPool, closeConnections };
