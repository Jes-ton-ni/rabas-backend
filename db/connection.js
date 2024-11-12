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

let pool = null;

async function createPool() {
    return new Promise((resolve, reject) => {
        console.log('Establishing SSH connection...');
        const ssh = new Client();

        ssh.on('ready', () => {
            console.log('SSH Connection established');

            ssh.forwardOut(
                '127.0.0.1',
                0,
                '127.0.0.1',
                3306,
                async (err, stream) => {
                    if (err) {
                        console.error('Port forwarding error:', err);
                        ssh.end();
                        return reject(err);
                    }

                    try {
                        console.log('Port forwarding established');
                        
                        const pool = mysql.createPool({
                            ...dbConfig,
                            stream: stream,
                            connectionLimit: 10,
                            waitForConnections: true,
                            queueLimit: 0
                        });

                        // Test the pool
                        await pool.query('SELECT 1');
                        console.log('Database connection pool established');

                        // Store SSH client reference
                        pool.ssh = ssh;

                        resolve(pool);

                    } catch (err) {
                        console.error('MySQL error:', err);
                        ssh.end();
                        reject(err);
                    }
                }
            );
        });

        ssh.on('error', (err) => {
            console.error('SSH connection error:', err);
            reject(err);
        });

        ssh.connect(sshConfig);
    });
}

module.exports = {
    getPool: async () => {
        if (!pool) {
            pool = await createPool();
        }
        return pool;
    },
    closePool: async () => {
        if (pool) {
            await pool.end();
            pool.ssh.end();
            pool = null;
        }
    }
}; 