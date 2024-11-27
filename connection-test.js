const mysql = require('mysql2/promise');
const { Client } = require('ssh2');

const sshConfig = {
    host: '153.92.11.26',
    port: 65002,
    username: 'u856995433',
    password: '@Rabas12345'
};

const dbConfig = {
    host: '127.0.0.1', // Changed to IP instead of localhost
    user: 'u856995433_root',
    password: 'Rabas12345',
    database: 'u856995433_rabas',
    port: 3306,
    connectTimeout: 30000
};

async function testConnection() {
    console.log('Starting SSH tunnel connection test...');
    
    return new Promise((resolve, reject) => {
        const ssh = new Client();

        ssh.on('ready', () => {
            console.log('SSH Connection established');

            // Forward local port to remote MySQL
            ssh.forwardOut(
                '127.0.0.1', // Changed to IP
                0,           // Random local port
                '127.0.0.1', // Changed to IP
                3306,       // Remote port (MySQL)
                async (err, stream) => {
                    if (err) {
                        console.error('Port forwarding error:', err);
                        ssh.end();
                        return reject(err);
                    }

                    try {
                        console.log('Port forwarding established');
                        
                        // Create MySQL connection over SSH tunnel
                        const connection = await mysql.createConnection({
                            ...dbConfig,
                            stream: stream // Use the SSH stream
                        });

                        console.log('MySQL connection established');

                        // Test a simple query on your database
                        const [results] = await connection.query('SHOW TABLES FROM u856995433_rabas');
                        console.log('Available tables:', results);

                        // Clean up
                        await connection.end();
                        ssh.end();
                        resolve();

                    } catch (err) {
                        console.error('MySQL error:', err);
                        try {
                            await connection?.end();
                        } catch (endErr) {
                            console.error('Error ending connection:', endErr);
                        }
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

        ssh.on('end', () => {
            console.log('SSH connection ended');
        });

        // Connect to SSH server
        console.log('Connecting to SSH server...');
        ssh.connect(sshConfig);
    });
}

// Run the test
testConnection()
    .then(() => {
        console.log('Test completed successfully');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Test failed:', err);
        process.exit(1);
    }); 