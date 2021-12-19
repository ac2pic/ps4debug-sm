// This will naively match input and send output
// 
const net = require('net');
const fs = require('fs');
function hexToBuffer(hex) {
    const buffer = Buffer.alloc(hex.length/2);
    let index = 0;
    while (index < hex.length) {
        const hexByte = hex.substring(index, index + 2);
        buffer[index/2] = Number("0x" + hexByte);
        index += 2;
    }
    return buffer;
}

function bufferToHex(buffer) {
    return Array.from(buffer).map(e => e.toString(16).padStart(2, '0').toUpperCase()).join('');
}

const lines = fs.readFileSync('out_900.txt', 'utf8').split('\n')
                    .map(e => e.trim())
                    .map((line) => {
                        const [_type, msg] = line.split(" ");
                        const out = {
                            "type": _type, 
                            buffer: hexToBuffer(msg)
                        };
                        return out;
                    });
const server = net.createServer((socket) => {
    console.log('New socket connection!');
    const data = [];

    function onData(buffer) {
        data.push(...buffer);
    }

    function closeConnection() {
        clearTimeout(readTimeoutId);
        clearTimeout(cmdLoopTimeoutId);
        socket.end();
    }

    let readTimeoutId = -1;
    async function read(byteLength) {
        return new Promise((resolve, reject) => {
            const checkData = () => {
                if (socket.destroyed) {
                    reject();
                }

                if (data.length >= byteLength) {
                    const dataSlice = data.splice(0, byteLength);
                    resolve(Buffer.from(dataSlice));
                } else {
                    readTimeoutId = setImmediate(checkData); 
                }
            };
            readTimeoutId = setImmediate(checkData);
        });
    }

    socket.on('data', onData);
    
    let lineIndex = 0;

    async function socketLoop() {
        let line = lines[lineIndex];
        if (line == null) {
            closeConnection();
            return;
        }

        if (line.type === 'in') {
            const bufferLength = line.buffer.length;
            const sentBuffer = await read(bufferLength);
            for (let i = 0; i < bufferLength; i++) {
                if (sentBuffer[i] !== line.buffer[i]) {
                    throw `Invalid buffer [${lineIndex + 1}@${i + 4}]`;
                }
            }
            lineIndex++;
            line = lines[lineIndex];
        } 
        while (line != null && line.type === 'out') {
            socket.write(line.buffer);
            lineIndex++;
            line = lines[lineIndex];
        }
        
        
    }

    const cmdLoop = async () => {
        try {
            await socketLoop();
        } catch (e) {
            console.log(e);
            closeConnection();
            return;
        }
        cmdLoopTimeoutId = setImmediate(cmdLoop); 
    };
    cmdLoopTimeoutId = setImmediate(cmdLoop);

}).on('error', (err) => {
    // Handle errors here.
    // throw err;
});

server.listen(744, 'localhost', 511, () => {
    console.log('opened server on', server.address());
});
console.log('Started listening');

process.on('uncaughtException',function(err){
    if (err.code === 'ECONNRESET') {
        // ignore this
    } else {
        console.log('something terrible happened..');
        console.log(err);
        process.exit(-1);
    }
});
