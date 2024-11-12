const mysql = require('mysql2/promise');
const { Client } = require('ssh2');
const NodeCache = require("node-cache");

const sshConfig = {
    host: process.env.SSH_HOST,
    port: process.env.SSH_PORT,
    username: process.env.SSH_USER,
    password: process.env.SSH_PASSWORD,
    keepaliveInterval: 10000,
    keepaliveCountMax: 5,
};

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT,
    connectTimeout: 10000,
};

let globalPool = null;
let sshConnection = null;

// Cache for frequently requested data to reduce database load
const cache = new NodeCache({ stdTTL: 10, checkperiod: 12 }); // Cache for 10 seconds

const createSSHTunnel = async (retries = 3) => {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            // Close existing connection if any
            if (sshConnection) {
                sshConnection.end();
                sshConnection = null;
            }

            sshConnection = new Client();

            // Create new SSH connection
            await new Promise((resolve, reject) => {
                sshConnection
                    .on('ready', () => {
                        console.log('SSH Connection established');
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`SSH Connection error (attempt ${attempt + 1}/${retries}):`, err);
                        reject(err);
                    })
                    .on('end', () => {
                        console.log('SSH Connection ended');
                    })
                    .connect({
                        host: process.env.SSH_HOST,
                        port: parseInt(process.env.SSH_PORT),
                        username: process.env.SSH_USER,
                        password: process.env.SSH_PASSWORD,
                        keepaliveInterval: 10000,
                        keepaliveCountMax: 3,
                        readyTimeout: 30000
                    });
            });

            // Create port forwarding
            const stream = await new Promise((resolve, reject) => {
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
            });

            return stream;
        } catch (err) {
            console.error(`SSH tunnel attempt ${attempt + 1}/${retries} failed:`, err);
            
            if (attempt === retries - 1) {
                throw err;
            }
            
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
    }
};

const getPool = async () => {
    try {
        if (globalPool) {
            // Test existing connection
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

        console.log('Establishing SSH connection...');
        const stream = await createSSHTunnel();

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
            connectTimeout: 60000,
            acquireTimeout: 60000
        });

        // Test the new connection
        await globalPool.query('SELECT 1');
        console.log('Database connection successful');

        return globalPool;
    } catch (err) {
        console.error('Error creating pool:', err);
        if (globalPool) {
            await globalPool.end().catch(console.error);
        }
        globalPool = null;
        throw err;
    }
};

// Function to query the database with retry logic and caching
const queryWithCacheAndRetry = async (query, params = [], attempts = 3) => {
    // Check the cache first
    const cacheKey = query + JSON.stringify(params);
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
        return cachedData;
    }

    for (let i = 0; i < attempts; i++) {
        try {
            const pool = await getPool();
            const [results] = await pool.query(query, params);
            
            // Cache the results to reduce repeated requests
            cache.set(cacheKey, results);

            return results;
        } catch (err) {
            console.error(`Error fetching data (attempt ${i + 1}/${attempts}):`, err);
            if (err.code === 'ERR_STREAM_WRITE_AFTER_END' || err.code === 'ETIMEDOUT') {
                console.log('Stream error or timeout, reconnecting...');
                sshConnection = null; // Reset SSH connection
                globalPool = null; // Reset pool
            }
            if (i === attempts - 1) throw err; // Throw error if max attempts reached
        }
    }
};

const closeConnections = async () => {
    try {
        if (globalPool) {
            await globalPool.end();
            globalPool = null;
        }
        if (sshConnection) {
            sshConnection.end();
            sshConnection = null;
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

module.exports = { getPool, closeConnections, queryWithCacheAndRetry };
